import os
import unittest

# Importing an API route initializes the configured provider; extraction tests
# replace the client before any network call.
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.api.routes.discovery import (
    MILESTONE_RETRIEVAL_QUERIES,
    extract_deliverables_with_rag_llm,
    normalize_llm_deliverables,
)


class FakeRagManager:
    def __init__(self):
        self.added = []
        self.queries = []
        self.deleted = []

    def add_document(self, content, filename, session_id, file_type):
        self.added.append((content, filename, session_id, file_type))
        return {"success": True}

    def get_document_stats(self, session_id):
        return {"total_chunks": 2}

    def search_documents_with_context(self, query, session_id, n_results):
        self.queries.append((query, session_id, n_results))
        return [
            {
                "text": (
                    "Students complete the Community Research Portfolio Review "
                    "before beginning dissertation fieldwork."
                ),
                "metadata": {"filename": "handbook.pdf", "chunk_index": 0},
            }
        ]

    def delete_session_documents(self, session_id):
        self.deleted.append(session_id)
        return True


class FakeLlmClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_rag_llm_extracts_program_specific_milestone_and_cleans_up(self):
        rag = FakeRagManager()
        llm = FakeLlmClient(
            """```json
            {"deliverables":[{
              "name":"Community Research Portfolio Review",
              "when":"Before dissertation fieldwork",
              "source":"handbook.pdf"
            }]}
            ```"""
        )

        result = await extract_deliverables_with_rag_llm(
            [
                {
                    "source": "handbook.pdf",
                    "text": "Students complete the Community Research Portfolio Review before fieldwork.",
                    "file_type": "pdf",
                }
            ],
            "PhD, Information Science",
            "Example University",
            rag_manager=rag,
            llm_client=llm,
            session_id="discovery-test",
        )

        self.assertEqual(
            result,
            [
                {
                    "name": "Community Research Portfolio Review",
                    "when": "Before dissertation fieldwork",
                    "source": "handbook.pdf",
                }
            ],
        )
        self.assertEqual(len(rag.added), 1)
        self.assertEqual(len(rag.queries), len(MILESTONE_RETRIEVAL_QUERIES))
        self.assertEqual(rag.deleted, ["discovery-test"])
        self.assertEqual(llm.calls[0]["response_mime_type"], "application/json")
        self.assertIn("[SOURCE: handbook.pdf]", llm.calls[0]["context"][0]["content"])

    async def test_invalid_llm_output_returns_empty_and_still_cleans_up(self):
        rag = FakeRagManager()
        llm = FakeLlmClient("not json")

        result = await extract_deliverables_with_rag_llm(
            [{"source": "rules.txt", "text": "A formal review is required."}],
            "PhD",
            "Example University",
            rag_manager=rag,
            llm_client=llm,
            session_id="invalid-test",
        )

        self.assertEqual(result, [])
        self.assertEqual(rag.deleted, ["invalid-test"])

    def test_llm_sources_are_constrained_to_uploaded_files(self):
        result = normalize_llm_deliverables(
            {
                "deliverables": [
                    {
                        "name": "Portfolio review",
                        "when": "Year 2",
                        "source": "invented-source.pdf",
                    }
                ]
            },
            ["actual-handbook.pdf"],
        )

        self.assertEqual(result[0]["source"], "actual-handbook.pdf")


if __name__ == "__main__":
    unittest.main()
