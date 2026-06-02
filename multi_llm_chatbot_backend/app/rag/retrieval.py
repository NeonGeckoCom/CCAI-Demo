"""Document retrieval for the RAG pipeline.

Runs document-aware similarity search against the ChromaDB collection:
query enhancement, document-reference detection, filtered search, and
result attribution/ranking.
"""

import logging
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class DocumentRetriever:
    """Searches the vector store and enriches results with attribution."""

    def __init__(self, collection):
        self.collection = collection

    def search(self, query: str, session_id: str,
               persona_context: str = "", n_results: int = 5,
               document_hint: str = None) -> List[Dict[str, Any]]:
        """
        Enhanced search with document awareness and context
        """
        try:
            # Extract potential document references from query
            document_references = self._extract_document_references(query)

            # Build enhanced query
            enhanced_query = self._build_enhanced_query(query, persona_context, document_references)

            # Base search filters
            search_filters = {"session_id": session_id}

            # If specific document mentioned, prioritize it
            if document_hint or document_references:
                priority_filename = document_hint or document_references[0] if document_references else None
                if priority_filename:
                    # First search: prioritize specific document
                    priority_results = self._search_with_filters(
                        enhanced_query,
                        {**search_filters, "filename": {"$contains": priority_filename}},
                        n_results=min(3, n_results)
                    )

                    # Second search: get additional context from other documents
                    remaining_results = max(0, n_results - len(priority_results))
                    if remaining_results > 0:
                        general_results = self._search_with_filters(
                            enhanced_query,
                            search_filters,
                            n_results=remaining_results + 2  # Get extras to filter out duplicates
                        )

                        # Combine results, avoiding duplicates
                        all_results = priority_results + [
                            r for r in general_results
                            if r["metadata"]["filename"] != priority_filename
                        ][:remaining_results]
                    else:
                        all_results = priority_results
                else:
                    all_results = self._search_with_filters(enhanced_query, search_filters, n_results)
            else:
                all_results = self._search_with_filters(enhanced_query, search_filters, n_results)

            # Enhance results with context and attribution
            enhanced_results = self._enhance_search_results(all_results, query)

            logger.info(f"Enhanced search returned {len(enhanced_results)} results for query: {query[:50]}...")
            return enhanced_results

        except Exception as e:
            logger.error(f"Error in enhanced document search: {str(e)}")
            return []

    def _search_with_filters(self, query: str, filters: Dict, n_results: int) -> List[Dict[str, Any]]:
        """Helper method for filtered search"""
        results = self.collection.query(
            query_texts=[query],
            n_results=n_results,
            where=filters
        )

        formatted_results = []
        if results['documents'] and results['documents'][0]:
            for i, (doc, metadata, distance) in enumerate(zip(
                results['documents'][0],
                results['metadatas'][0],
                results['distances'][0]
            )):
                similarity_score = 1 / (1 + abs(distance)) if distance is not None else 0.5

                formatted_results.append({
                    "text": doc,
                    "metadata": metadata,
                    "relevance_score": similarity_score,
                    "distance": distance,
                    "rank": i + 1
                })

        return formatted_results

    def _extract_document_references(self, query: str) -> List[str]:
        """Extract potential document name references from user query"""
        # Common patterns for document references
        patterns = [
            r"(?:my|the|in)\s+([a-zA-Z_\-]+\.(?:pdf|docx|txt|doc))",  # my document.pdf
            r"(?:my|the)\s+(dissertation|thesis|proposal|chapter|paper|manuscript)",  # my dissertation
            r"(?:in|from)\s+(?:my\s+)?([a-zA-Z_\-\s]+(?:chapter|section|proposal))",  # in my methodology chapter
            r"(?:the|my)\s+([a-zA-Z_\-\s]+(?:document|file))",  # the research document
        ]

        references = []
        query_lower = query.lower()

        for pattern in patterns:
            matches = re.findall(pattern, query_lower)
            references.extend(matches)

        # Clean up references
        cleaned_references = []
        for ref in references:
            cleaned = ref.strip().replace(" ", "_")
            if len(cleaned) > 2:  # Avoid single characters
                cleaned_references.append(cleaned)

        return cleaned_references[:3]  # Limit to first 3 references

    def _build_enhanced_query(self, original_query: str, persona_context: str,
                              document_refs: List[str]) -> str:
        """Build enhanced query with context and document awareness"""
        query_parts = [original_query]

        if persona_context:
            query_parts.append(persona_context)

        if document_refs:
            query_parts.extend(document_refs)

        return " ".join(query_parts)

    def _enhance_search_results(self, results: List[Dict], original_query: str) -> List[Dict[str, Any]]:
        """Enhance search results with better attribution and context"""
        enhanced = []

        for result in results:
            metadata = result["metadata"]

            # Create enhanced result with clear attribution
            enhanced_result = {
                **result,
                "document_source": {
                    "filename": metadata.get("filename", "unknown"),
                    "document_title": metadata.get("document_title", metadata.get("filename", "unknown")),
                    "section": metadata.get("document_section", "unknown"),
                    "chunk_position": f"{metadata.get('chunk_index', 0) + 1} of {metadata.get('total_chunks', 1)}"
                },
                "content_type": metadata.get("chunk_type", "content"),
                "context_indicators": {
                    "has_methodology": metadata.get("has_methodology", False),
                    "has_theory": metadata.get("has_theory", False),
                    "has_references": metadata.get("has_references", False)
                }
            }

            enhanced.append(enhanced_result)

        # Sort by relevance score, but boost results from explicitly mentioned documents
        enhanced.sort(key=lambda x: (
            1.0 if any(ref in x["document_source"]["filename"].lower()
                       for ref in self._extract_document_references(original_query)) else 0.0,
            x["relevance_score"]
        ), reverse=True)

        return enhanced
