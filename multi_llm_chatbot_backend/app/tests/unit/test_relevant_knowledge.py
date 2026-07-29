import unittest
from unittest.mock import AsyncMock, patch

from app.core.library import get_relevant_knowledge_context_block, record_chat_memory


class TestRelevantKnowledge(unittest.IsolatedAsyncioTestCase):
    async def test_only_query_relevant_sections_are_included(self):
        markdown = """# What we know

### Document: Dissertation Outline.docx
The dissertation outline uses a three-paper structure and mixed methods.

### Wellbeing
The student prefers afternoon breaks and short work sessions.

### Advisor meetings
The advisor requested clearer chapter transitions."""

        with patch(
            "app.core.library.get_knowledge",
            new=AsyncMock(return_value={"markdown": markdown}),
        ):
            context = await get_relevant_knowledge_context_block(
                "student-id",
                "Review my dissertation outline and chapter transitions",
            )

        self.assertIn("Document: Dissertation Outline.docx", context)
        self.assertIn("Advisor meetings", context)
        self.assertNotIn("Wellbeing", context)

    async def test_defense_simulation_section_is_excluded_from_normal_chat(self):
        markdown = """# What we know

### Defense & presentation practice
- Practice question (Sidney D'Mello): How does productive confusion fit?

### Advisor meetings
The advisor requested clearer framework definitions."""

        with patch(
            "app.core.library.get_knowledge",
            new=AsyncMock(return_value={"markdown": markdown}),
        ):
            context = await get_relevant_knowledge_context_block(
                "student-id",
                "What are my advisor and committee concerns about the framework?",
            )

        self.assertIn("Advisor meetings", context)
        self.assertNotIn("Defense & presentation practice", context)
        self.assertNotIn("productive confusion", context)

    async def test_chat_memory_uses_student_text_not_advisor_output(self):
        llm = AsyncMock()
        llm.generate.return_value = "- The student studies feedback systems."
        with (
            patch(
                "app.core.library.get_knowledge_section",
                new=AsyncMock(return_value=""),
            ),
            patch(
                "app.core.library.upsert_knowledge_section",
                new=AsyncMock(),
            ) as upsert,
            patch(
                "app.llm.clients.provider_manager.create_llm_client",
                return_value=llm,
            ),
        ):
            await record_chat_memory(
                "student-id",
                "I study feedback systems.",
                [{
                    "name": "AI advisor",
                    "response": "Sidney D'Mello is concerned about productive confusion.",
                }],
            )

        prompt = llm.generate.await_args.kwargs["context"][0]["content"]
        self.assertIn("I study feedback systems.", prompt)
        self.assertNotIn("Sidney D'Mello", prompt)
        self.assertNotIn("productive confusion", prompt)
        upsert.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
