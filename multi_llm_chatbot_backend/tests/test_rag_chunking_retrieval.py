import unittest

from app.rag.chunking import DocumentChunker, PROSE_CHUNK_SEPARATORS
from app.rag.retrieval import DocumentRetriever


class FakeCollection:
    def __init__(self):
        self.documents = {
            0: "R3 - What benefits do students actually obtain after",
            1: "taking Entrepreneurial Courses/Programs? More text follows.",
        }
        self.metadatas = {
            idx: {
                "session_id": "session-1",
                "filename": "protocol.pdf",
                "chunk_index": idx,
                "total_chunks": 2,
                "document_section": "objectives",
                "document_title": "Protocol",
                "chunk_type": "content",
            }
            for idx in self.documents
        }

    def query(self, query_texts, n_results, where):
        return {
            "documents": [[self.documents[0]]],
            "metadatas": [[self.metadatas[0]]],
            "distances": [[0.2]],
        }

    def get(self, where, include=None, limit=None):
        if where == {"session_id": "session-1"}:
            return {
                "documents": [self.documents[idx] for idx in sorted(self.documents)],
                "metadatas": [self.metadatas[idx] for idx in sorted(self.metadatas)],
            }

        chunk_index = None
        for clause in where.get("$and", []):
            if "chunk_index" in clause:
                chunk_index = clause["chunk_index"]
                break
        if chunk_index not in self.documents:
            return {"documents": [], "metadatas": []}
        return {
            "documents": [self.documents[chunk_index]],
            "metadatas": [self.metadatas[chunk_index]],
        }


class FakeLookupCollection:
    def __init__(self):
        self.documents = {
            0: "Methodology design validity sampling procedure analysis framework.",
            1: "Research design procedure data collection analysis validity.",
            2: "Task 1 is sent to new analysts through the onboarding portal.",
            3: "1. Task Intake Form Purpose Collect early preferences Time 5 Minutes",
            4: "Task 2 is sent to returning analysts through a separate workflow.",
        }
        self.metadatas = {
            idx: {
                "session_id": "session-1",
                "filename": "guide.pdf",
                "chunk_index": idx,
                "total_chunks": len(self.documents),
                "document_section": "procedure",
                "document_title": "Guide",
                "chunk_type": "content",
            }
            for idx in self.documents
        }

    def query(self, query_texts, n_results, where):
        return {
            "documents": [[self.documents[0]]],
            "metadatas": [[self.metadatas[0]]],
            "distances": [[0.2]],
        }

    def get(self, where, include=None, limit=None):
        if where == {"session_id": "session-1"}:
            return {
                "documents": [self.documents[idx] for idx in sorted(self.documents)],
                "metadatas": [self.metadatas[idx] for idx in sorted(self.metadatas)],
            }

        chunk_index = None
        for clause in where.get("$and", []):
            if "chunk_index" in clause:
                chunk_index = clause["chunk_index"]
                break
        if chunk_index not in self.documents:
            return {"documents": [], "metadatas": []}
        return {
            "documents": [self.documents[chunk_index]],
            "metadatas": [self.metadatas[chunk_index]],
        }


class RagChunkingRetrievalTests(unittest.TestCase):
    def test_chunker_preserves_line_boundaries_and_uses_sentence_separators(self):
        chunker = DocumentChunker()

        self.assertEqual(chunker.text_splitter._chunk_size, 4000)
        self.assertEqual(chunker.text_splitter._chunk_overlap, 400)
        self.assertEqual(chunker.text_splitter._separators, PROSE_CHUNK_SEPARATORS)
        self.assertEqual(chunker.text_splitter._keep_separator, "end")
        self.assertLess(PROSE_CHUNK_SEPARATORS.index(". "), PROSE_CHUNK_SEPARATORS.index(" "))
        self.assertLess(PROSE_CHUNK_SEPARATORS.index("? "), PROSE_CHUNK_SEPARATORS.index(" "))
        self.assertLess(PROSE_CHUNK_SEPARATORS.index("! "), PROSE_CHUNK_SEPARATORS.index(" "))

        cleaned = chunker.preprocess_content(
            "First paragraph.\n\nSecond paragraph.\n  Third line."
        )

        self.assertIn("First paragraph.\n\nSecond paragraph.", cleaned)
        self.assertIn("Second paragraph.\nThird line.", cleaned)

    def test_chunker_does_not_treat_duration_as_numbered_section(self):
        chunker = DocumentChunker()

        chunks = chunker.create_chunks(
            "4. Alumni Survey/Interviews To understand graduate perceptions "
            "3 Minutes\n"
            "30 minutes\n"
            "(Interview)\n"
            "5. Prior Alumni Surveys Existing data 0 minutes\n"
            "(data exists)"
        )

        chunk_texts = [chunk["text"] for chunk in chunks]
        self.assertNotIn("30 minutes\n(Interview)", chunk_texts)
        self.assertTrue(
            any(
                text.startswith("4.")
                and "3 Minutes\n30 minutes\n(Interview)" in text
                for text in chunk_texts
            )
        )

    def test_retrieval_adds_next_chunk_when_result_ends_mid_sentence(self):
        retriever = DocumentRetriever(FakeCollection())

        results = retriever.search(
            "What are R1 R2 and R3?",
            "session-1",
            n_results=1,
        )

        self.assertGreaterEqual(len(results), 2)
        self.assertIn("actually obtain after", results[0]["text"])
        self.assertIn("taking Entrepreneurial Courses/Programs?", results[1]["text"])
        self.assertTrue(results[1]["adjacent_context"])
        self.assertEqual(results[1]["document_source"]["chunk_position"], "2 of 2")

    def test_sparse_lookup_retrieves_exact_duration_evidence(self):
        retriever = DocumentRetriever(FakeLookupCollection())

        results = retriever.search(
            "What is Task 1, who receives it, and how long does it take?",
            "session-1",
            n_results=3,
        )

        combined = " ".join(result["text"] for result in results)
        self.assertIn("Task 1 is sent to new analysts", combined)
        self.assertIn("5 Minutes", combined)


if __name__ == "__main__":
    unittest.main()
