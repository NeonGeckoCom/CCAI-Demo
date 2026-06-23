import unittest
from unittest.mock import patch

from app.rag.persona_context_builder import PersonaContextBuilder


class FakeSession:
    uploaded_files = []

    def __init__(self):
        self.messages = [
            {"role": "system", "content": "Session started."},
            {"role": "user", "content": "How should I frame the first milestone?"},
            {"role": "minimalist", "content": "Frame it around the decision it enables."},
            {"role": "user", "content": "What constraint matters most?"},
            {"role": "minimalist", "content": "The schedule is the tightest constraint."},
            {"role": "user", "content": "How should I explain the next step?"},
            {"role": "minimalist", "content": "State the action and why it matters."},
            {"role": "user", "content": "Please recap the questions I asked."},
        ]


class LongFakeSession:
    uploaded_files = []

    def __init__(self):
        self.messages = [
            {"role": "system", "content": "Session started."},
            {"role": "user", "content": "Original question about project scope."},
            {
                "role": "minimalist",
                "content": "The first answer discussed project scope. " * 16,
            },
            {
                "role": "user",
                "content": "Please keep retrieval behavior general.",
            },
            {
                "role": "minimalist",
                "content": "We discussed retrieval quality and context handling. " * 16,
            },
            {
                "role": "user",
                "content": "Do not target one specific memory question; use budget-based compaction.",
            },
            {
                "role": "minimalist",
                "content": "The plan is to preserve recent exact turns and summarize only older history when needed.",
            },
            {"role": "user", "content": "What did we decide?"},
        ]


class FakePersona:
    system_prompt = "You are a concise advisor."


class FakeRagManager:
    def __init__(self, *, has_documents=True):
        self.has_documents = has_documents
        self.search_calls = []

    def get_document_stats(self, session_id):
        if not self.has_documents:
            return {"total_documents": 0, "total_chunks": 0, "documents": []}
        return {
            "total_documents": 1,
            "total_chunks": 1,
            "documents": [{"filename": "source.pdf", "chunks": 1}],
        }

    def search_documents_with_context(self, **kwargs):
        self.search_calls.append(kwargs)
        return [
            {
                "text": "Relevant passage.",
                "relevance_score": 0.9,
                "document_source": {
                    "filename": "source.pdf",
                    "document_title": "Source",
                    "section": "content",
                    "chunk_position": "1 of 1",
                },
            }
        ]


class FakeKeywordLLM:
    def __init__(self, response_text):
        self.response_text = response_text
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.response_text


class PersonaContextBuilderTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_conversation_is_included_without_summary(self):
        builder = PersonaContextBuilder(max_context_tokens=4000)

        context = await builder.build_enhanced_context_for_persona(
            FakeSession(),
            FakePersona(),
            "Please recap the questions I asked.",
            "Relevant retrieved context.",
        )

        system_context = context[0]["content"]
        self.assertNotIn("CONVERSATION MEMORY", system_context)
        self.assertNotIn("EARLIER CONVERSATION SUMMARY", system_context)

        user_messages = [message["content"] for message in context if message["role"] == "user"]
        self.assertEqual(user_messages[0], "How should I frame the first milestone?")
        self.assertIn("What constraint matters most?", user_messages)
        self.assertEqual(user_messages[-1], "Please recap the questions I asked.")

    async def test_long_conversation_compacts_older_history_by_budget(self):
        builder = PersonaContextBuilder(max_context_tokens=1000)

        context = await builder.build_enhanced_context_for_persona(
            LongFakeSession(),
            FakePersona(),
            "What did we decide?",
            "",
        )

        system_context = context[0]["content"]
        self.assertNotIn("CONVERSATION MEMORY", system_context)
        self.assertIn("EARLIER CONVERSATION SUMMARY", system_context)
        self.assertIn("Original question about project scope.", system_context)
        self.assertIn("Please keep retrieval behavior general.", system_context)

        user_messages = [message["content"] for message in context if message["role"] == "user"]
        self.assertNotIn("Original question about project scope.", user_messages)
        self.assertEqual(user_messages[-1], "What did we decide?")

    def test_flat_numbered_table_text_gets_row_separators(self):
        builder = PersonaContextBuilder()

        formatted = builder._format_chunk_text_for_prompt(
            "Table 2. Summary Name Purpose Time "
            "1. Intake Form Collect preferences 5 Minutes "
            "2. Follow-up Interview Collect details 30 Minutes"
        )

        self.assertIn("Table 2. Summary", formatted)
        self.assertIn("| 1. Intake Form", formatted)
        self.assertIn("| 2. Follow-up Interview", formatted)

    def test_document_context_does_not_expose_internal_chunk_labels(self):
        builder = PersonaContextBuilder()

        context = builder._format_document_context_with_attribution(
            [
                {
                    "text": "The proposal identifies a motivation gap.",
                    "relevance_score": 0.93,
                    "document_source": {
                        "filename": "proposal.pdf",
                        "document_title": "Dissertation Proposal",
                        "section": "Chapter 2",
                        "chunk_position": "45 of 300",
                    },
                }
            ],
            "methodologist",
        )

        self.assertIn("Dissertation Proposal", context)
        self.assertIn("[Document excerpt]", context)
        self.assertNotIn("[Document excerpt (Chapter 2)]", context)
        self.assertNotIn("Part 45", context)
        self.assertNotIn("45 of 300", context)
        self.assertNotIn("Relevance", context)

    async def test_retrieval_appends_llm_keywords_when_documents_exist(self):
        builder = PersonaContextBuilder()
        rag_manager = FakeRagManager()
        llm = FakeKeywordLLM("alumni survey, interview duration")
        stages = []

        async def on_stage(phase, data):
            stages.append(phase)

        with patch(
            "app.rag.persona_context_builder.get_rag_manager",
            return_value=rag_manager,
        ):
            context = await builder.retrieve_relevant_documents(
                "What are the estimated time commitments?",
                "session-1",
                "minimalist",
                llm_client=llm,
                on_stage=on_stage,
            )

        search_query = rag_manager.search_calls[0]["query"]
        self.assertTrue(llm.calls)
        self.assertIn("What are the estimated time commitments?", search_query)
        self.assertIn("alumni survey", search_query)
        self.assertIn("interview duration", search_query)
        self.assertIn("rag_rewriting_query", stages)
        self.assertIn("rag_retrieving", stages)
        self.assertIn("Relevant passage.", context)

    async def test_retrieval_does_not_rewrite_when_no_documents_exist(self):
        builder = PersonaContextBuilder()
        rag_manager = FakeRagManager(has_documents=False)
        llm = FakeKeywordLLM("unused keyword")

        with patch(
            "app.rag.persona_context_builder.get_rag_manager",
            return_value=rag_manager,
        ):
            context = await builder.retrieve_relevant_documents(
                "What are the estimated time commitments?",
                "session-1",
                "minimalist",
                llm_client=llm,
            )

        self.assertEqual("", context)
        self.assertEqual([], llm.calls)
        self.assertEqual([], rag_manager.search_calls)


if __name__ == "__main__":
    unittest.main()
