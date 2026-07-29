import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.api.routes.chat import _sync_library_documents_to_session
from app.rag.manager import EnhancedRAGManager


class TestChatLibrarySync(unittest.IsolatedAsyncioTestCase):
    async def test_server_library_documents_become_available_to_chat_rag(self):
        documents = [
            {
                "id": "outline-id",
                "filename": "ENED Dissertation Outline.docx",
                "content": "Chapter 1\nResearch problem and contribution.",
                "content_hash": "outline-hash",
                "file_type": "docx",
                "source": "defense room",
            }
        ]
        rag_manager = Mock()
        rag_manager.sync_library_document.return_value = {
            "success": True,
            "filename": "ENED Dissertation Outline.docx",
            "chunks_created": 2,
        }
        session = SimpleNamespace(uploaded_files=[])

        with (
            patch(
                "app.core.library.list_documents_for_rag",
                new=AsyncMock(return_value=documents),
            ),
            patch(
                "app.rag.manager.get_rag_manager",
                return_value=rag_manager,
            ),
        ):
            available = await _sync_library_documents_to_session(
                "student-id",
                "chat-session-id",
                session,
            )

        self.assertEqual(available, ["ENED Dissertation Outline.docx"])
        self.assertEqual(session.uploaded_files, ["ENED Dissertation Outline.docx"])
        rag_manager.sync_library_document.assert_called_once_with(
            content="Chapter 1\nResearch problem and contribution.",
            filename="ENED Dissertation Outline.docx",
            session_id="chat-session-id",
            source_document_id="outline-id",
            content_hash="outline-hash",
            file_type="docx",
            source_updated_at="",
            source_route="",
        )

    async def test_failed_library_document_does_not_claim_chat_access(self):
        rag_manager = Mock()
        rag_manager.sync_library_document.return_value = {
            "success": False,
            "error": "index unavailable",
        }
        session = SimpleNamespace(uploaded_files=[])

        with (
            patch(
                "app.core.library.list_documents_for_rag",
                new=AsyncMock(return_value=[{
                    "id": "outline-id",
                    "filename": "Outline.docx",
                    "content": "Outline content",
                    "content_hash": "hash",
                    "file_type": "docx",
                }]),
            ),
            patch(
                "app.rag.manager.get_rag_manager",
                return_value=rag_manager,
            ),
        ):
            available = await _sync_library_documents_to_session(
                "student-id",
                "chat-session-id",
                session,
            )

        self.assertEqual(available, [])
        self.assertEqual(session.uploaded_files, [])


class TestRagLibraryDocumentSync(unittest.TestCase):
    def test_each_chunk_preserves_resolvable_source_metadata(self):
        manager = EnhancedRAGManager.__new__(EnhancedRAGManager)
        manager.collection = Mock()
        manager.chunker = Mock()
        manager.chunker.preprocess_content.return_value = "Slide content"
        manager.chunker.extract_document_metadata.return_value = {
            "title": "Navigator Presentation",
        }
        manager.chunker.create_chunks.return_value = [{
            "text": "Study 3 overview",
            "section": "methods",
            "heading": "Study 3",
            "page_number": 0,
            "slide_number": 8,
            "keywords": "study",
            "type": "content",
        }]

        result = manager.add_document(
            content="Slide content",
            filename="PhD Navigator Presentation.pptx",
            session_id="chat-session",
            file_type="pptx",
            source_document_id="deck-id",
            content_hash="deck-hash",
            origin="library",
            source_updated_at="2026-07-18T12:00:00Z",
            source_route="/api/library/documents/deck-id",
        )

        self.assertTrue(result["success"])
        metadata = manager.collection.add.call_args.kwargs["metadatas"][0]
        self.assertEqual(metadata["source_document_id"], "deck-id")
        self.assertEqual(metadata["file_type"], "pptx")
        self.assertEqual(metadata["filename"], "PhD Navigator Presentation.pptx")
        self.assertEqual(metadata["slide_number"], 8)
        self.assertEqual(metadata["document_heading"], "Study 3")
        self.assertEqual(metadata["source_updated_at"], "2026-07-18T12:00:00Z")
        self.assertEqual(
            metadata["source_route"],
            "/api/library/documents/deck-id",
        )

    def test_unchanged_document_is_not_reindexed(self):
        manager = EnhancedRAGManager.__new__(EnhancedRAGManager)
        manager.collection = Mock()
        manager.collection.get.return_value = {
            "ids": ["chunk-1"],
            "metadatas": [{"content_hash": "same-hash", "metadata_version": 2}],
        }
        manager.add_document = Mock()

        result = manager.sync_library_document(
            content="Outline content",
            filename="Outline.docx",
            session_id="chat-session",
            source_document_id="outline-id",
            content_hash="same-hash",
            file_type="docx",
        )

        self.assertTrue(result["success"])
        self.assertTrue(result["already_current"])
        manager.add_document.assert_not_called()
        manager.collection.delete.assert_not_called()

    def test_changed_document_replaces_stale_chunks(self):
        manager = EnhancedRAGManager.__new__(EnhancedRAGManager)
        manager.collection = Mock()
        manager.collection.get.side_effect = [
            {
                "ids": ["source-chunk"],
                "metadatas": [{"content_hash": "old-hash"}],
            },
            {
                "ids": ["source-chunk", "legacy-chunk"],
                "metadatas": [{}, {}],
            },
        ]
        manager.add_document = Mock(return_value={"success": True})

        result = manager.sync_library_document(
            content="Updated outline",
            filename="Outline.docx",
            session_id="chat-session",
            source_document_id="outline-id",
            content_hash="new-hash",
            file_type="docx",
        )

        self.assertTrue(result["success"])
        manager.collection.delete.assert_called_once()
        self.assertEqual(
            set(manager.collection.delete.call_args.kwargs["ids"]),
            {"source-chunk", "legacy-chunk"},
        )
        manager.add_document.assert_called_once_with(
            content="Updated outline",
            filename="Outline.docx",
            session_id="chat-session",
            file_type="docx",
            source_document_id="outline-id",
            content_hash="new-hash",
            origin="library",
            source_updated_at="",
            source_route="",
        )


if __name__ == "__main__":
    unittest.main()
