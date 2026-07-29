"""Document-aware context building for persona responses.

Extracted from ``ImprovedChatOrchestrator``: turns a user query plus a
persona into RAG-grounded prompt context. Handles document retrieval,
relevance filtering, source attribution, and assembling the final
message list passed to the LLM.
"""

import json
import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Optional

from app.advisor_skills import get_advisor_skill
from app.core.context_manager import get_context_manager
from app.llm.clients.llm_client import LLMClient
from app.rag.manager import get_rag_manager

logger = logging.getLogger(__name__)

CONVERSATION_RESPONSE_RESERVE_TOKENS = 500
CONVERSATION_SUMMARY_MIN_TOKENS = 250
CONVERSATION_SUMMARY_MAX_TOKENS = 800
CONVERSATION_SUMMARY_RATIO = 0.25
RAG_QUERY_KEYWORD_LIMIT = 12
RAG_QUERY_REWRITE_MAX_TOKENS = 120
APPLICATION_CONTEXT_MAX_TOKENS = 1200
KNOWLEDGE_CONTEXT_MAX_TOKENS = 700
DOCUMENT_CONTEXT_MAX_TOKENS = 3200
MIN_APPLICATION_CONTEXT_TOKENS = 400
PROMPT_STRUCTURE_RESERVE_TOKENS = 160

StageCallback = Callable[[str, Dict[str, str]], Awaitable[None]]

@dataclass
class ConversationContext:
    """Conversation history prepared for the prompt budget."""

    messages: List[Dict[str, str]]
    summary: str = ""
    compacted: bool = False


class PreparedPersonaContext(list):
    """A fully budgeted chat prompt plus evidence that survived budgeting."""

    def __init__(
        self,
        messages: List[Dict[str, str]],
        included_document_context: str = "",
        retrieved_document_context: str = "",
    ):
        super().__init__(messages)
        self.included_document_context = included_document_context
        self.retrieved_document_context = retrieved_document_context


class PersonaContextBuilder:
    """Builds document-grounded prompt context for a persona response."""

    def __init__(
        self,
        max_context_tokens: Optional[int] = None,
        chars_per_token: Optional[float] = None,
    ):
        context_manager = get_context_manager()
        self.max_context_tokens = max_context_tokens or context_manager.max_context_tokens
        self.chars_per_token = chars_per_token or context_manager.chars_per_token

    async def retrieve_relevant_documents(
        self,
        user_input: str,
        session_id: str,
        persona_id: str = "",
        llm_client: Optional[LLMClient] = None,
        on_stage: Optional[StageCallback] = None,
    ) -> str:
        """
        Enhanced document retrieval with document awareness and better attribution
        """
        try:
            # Add comprehensive logging to track session ID usage
            logger.info(f"Retrieving documents for session_id: {session_id}")
            logger.info(f"User input: {user_input[:100]}...")

            await self._emit_stage(on_stage, "rag_checking_documents")
            rag_manager = get_rag_manager()

            # Check what documents are available for this session with detailed logging
            doc_stats = rag_manager.get_document_stats(session_id)
            logger.info(f"Available documents for {session_id}: {doc_stats.get('total_documents', 0)} documents, {doc_stats.get('total_chunks', 0)} chunks")

            # Log document details for debugging
            if doc_stats.get('documents'):
                for doc in doc_stats['documents']:
                    logger.info(f"  - Document: {doc.get('filename', 'unknown')} ({doc.get('chunks', 0)} chunks)")

            # If no documents found and this looks like a chat session, log warning
            if doc_stats.get('total_documents', 0) == 0:
                if session_id.startswith('chat_'):
                    logger.warning(f"No documents found for chat session {session_id} - this may indicate session ID mismatch during upload")

                    # Try alternative session ID formats for debugging
                    alternative_formats = [
                        session_id.replace('chat_', ''),  # Remove chat_ prefix
                        session_id,  # Keep as is
                    ]

                    for alt_session_id in alternative_formats:
                        if alt_session_id != session_id:
                            alt_stats = rag_manager.get_document_stats(alt_session_id)
                            if alt_stats.get('total_documents', 0) > 0:
                                logger.warning(f"Found documents under alternative session ID {alt_session_id}: {alt_stats}")
                else:
                    logger.info(f"No documents found for new session {session_id} - this is normal for new chats")

                return ""  # No documents available

            # Extract document hints from user query
            document_hint = self._extract_document_hint_from_query(user_input)
            logger.info(
                "Document filename hint extracted from query: %r",
                document_hint,
            )

            search_query = await self._build_llm_retrieval_query(
                user_input,
                llm_client,
                on_stage,
            )

            # Search for relevant chunks with document awareness
            await self._emit_stage(on_stage, "rag_retrieving")
            logger.info("Searching documents with query: %r", search_query)
            relevant_chunks = rag_manager.search_documents_with_context(
                query=search_query,
                session_id=session_id,
                n_results=6,
                document_hint=document_hint
            )

            logger.info(f"Retrieved {len(relevant_chunks)} chunks for {persona_id}")

            # Log relevance scores for debugging
            if relevant_chunks:
                for i, chunk in enumerate(relevant_chunks):
                    relevance = chunk.get("relevance_score", 0)
                    doc_source = chunk.get("document_source", {})
                    filename = doc_source.get("filename", "unknown")
                    logger.info(f"  Chunk {i+1}: {filename} (relevance: {relevance:.3f})")

            if not relevant_chunks:
                logger.info(f"No relevant document chunks found for query: {user_input[:50]}...")
                return ""

            # Format retrieved content with enhanced attribution
            await self._emit_stage(on_stage, "rag_building_context")
            formatted_context = self._format_document_context_with_attribution(relevant_chunks, persona_id)

            # Log final context length
            logger.info(f"Final document context length: {len(formatted_context)} characters")

            return formatted_context

        except Exception as e:
            logger.error(f"Error retrieving documents for {persona_id} in session {session_id}: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return ""

    async def _emit_stage(
        self,
        on_stage: Optional[StageCallback],
        phase: str,
        **data: str,
    ) -> None:
        if on_stage:
            await on_stage(phase, data)

    async def _build_llm_retrieval_query(
        self,
        user_input: str,
        llm_client: Optional[LLMClient],
        on_stage: Optional[StageCallback],
    ) -> str:
        """Ask the LLM for retrieval keywords and append them to the user query."""
        original_query = re.sub(r"\s+", " ", user_input or "").strip()
        if not original_query or llm_client is None:
            return original_query

        await self._emit_stage(on_stage, "rag_rewriting_query")
        try:
            keyword_text = await llm_client.generate(
                system_prompt=(
                    "Extract concise retrieval keywords for searching uploaded documents. "
                    "Return only a comma-separated list of important words or short phrases. "
                    "Preserve exact labels, numbers, acronyms, and quoted terms. "
                    "Do not answer the question and do not explain."
                ),
                context=[{
                    "role": "user",
                    "content": f"Question:\n{original_query}",
                }],
                temperature=0.0,
                max_tokens=RAG_QUERY_REWRITE_MAX_TOKENS,
            )
        except Exception as exc:
            logger.warning("RAG query keyword extraction failed: %s", exc)
            return original_query

        keywords = self._parse_retrieval_keywords(keyword_text)
        if not keywords:
            logger.info("RAG query keyword extraction returned no usable keywords")
            return original_query

        rewritten_query = f"{original_query} {' '.join(keywords)}"
        logger.info(
            "RAG LLM retrieval query: original=%r keywords=%s search_query=%r",
            original_query,
            keywords,
            rewritten_query,
        )
        return rewritten_query

    def _parse_retrieval_keywords(self, keyword_text: str) -> List[str]:
        text = (keyword_text or "").strip()
        if not text:
            return []

        raw_items: List[str]
        try:
            parsed = json.loads(text)
            raw_items = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            raw_items = re.split(r"[,;\n]+", text)

        keywords: List[str] = []
        seen = set()
        for item in raw_items:
            cleaned = re.sub(r"^\s*[-*\d.)]+\s*", "", str(item or "")).strip()
            cleaned = cleaned.strip("\"'`[]{}() ")
            cleaned = re.sub(r"\s+", " ", cleaned)
            if not cleaned or len(cleaned) > 80:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            keywords.append(cleaned)
            if len(keywords) >= RAG_QUERY_KEYWORD_LIMIT:
                break
        return keywords

    def _extract_document_hint_from_query(self, query: str) -> Optional[str]:
        """
        Extract document name hints from user queries
        """
        import re

        query_lower = query.lower()

        # Common patterns for document references
        document_indicators = [
            r"(?:my|the|in|from)\s+([a-zA-Z_\-]+\.(?:pdf|docx|txt|doc))",  # specific files
            r"(?:my|the)\s+(dissertation|thesis|proposal|chapter|manuscript|paper)",  # document types
            r"(?:in|from)\s+(?:my\s+)?([a-zA-Z_\-\s]+(?:chapter|section|proposal))",  # sections
            r"(?:the|my)\s+([a-zA-Z_\-\s]+(?:document|file))",  # generic documents
        ]

        for pattern in document_indicators:
            matches = re.findall(pattern, query_lower)
            if matches:
                return matches[0].strip().replace(" ", "_")

        return None

    def _format_document_context_with_attribution(self, chunks: List[Dict], persona_id: str) -> str:
        """
        Format document context with clear attribution and source information.

        Chunk positions and relevance scores are intentionally omitted from the
        prompt text because models tend to repeat those internal labels back to
        users as citations like "(Part 12)".
        """
        if not chunks:
            return ""

        # Filter chunks by relevance (increased threshold for quality)
        high_quality_chunks = [
            chunk for chunk in chunks
            if chunk.get("relevance_score", 0) > 0.4  # Increased from 0.3
        ]

        if not high_quality_chunks:
            # If no high-quality chunks, take top 2 anyway but with lower confidence
            high_quality_chunks = chunks[:2]

        formatted_sections = []

        # Group chunks by document for better organization
        documents = {}
        for chunk in high_quality_chunks:
            doc_source = chunk.get("document_source", {})
            filename = doc_source.get("filename", "unknown")
            document_key = doc_source.get("file_id") or filename

            if document_key not in documents:
                documents[document_key] = {
                    "filename": filename,
                    "title": doc_source.get("document_title", filename),
                    "source": doc_source,
                    "chunks": []
                }
            documents[document_key]["chunks"].append(chunk)

        # Format each document's content
        for doc_data in documents.values():
            filename = doc_data["filename"]
            doc_title = doc_data["title"]
            doc_chunks = doc_data["chunks"]
            source = doc_data["source"]
            source_metadata = {
                "file_id": source.get("file_id", ""),
                "file_type": source.get("file_type", "unknown"),
                "filename": filename,
                "title": doc_title,
                "page_numbers": sorted({
                    int(chunk.get("document_source", {}).get("page_number") or 0)
                    for chunk in doc_chunks
                    if int(chunk.get("document_source", {}).get("page_number") or 0) > 0
                }),
                "slide_numbers": sorted({
                    int(chunk.get("document_source", {}).get("slide_number") or 0)
                    for chunk in doc_chunks
                    if int(chunk.get("document_source", {}).get("slide_number") or 0) > 0
                }),
                "sections": list(dict.fromkeys(
                    chunk.get("document_source", {}).get("heading")
                    or chunk.get("document_source", {}).get("section")
                    for chunk in doc_chunks
                    if (
                        chunk.get("document_source", {}).get("heading")
                        or chunk.get("document_source", {}).get("section")
                    ) not in ("", "unknown", "content")
                    and not re.match(
                        r"^(?:Page|Slide)\s+\d+$",
                        str(
                            chunk.get("document_source", {}).get("heading")
                            or ""
                        ),
                        flags=re.IGNORECASE,
                    )
                )),
                "version_or_upload_date": source.get("version_or_upload_date", ""),
                "open_route": source.get("open_route", ""),
            }

            formatted_sections.append(f"=== FROM DOCUMENT: {doc_title} ===")
            formatted_sections.append(
                "=== SOURCE METADATA: "
                + json.dumps(source_metadata, ensure_ascii=False, separators=(",", ":"))
                + " ==="
            )

            for chunk in doc_chunks:
                chunk_intro = "[Document excerpt]"
                chunk_text = self._format_chunk_text_for_prompt(chunk.get("text", ""))
                formatted_sections.append(f"{chunk_intro}\n{chunk_text}\n")

        # Add context summary
        total_docs = len(documents)
        total_chunks = len(high_quality_chunks)

        context_header = f"""
DOCUMENT CONTEXT FOR {persona_id.upper()} ANALYSIS:
Found {total_chunks} relevant passages from {total_docs} document(s).
Use this context to inform your response. When referencing information from documents, cite the document by name only; do not mention internal passage labels, chunk numbers, positions, or relevance scores.

"""

        formatted_context = context_header + "\n".join(formatted_sections)

        # Add instructions specific to persona
        persona_instructions = self._get_persona_document_instructions(persona_id)
        formatted_context += f"\n\nSPECIAL INSTRUCTIONS FOR {persona_id.upper()}:\n{persona_instructions}"

        return formatted_context

    def _format_chunk_text_for_prompt(self, text: str) -> str:
        """Make flattened table-like passages easier for the model to read."""
        compact_text = re.sub(r"\s+", " ", text or "").strip()
        if not self._looks_like_flat_numbered_table(compact_text):
            return text

        def separator(match: re.Match) -> str:
            prefix = compact_text[max(0, match.start() - 20):match.start()].lower()
            if re.search(r"\b(table|figure|page|part|section|category)\s*$", prefix):
                return match.group(0)
            return f" | {match.group(1)}"

        return re.sub(r"\s+(\d+\.\s+)", separator, compact_text)

    def _looks_like_flat_numbered_table(self, text: str) -> bool:
        row_markers = re.findall(r"\b\d+\.\s+\S", text or "")
        if len(row_markers) < 2:
            return False
        return bool(
            re.search(r"\b\d+\s+(?:minutes?|hours?|days?)\b", text, flags=re.IGNORECASE)
            or re.search(r"\bdata\s+exists\b", text, flags=re.IGNORECASE)
        )

    def _get_persona_document_instructions(self, persona_id: str) -> str:
        """
        Get persona-specific instructions for handling document context
        """
        instructions = {
            "methods_evidence": """
When analyzing the document context:
- Focus on design, evidence, analysis, and inference fit
- Identify validity, reliability, sampling, and ethical issues
- Reference the source document by name when using it""",

            "theory_framing": """
When analyzing the document context:
- Focus on concepts, assumptions, literature positioning, and contribution
- Identify unclear constructs and theoretical inconsistencies
- Reference the source document by name when using it""",

            "methodologist": """
When analyzing the document context:
- Focus on methodological rigor and research design elements
- Identify potential validity threats or methodological gaps
- Suggest specific improvements to research procedures
- Reference exact methodological frameworks mentioned in their documents
- Connect their approach to established research standards""",

            "theorist": """
When analyzing the document context:
- Examine theoretical positioning and conceptual clarity
- Identify theoretical gaps or inconsistencies
- Suggest theoretical frameworks that align with their work
- Evaluate the coherence between theory and research questions
- Reference specific theoretical concepts mentioned in their documents""",

            "pragmatist": """
When analyzing the document context:
- Extract actionable next steps from their current progress
- Identify immediate bottlenecks or decision points
- Prioritize tasks based on their timeline and constraints
- Translate theoretical concepts into practical implementation steps
- Reference specific deadlines or milestones mentioned in their documents"""
        }

        return instructions.get(persona_id, "Provide helpful guidance based on the document context.")

    async def build_enhanced_context_for_persona(
        self,
        session,
        persona,
        user_message: str,
        document_context: str,
        response_length: str = "medium",
        advisor_skill=None,
    ) -> PreparedPersonaContext:
        """Build the final chat prompt once, with explicit category budgets."""
        skill = get_advisor_skill(
            getattr(advisor_skill, "id", advisor_skill) or "quick_advice"
        )
        instruction_text = (
            f"{persona.system_prompt}\n\n"
            f"{skill.prompt_contract(response_length, '<END_RESPONSE>')}"
        )
        instruction_tokens = self._estimate_tokens(instruction_text)
        output_reserve = skill.max_tokens(response_length)
        latest_question_tokens = self._estimate_tokens(user_message) + 20
        available = max(
            0,
            self.max_context_tokens
            - instruction_tokens
            - output_reserve
            - latest_question_tokens
            - PROMPT_STRUCTURE_RESERVE_TOKENS,
        )

        student_context = (getattr(session, "student_context_prompt", "") or "").strip()
        knowledge_context = (getattr(session, "knowledge_context_prompt", "") or "").strip()

        # Document evidence is the highest-priority dynamic category. Preserve a
        # compact application frame, then give retrieved evidence a hard bound.
        minimum_app = min(
            MIN_APPLICATION_CONTEXT_TOKENS,
            self._estimate_tokens(student_context),
            available,
        )
        document_budget = min(
            DOCUMENT_CONTEXT_MAX_TOKENS,
            max(0, available - minimum_app),
        )
        included_document_context = self._fit_document_context(
            document_context,
            document_budget,
        )
        available -= self._estimate_tokens(included_document_context)

        application_budget = min(APPLICATION_CONTEXT_MAX_TOKENS, available)
        included_student_context = self._clip_to_token_budget(
            student_context,
            application_budget,
        )
        available -= self._estimate_tokens(included_student_context)

        knowledge_budget = min(KNOWLEDGE_CONTEXT_MAX_TOKENS, available)
        included_knowledge_context = self._clip_to_token_budget(
            knowledge_context,
            knowledge_budget,
        )
        available -= self._estimate_tokens(included_knowledge_context)

        conversation_messages = [
            {
                "role": message.get("role", "assistant"),
                "content": str(message.get("content", "")),
            }
            for message in getattr(session, "messages", [])
            if message.get("role") != "system" and str(message.get("content", "")).strip()
        ]
        latest_index = next(
            (
                index
                for index in range(len(conversation_messages) - 1, -1, -1)
                if conversation_messages[index]["role"] == "user"
                and conversation_messages[index]["content"] == user_message
            ),
            None,
        )
        history_messages = (
            conversation_messages[:latest_index]
            if latest_index is not None
            else conversation_messages
        )
        conversation_context = self._prepare_messages_context(
            history_messages,
            available,
        )

        blocks = []
        if included_student_context:
            blocks.append(
                "STUDENT PROFILE AND RELEVANT PLAN CONTEXT:\n"
                f"{included_student_context}\n\n"
                "Use the current milestone as status context, not as the only "
                "knowledge source. Interpret ambiguous references to what is "
                "next or where the student is as referring to that milestone."
            )
        if included_knowledge_context:
            blocks.append(included_knowledge_context)
        if included_document_context:
            blocks.append(
                "REQUIRED DOCUMENT EVIDENCE:\n"
                f"{included_document_context}\n\n"
                "Use the evidence above when the question concerns the student's "
                "documents. Cite document names only; do not expose internal "
                "chunk labels, positions, or relevance scores."
            )
        elif getattr(session, "uploaded_files", []):
            blocks.append(
                "Documents exist in the student's library, but no relevant "
                "document passages fit this answer context. Do not imply that "
                "you reviewed their contents."
            )
        else:
            blocks.append(
                "No uploaded documents are available. Do not invent document "
                "contents or names."
            )
        if conversation_context.summary:
            blocks.append(conversation_context.summary)

        messages = [{
            "role": "system",
            "content": "\n\n".join(blocks),
            "_context_budgeted": True,
        }]
        messages.extend(conversation_context.messages)
        messages.append({"role": "user", "content": user_message})
        return PreparedPersonaContext(
            messages,
            included_document_context=included_document_context,
            retrieved_document_context=document_context,
        )

    def _clip_to_token_budget(self, text: str, token_budget: int) -> str:
        if token_budget <= 0 or not text:
            return ""
        char_budget = max(0, int(token_budget * self.chars_per_token))
        if len(text) <= char_budget:
            return text.strip()
        return text[:char_budget].rsplit("\n", 1)[0].rstrip()

    def _fit_document_context(self, document_context: str, token_budget: int) -> str:
        """Bound evidence while retaining at least one excerpt per retrieved source."""
        if token_budget <= 0 or not document_context.strip():
            return ""
        char_budget = int(token_budget * self.chars_per_token)
        if len(document_context) <= char_budget:
            return document_context.strip()

        matches = list(re.finditer(
            r"=== FROM DOCUMENT:\s*(.+?)\s*===",
            document_context,
        ))
        if not matches:
            return self._clip_to_token_budget(document_context, token_budget)

        prefix = document_context[:matches[0].start()].strip()
        blocks = []
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(document_context)
            blocks.append(document_context[match.start():end].strip())

        prefix_budget = min(len(prefix), 700)
        remaining = max(0, char_budget - prefix_budget - (2 * len(blocks)))
        per_block = max(240, remaining // max(1, len(blocks)))
        selected = [prefix[:prefix_budget]] if prefix else []
        for block in blocks:
            selected.append(block[:per_block].rstrip())
        return "\n\n".join(part for part in selected if part).strip()[:char_budget]

    def _prepare_messages_context(
        self,
        messages: List[Dict[str, str]],
        token_budget: int,
    ) -> ConversationContext:
        if not messages or token_budget <= 0:
            return ConversationContext(messages=[])
        if self._estimate_messages_tokens(messages) <= token_budget:
            return ConversationContext(messages=messages)

        summary_budget = self._conversation_summary_budget(token_budget)
        recent_budget = max(0, token_budget - summary_budget)
        recent_messages = self._take_recent_messages_by_budget(
            messages,
            recent_budget,
        )
        older_count = len(messages) - len(recent_messages)
        summary = self._summarize_messages_by_tokens(
            messages[:older_count],
            summary_budget,
        )
        return ConversationContext(
            messages=recent_messages,
            summary=summary,
            compacted=True,
        )

    def _prepare_conversation_context(
        self,
        messages: List[Dict[str, str]],
        base_system_message: str,
    ) -> ConversationContext:
        """Keep full history when it fits; otherwise summarize older turns."""
        conversation_messages = [
            {
                "role": message.get("role", "assistant"),
                "content": str(message.get("content", "")),
            }
            for message in messages
            if message.get("role") != "system" and str(message.get("content", "")).strip()
        ]
        available_tokens = (
            self.max_context_tokens
            - self._estimate_tokens(base_system_message)
            - CONVERSATION_RESPONSE_RESERVE_TOKENS
        )
        available_tokens = max(0, available_tokens)
        return self._prepare_messages_context(
            conversation_messages,
            available_tokens,
        )

    def _take_recent_messages_by_budget(
        self,
        messages: List[Dict[str, str]],
        token_budget: int,
    ) -> List[Dict[str, str]]:
        """Walk backward from the latest turn and keep as much exact text as fits."""
        selected: List[Dict[str, str]] = []
        used_tokens = 0

        for message in reversed(messages):
            message_tokens = self._estimate_message_tokens(message)
            if selected and used_tokens + message_tokens > token_budget:
                break
            if not selected and message_tokens > token_budget:
                selected.insert(0, message)
                break
            selected.insert(0, message)
            used_tokens += message_tokens

        return selected

    def _conversation_summary_budget(self, available_tokens: int) -> int:
        """Allocate part of the conversation budget to the older-history summary."""
        if available_tokens <= 0:
            return 0
        proportional_budget = int(available_tokens * CONVERSATION_SUMMARY_RATIO)
        return max(
            CONVERSATION_SUMMARY_MIN_TOKENS,
            min(CONVERSATION_SUMMARY_MAX_TOKENS, proportional_budget),
        )

    def _summarize_messages_by_tokens(
        self,
        messages: List[Dict[str, str]],
        token_budget: int,
    ) -> str:
        """Create a compact chronological summary without a second LLM call."""
        if not messages or token_budget <= 0:
            return ""

        char_budget = max(0, int(token_budget * self.chars_per_token))
        header = (
            "EARLIER CONVERSATION SUMMARY:\n"
            "Older turns were compacted because the full chat exceeded the prompt budget.\n"
        )
        if len(header) >= char_budget:
            return header[:char_budget].rstrip()

        summary_items = [
            (
                self._display_role(message.get("role", "assistant")),
                self._compact_whitespace(message.get("content", "")),
            )
            for message in messages
            if self._compact_whitespace(message.get("content", ""))
        ]
        lines = [header.rstrip()]
        remaining_chars = char_budget - len(header)

        for index, (role, content) in enumerate(summary_items):
            prefix = f"- {role}: "
            min_content_chars = 40
            if remaining_chars <= len(prefix) + min_content_chars:
                break

            remaining_items = max(1, len(summary_items) - index)
            fair_line_budget = max(
                len(prefix) + min_content_chars + 1,
                remaining_chars // remaining_items,
            )
            max_content_chars = min(
                remaining_chars - len(prefix) - 1,
                fair_line_budget - len(prefix) - 1,
            )
            line_content = self._truncate_chars(content, max_content_chars)
            line = f"{prefix}{line_content}"
            lines.append(line)
            remaining_chars -= len(line) + 1

        return "\n".join(lines).strip()

    def _estimate_messages_tokens(self, messages: List[Dict[str, str]]) -> int:
        return sum(self._estimate_message_tokens(message) for message in messages)

    def _estimate_message_tokens(self, message: Dict[str, str]) -> int:
        role_overhead_tokens = 4
        return self._estimate_tokens(message.get("content", "")) + role_overhead_tokens

    def _estimate_tokens(self, text: str) -> int:
        return int(len(str(text or "")) / self.chars_per_token)

    def _display_role(self, role: str) -> str:
        normalized = (role or "assistant").strip().lower()
        if normalized == "user":
            return "User"
        if normalized == "assistant":
            return "Assistant"
        return f"{normalized.title()} advisor"

    def _compact_whitespace(self, text: str) -> str:
        return " ".join(str(text or "").split())

    def _truncate_chars(self, text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        if limit <= 3:
            return text[:limit]
        return f"{text[:limit - 3].rstrip()}..."
