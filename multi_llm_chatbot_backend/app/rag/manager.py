"""RAG manager — owns the ChromaDB collection and the ingest/search pipeline.

`EnhancedRAGManager` coordinates `DocumentChunker` (ingestion) and
`DocumentRetriever` (search) over a persistent ChromaDB collection.
Use `get_rag_manager()` to obtain the shared singleton instance.
"""

import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List

import chromadb
from chromadb.config import Settings

from app.config import get_settings
from app.rag.chunking import DocumentChunker
from app.rag.retrieval import DocumentRetriever

logger = logging.getLogger(__name__)


class EnhancedRAGManager:
    """Document storage and retrieval over a persistent ChromaDB collection."""

    def __init__(self, persist_directory: str = "./chromadb_storage"):
        """Initialize enhanced RAG manager with improved document handling"""
        settings = get_settings()

        self.persist_directory = persist_directory
        Path(persist_directory).mkdir(exist_ok=True)

        # Initialize ChromaDB client
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(anonymized_telemetry=False)
        )

        # Collection name from config
        collection_name = settings.rag.chroma_collection

        # Create or get collection
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )

        # Ingestion and retrieval collaborators
        self.chunker = DocumentChunker()
        self.retriever = DocumentRetriever(self.collection)

        logger.info(f"Enhanced RAG Manager initialized with collection: {self.collection.name}")

    def add_document(self, content: str, filename: str, session_id: str,
                     file_type: str = "unknown") -> Dict[str, Any]:
        """
        Enhanced document addition to ChromaDB with better metadata and document awareness
        """
        try:
            # Preprocess the content
            cleaned_content = self.chunker.preprocess_content(content)
            if not cleaned_content.strip():
                return {
                    "success": False,
                    "error": "Document content is empty after preprocessing",
                    "filename": filename
                }

            # Extract document metadata
            doc_metadata = self.chunker.extract_document_metadata(cleaned_content, filename, file_type)

            # Create intelligent chunks with overlap and context preservation
            chunks = self.chunker.create_chunks(cleaned_content)

            # Prepare data for ChromaDB
            chunk_texts = []
            chunk_metadatas = []
            chunk_ids = []

            for i, chunk_data in enumerate(chunks):
                chunk_id = f"{session_id}_{filename}_{i}_{uuid.uuid4().hex[:8]}"

                # Enhanced metadata with document awareness
                metadata = {
                    "session_id": session_id,
                    "filename": filename,
                    "file_type": file_type,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "document_section": chunk_data.get("section", "unknown"),
                    "keywords": chunk_data.get("keywords", ""),
                    "chunk_type": chunk_data.get("type", "content"),
                    "document_title": doc_metadata.get("title", filename),
                    "estimated_tokens": len(chunk_data["text"].split()) * 1.3,
                    "has_references": "references" in chunk_data["text"].lower(),
                    "has_methodology": "method" in chunk_data["text"].lower(),
                    "has_theory": any(word in chunk_data["text"].lower()
                                    for word in ["theory", "theoretical", "framework", "concept"])
                }

                chunk_texts.append(chunk_data["text"])
                chunk_metadatas.append(metadata)
                chunk_ids.append(chunk_id)

            # Add to ChromaDB
            self.collection.add(
                documents=chunk_texts,
                metadatas=chunk_metadatas,
                ids=chunk_ids
            )

            total_tokens = sum(metadata["estimated_tokens"] for metadata in chunk_metadatas)

            logger.info(f"Successfully added document {filename}: {len(chunks)} chunks, ~{total_tokens:.0f} tokens")

            return {
                "success": True,
                "filename": filename,
                "chunks_created": len(chunks),
                "total_tokens": int(total_tokens),
                "document_metadata": doc_metadata
            }

        except Exception as e:
            logger.error(f"Error adding document {filename}: {str(e)}")
            return {
                "success": False,
                "filename": filename,
                "error": str(e)
            }

    def search_documents_with_context(self, query: str, session_id: str,
                                      n_results: int = 5,
                                      document_hint: str = None) -> List[Dict[str, Any]]:
        """Enhanced document-aware search (delegates to DocumentRetriever)."""
        return self.retriever.search(
            query, session_id, n_results, document_hint
        )

    def delete_session_documents(self, session_id: str) -> bool:
        """Delete all vector-store chunks associated with a session."""
        try:
            self.collection.delete(where={"session_id": session_id})
            logger.info("Deleted documents for session %s", session_id)
            return True
        except Exception as e:
            logger.error("Error deleting documents for session %s: %s", session_id, e)
            return False

    def get_document_stats(self, session_id: str) -> Dict[str, Any]:
        """Get enhanced statistics about documents in a session"""
        try:
            # Get all chunks for this session
            results = self.collection.get(
                where={"session_id": session_id},
                include=["metadatas"]
            )

            if not results['metadatas']:
                return {"total_chunks": 0, "total_documents": 0, "documents": []}

            # Analyze documents
            documents = {}
            total_tokens = 0

            for metadata in results['metadatas']:
                filename = metadata.get('filename', 'unknown')

                if filename not in documents:
                    documents[filename] = {
                        "filename": filename,
                        "title": metadata.get('document_title', filename),
                        "file_type": metadata.get('file_type', 'unknown'),
                        "chunks": 0,
                        "estimated_tokens": 0,
                        "sections": set(),
                        "has_methodology": False,
                        "has_theory": False,
                        "has_references": False
                    }

                doc_info = documents[filename]
                doc_info["chunks"] += 1
                doc_info["estimated_tokens"] += metadata.get('estimated_tokens', 0)
                doc_info["sections"].add(metadata.get('document_section', 'unknown'))

                if metadata.get('has_methodology'):
                    doc_info["has_methodology"] = True
                if metadata.get('has_theory'):
                    doc_info["has_theory"] = True
                if metadata.get('has_references'):
                    doc_info["has_references"] = True

                total_tokens += metadata.get('estimated_tokens', 0)

            # Convert sets to lists for JSON serialization
            for doc_info in documents.values():
                doc_info["sections"] = list(doc_info["sections"])

            return {
                "total_chunks": len(results['metadatas']),
                "total_documents": len(documents),
                "total_estimated_tokens": int(total_tokens),
                "documents": list(documents.values())
            }

        except Exception as e:
            logger.error(f"Error getting document stats: {str(e)}")
            return {"error": str(e), "total_chunks": 0, "total_documents": 0}


# Global RAG manager instance
_rag_manager = None


def get_rag_manager() -> EnhancedRAGManager:
    """Get or create the global RAG manager instance"""
    global _rag_manager
    if _rag_manager is None:
        _rag_manager = EnhancedRAGManager()
    return _rag_manager
