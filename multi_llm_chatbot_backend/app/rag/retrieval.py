"""Document retrieval for the RAG pipeline.

Runs document-aware hybrid search against the ChromaDB collection:
query enhancement, dense retrieval, sparse/BM25-style retrieval, adjacent
chunk expansion, and result attribution.
"""

import logging
import math
import re
from collections import Counter
from typing import Any, Dict, List, Sequence

logger = logging.getLogger(__name__)

TERMINAL_SENTENCE_CHARS = ".?!)]}\"'"
BM25_K1 = 1.5
BM25_B = 0.75
QUERY_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "could",
    "did", "do", "does", "for", "from", "had", "has", "have", "how",
    "i", "in", "into", "is", "it", "its", "of", "on", "or", "our",
    "should", "that", "the", "their", "this", "to", "was", "were",
    "what", "when", "where", "which", "who", "why", "with", "would",
    "you", "your",
}

class DocumentRetriever:
    """Searches the vector store and enriches results with attribution."""

    def __init__(self, collection):
        self.collection = collection

    def search(self, query: str, session_id: str,
               n_results: int = 5,
               document_hint: str = None) -> List[Dict[str, Any]]:
        """Hybrid document-aware search."""
        try:
            document_references = self._extract_document_references(query)
            logger.info(
                "RAG retrieval query: query=%r document_references=%s document_hint=%r",
                query,
                document_references,
                document_hint,
            )

            search_filters = {"session_id": session_id}
            dense_results = self._dense_search(
                query,
                search_filters,
                n_results,
                document_hint,
                document_references,
            )
            sparse_results = self._sparse_search(
                query,
                session_id,
                n_results=max(n_results * 4, 12),
            )

            hybrid_results = self._merge_hybrid_results(
                dense_results,
                sparse_results,
            )
            hybrid_results = hybrid_results[:n_results]
            hybrid_results = self._include_boundary_adjacent_chunks(hybrid_results, session_id)
            enhanced_results = self._enhance_search_results(hybrid_results, query)

            logger.info(
                "Enhanced search returned %s results for query: %s...",
                len(enhanced_results),
                query[:50],
            )
            return enhanced_results

        except Exception as e:
            logger.error("Error in enhanced document search: %s", e)
            return []

    def _dense_search(
        self,
        query: str,
        search_filters: Dict[str, Any],
        n_results: int,
        document_hint: str = None,
        document_references: Sequence[str] = (),
    ) -> List[Dict[str, Any]]:
        """Run the existing vector search path, preserving document prioritization."""
        if document_hint or document_references:
            priority_filename = document_hint or (document_references[0] if document_references else None)
            if priority_filename:
                try:
                    priority_results = self._search_with_filters(
                        query,
                        {
                            "$and": [
                                search_filters,
                                {"filename": priority_filename},
                            ]
                        },
                        n_results=min(3, n_results),
                    )
                except Exception as exc:
                    logger.info(
                        "Document-priority search skipped for hint %r: %s",
                        priority_filename,
                        exc,
                    )
                    priority_results = []

                remaining_results = max(0, n_results - len(priority_results))
                if remaining_results <= 0:
                    return priority_results

                general_results = self._search_with_filters(
                    query,
                    search_filters,
                    n_results=remaining_results + 2,
                )
                return priority_results + [
                    result for result in general_results
                    if result["metadata"].get("filename") != priority_filename
                ][:remaining_results]

        return self._search_with_filters(query, search_filters, n_results)

    def _search_with_filters(self, query: str, filters: Dict, n_results: int) -> List[Dict[str, Any]]:
        """Helper method for filtered dense search."""
        results = self.collection.query(
            query_texts=[query],
            n_results=n_results,
            where=filters,
        )

        formatted_results = []
        if results["documents"] and results["documents"][0]:
            for i, (doc, metadata, distance) in enumerate(zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            )):
                similarity_score = 1 / (1 + abs(distance)) if distance is not None else 0.5

                formatted_results.append({
                    "text": doc,
                    "metadata": metadata,
                    "relevance_score": similarity_score,
                    "dense_score": similarity_score,
                    "distance": distance,
                    "rank": i + 1,
                })

        return formatted_results

    def _sparse_search(
        self,
        query: str,
        session_id: str,
        n_results: int,
    ) -> List[Dict[str, Any]]:
        """BM25-style sparse retrieval over the session's stored chunks."""
        try:
            session_chunks = self.collection.get(
                where={"session_id": session_id},
                include=["documents", "metadatas"],
            )
        except Exception as exc:
            logger.debug("Sparse retrieval skipped: %s", exc)
            return []

        documents = session_chunks.get("documents") or []
        metadatas = session_chunks.get("metadatas") or []
        if not documents:
            return []

        query_tokens = self._tokenize_for_sparse(query)
        if not query_tokens:
            return []

        doc_tokens = [self._tokenize_for_sparse(doc or "") for doc in documents]
        doc_lengths = [len(tokens) for tokens in doc_tokens]
        avgdl = sum(doc_lengths) / max(len(doc_lengths), 1)
        document_frequency = Counter()
        for tokens in doc_tokens:
            document_frequency.update(set(tokens))

        raw_scores: List[float] = []
        query_term_counts = Counter(query_tokens)
        total_docs = len(doc_tokens)
        for tokens, doc_len in zip(doc_tokens, doc_lengths):
            term_counts = Counter(tokens)
            score = 0.0
            for term, query_freq in query_term_counts.items():
                term_freq = term_counts.get(term, 0)
                if term_freq <= 0:
                    continue
                df = document_frequency.get(term, 0)
                idf = math.log(1 + (total_docs - df + 0.5) / (df + 0.5))
                denominator = (
                    term_freq
                    + BM25_K1 * (1 - BM25_B + BM25_B * doc_len / max(avgdl, 1))
                )
                score += query_freq * idf * (term_freq * (BM25_K1 + 1)) / denominator
            raw_scores.append(score)

        max_score = max(raw_scores) if raw_scores else 0.0
        if max_score <= 0:
            return []

        sparse_results = []
        for doc, metadata, raw_score in zip(documents, metadatas, raw_scores):
            if raw_score <= 0:
                continue
            sparse_score = raw_score / max_score
            sparse_results.append({
                "text": doc,
                "metadata": metadata,
                "relevance_score": sparse_score,
                "sparse_score": sparse_score,
                "sparse_score_raw": raw_score,
                "distance": None,
                "rank": 0,
            })

        sparse_results.sort(key=lambda result: result["sparse_score"], reverse=True)
        return sparse_results[:n_results]

    def _merge_hybrid_results(
        self,
        dense_results: List[Dict[str, Any]],
        sparse_results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Merge dense and sparse candidates, then compute one hybrid score."""
        merged: Dict[tuple, Dict[str, Any]] = {}

        for result in dense_results:
            item = dict(result)
            item["dense_score"] = float(item.get("dense_score", item.get("relevance_score", 0.0)))
            item.setdefault("sparse_score", 0.0)
            merged[self._chunk_key(item.get("metadata", {}))] = item

        for result in sparse_results:
            key = self._chunk_key(result.get("metadata", {}))
            if key in merged:
                merged[key]["sparse_score"] = max(
                    float(merged[key].get("sparse_score", 0.0)),
                    float(result.get("sparse_score", 0.0)),
                )
                merged[key]["sparse_score_raw"] = result.get("sparse_score_raw")
            else:
                item = dict(result)
                item.setdefault("dense_score", 0.0)
                merged[key] = item

        scored_results: List[Dict[str, Any]] = []
        for result in merged.values():
            dense_score = float(result.get("dense_score", 0.0))
            sparse_score = float(result.get("sparse_score", 0.0))
            result["relevance_score"] = max(dense_score, sparse_score)
            result["retrieval_strategy"] = self._retrieval_strategy(result)
            scored_results.append(result)

        scored_results.sort(key=lambda result: result["relevance_score"], reverse=True)
        return scored_results

    def _include_boundary_adjacent_chunks(
        self,
        results: List[Dict[str, Any]],
        session_id: str,
    ) -> List[Dict[str, Any]]:
        """Add neighboring chunks when a retrieved chunk starts/ends mid-sentence."""
        expanded: List[Dict[str, Any]] = []
        seen = set()

        for result in results:
            key = self._chunk_key(result.get("metadata", {}))
            if key not in seen:
                expanded.append(result)
                seen.add(key)

            for offset in self._needed_adjacent_offsets(result.get("text", "")):
                neighbor = self._fetch_adjacent_chunk(result, session_id, offset)
                if not neighbor:
                    continue
                neighbor_key = self._chunk_key(neighbor.get("metadata", {}))
                if neighbor_key in seen:
                    continue
                expanded.append(neighbor)
                seen.add(neighbor_key)

        return expanded

    def _needed_adjacent_offsets(self, text: str) -> List[int]:
        offsets: List[int] = []
        stripped = (text or "").strip()
        if not stripped:
            return offsets

        if stripped[0].islower():
            offsets.append(-1)
        if stripped[-1] not in TERMINAL_SENTENCE_CHARS:
            offsets.append(1)
        return offsets

    def _fetch_adjacent_chunk(
        self,
        result: Dict[str, Any],
        session_id: str,
        offset: int,
    ) -> Dict[str, Any]:
        metadata = result.get("metadata", {})
        filename = metadata.get("filename")
        chunk_index = metadata.get("chunk_index")
        total_chunks = metadata.get("total_chunks")
        if filename is None or chunk_index is None:
            return {}

        neighbor_index = int(chunk_index) + offset
        if neighbor_index < 0:
            return {}
        if total_chunks is not None and neighbor_index >= int(total_chunks):
            return {}

        try:
            neighbor_results = self.collection.get(
                where={
                    "$and": [
                        {"session_id": session_id},
                        {"filename": filename},
                        {"chunk_index": neighbor_index},
                    ]
                },
                include=["documents", "metadatas"],
                limit=1,
            )
        except Exception as exc:
            logger.debug(
                "Could not fetch adjacent chunk %s for %s: %s",
                neighbor_index,
                filename,
                exc,
            )
            return {}

        documents = neighbor_results.get("documents") or []
        metadatas = neighbor_results.get("metadatas") or []
        if not documents or not metadatas:
            return {}

        parent_score = float(result.get("relevance_score", 0.0))
        return {
            "text": documents[0],
            "metadata": metadatas[0],
            "relevance_score": max(parent_score - 0.01, 0.0),
            "dense_score": result.get("dense_score", 0.0),
            "sparse_score": result.get("sparse_score", 0.0),
            "distance": result.get("distance"),
            "rank": result.get("rank"),
            "adjacent_context": True,
            "adjacent_to_chunk_index": chunk_index,
            "retrieval_strategy": "adjacent_context",
        }

    def _extract_document_references(self, query: str) -> List[str]:
        """Extract potential document name references from user query."""
        patterns = [
            r"(?:my|the|in)\s+([a-zA-Z_\-]+\.(?:pdf|docx|txt|doc))",
            r"(?:my|the)\s+(dissertation|thesis|proposal|chapter|paper|manuscript)",
            r"(?:in|from)\s+(?:my\s+)?([a-zA-Z_\-\s]+(?:chapter|section|proposal))",
            r"(?:the|my)\s+([a-zA-Z_\-\s]+(?:document|file))",
        ]

        references = []
        query_lower = query.lower()

        for pattern in patterns:
            matches = re.findall(pattern, query_lower)
            references.extend(matches)

        cleaned_references = []
        for ref in references:
            cleaned = ref.strip().replace(" ", "_")
            if len(cleaned) > 2:
                cleaned_references.append(cleaned)

        return cleaned_references[:3]

    def _tokenize_for_sparse(self, text: str) -> List[str]:
        return [
            token
            for token in re.findall(r"[a-z0-9#]+", (text or "").lower())
            if token not in QUERY_STOPWORDS
        ]

    def _retrieval_strategy(self, result: Dict[str, Any]) -> str:
        has_dense = float(result.get("dense_score", 0.0)) > 0
        has_sparse = float(result.get("sparse_score", 0.0)) > 0
        if has_dense and has_sparse:
            return "hybrid"
        if has_sparse:
            return "sparse"
        if has_dense:
            return "dense"
        return "scored"

    def _chunk_key(self, metadata: Dict[str, Any]):
        return (
            metadata.get("session_id"),
            metadata.get("filename"),
            metadata.get("chunk_index"),
        )

    def _enhance_search_results(self, results: List[Dict], original_query: str) -> List[Dict[str, Any]]:
        """Enhance search results with better attribution and context."""
        enhanced = []

        for result in results:
            metadata = result["metadata"]

            enhanced_result = {
                **result,
                "document_source": {
                    "file_id": metadata.get("source_document_id", ""),
                    "filename": metadata.get("filename", "unknown"),
                    "file_type": metadata.get("file_type", "unknown"),
                    "document_title": metadata.get("document_title", metadata.get("filename", "unknown")),
                    "section": metadata.get("document_section", "unknown"),
                    "heading": metadata.get("document_heading", ""),
                    "page_number": int(metadata.get("page_number") or 0),
                    "slide_number": int(metadata.get("slide_number") or 0),
                    "version_or_upload_date": metadata.get("source_updated_at", ""),
                    "open_route": metadata.get("source_route", ""),
                    "chunk_position": f"{metadata.get('chunk_index', 0) + 1} of {metadata.get('total_chunks', 1)}",
                },
                "content_type": metadata.get("chunk_type", "content"),
                "context_indicators": {
                    "has_methodology": metadata.get("has_methodology", False),
                    "has_theory": metadata.get("has_theory", False),
                    "has_references": metadata.get("has_references", False),
                },
                "adjacent_context": result.get("adjacent_context", False),
                "retrieval_strategy": result.get("retrieval_strategy", "scored"),
                "dense_score": result.get("dense_score", 0.0),
                "sparse_score": result.get("sparse_score", 0.0),
            }

            enhanced.append(enhanced_result)

        enhanced.sort(key=lambda x: (
            1.0 if any(ref in x["document_source"]["filename"].lower()
                       for ref in self._extract_document_references(original_query)) else 0.0,
            x["relevance_score"],
        ), reverse=True)

        return enhanced
