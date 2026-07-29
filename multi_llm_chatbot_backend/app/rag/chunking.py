"""Document chunking for the RAG pipeline.

Turns raw document text into clean, section-aware chunks ready for
embedding: whitespace/encoding preprocessing, document-level metadata
extraction, logical section splitting, and recursive character chunking
of large sections.
"""

import logging
import re
from typing import Any, Dict, List

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import get_settings

logger = logging.getLogger(__name__)

PROSE_CHUNK_SEPARATORS = [
    "\n\n",
    ". ",
    "? ",
    "! ",
    "; ",
    ": ",
    "\n",
    ", ",
    " ",
    "",
]


class DocumentChunker:
    """Preprocesses and chunks document text for the vector store."""

    def __init__(self):
        settings = get_settings()
        # Recursive character text splitter for document chunking
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.rag.chunk_size,
            chunk_overlap=settings.rag.chunk_overlap,
            separators=PROSE_CHUNK_SEPARATORS,
            keep_separator="end",
        )

    def preprocess_content(self, content: str) -> str:
        """Clean and preprocess document content"""
        content = content.replace("\r\n", "\n").replace("\r", "\n")

        # Remove page numbers and headers/footers
        content = re.sub(r'\n\s*\d+\s*\n', '\n', content)

        # Clean up encoding issues
        content = content.replace('\ufffd', ' ').replace('\\ufffd', ' ')

        # Normalize horizontal whitespace without erasing paragraph and line
        # boundaries; the recursive splitter depends on those boundaries.
        content = re.sub(r'[ \t\f\v]+', ' ', content)
        content = re.sub(r' *\n *', '\n', content)
        content = re.sub(r'\n{3,}', '\n\n', content)

        return content.strip()

    def extract_document_metadata(self, content: str, filename: str, file_type: str) -> Dict[str, Any]:
        """Extract metadata from document content"""
        lines = content.split('\n')

        # Try to find title (usually first significant line)
        title = filename
        for line in lines[:10]:
            if line.strip() and len(line.strip()) > 10 and len(line.strip()) < 100:
                if not line.strip().startswith(('Abstract', 'Introduction', '1.', 'Chapter')):
                    title = line.strip()
                    break

        # Extract other metadata
        word_count = len(content.split())
        has_sections = bool(re.search(r'(?:Chapter|Section|\d+\.)', content))

        return {
            "title": title,
            "word_count": word_count,
            "has_sections": has_sections,
            "file_type": file_type,
            "estimated_pages": word_count // 250  # Rough estimate
        }

    def create_chunks(self, content: str) -> List[Dict[str, Any]]:
        """Create intelligent, section-aware chunks with context preservation"""
        # Split into logical sections first
        sections = self._split_into_sections(content)

        chunks = []
        for section_data in sections:
            section_text = section_data["text"]
            section_type = section_data["type"]
            location = {
                "heading": section_data.get("heading", ""),
                "page_number": section_data.get("page_number", 0),
                "slide_number": section_data.get("slide_number", 0),
            }

            # Split large sections with the recursive character text splitter
            if len(section_text.split()) > 300:  # Large section, needs chunking
                section_chunks = self.text_splitter.split_text(section_text)
                for chunk_text in section_chunks:
                    chunk_type = "table_row" if self._looks_like_table_row(chunk_text) else "content"
                    chunks.append({
                        "text": chunk_text,
                        "section": section_type,
                        **location,
                        "type": chunk_type,
                        "keywords": self._extract_keywords(chunk_text)
                    })
            else:
                chunk_type = "table_row" if self._looks_like_table_row(section_text) else section_type
                # Small section, keep as single chunk
                chunks.append({
                    "text": section_text,
                    "section": section_type,
                    **location,
                    "type": chunk_type,
                    "keywords": self._extract_keywords(section_text)
                })

        return chunks

    def _split_into_sections(self, content: str) -> List[Dict[str, Any]]:
        """Split content into logical sections"""
        lines = content.split('\n')
        sections = []
        current_section = []
        current_type = "introduction"
        current_heading = ""
        current_page = 0
        current_slide = 0

        for line in lines:
            line = line.strip()
            if not line:
                continue

            page_match = re.match(r"^#\s*Page\s+(\d+)\s*$", line, re.IGNORECASE)
            slide_match = re.match(r"^#\s*Slide\s+(\d+)\s*$", line, re.IGNORECASE)
            if page_match or slide_match:
                if current_section:
                    sections.append({
                        "text": '\n'.join(current_section),
                        "type": current_type,
                        "heading": current_heading,
                        "page_number": current_page,
                        "slide_number": current_slide,
                    })
                    current_section = []
                if page_match:
                    current_page = int(page_match.group(1))
                    current_slide = 0
                    current_heading = f"Page {current_page}"
                else:
                    current_slide = int(slide_match.group(1))
                    current_page = 0
                    current_heading = f"Slide {current_slide}"
                current_type = "content"
                continue

            # Check if this line starts a new section
            section_match = re.match(
                r'^(?:(?:Chapter|Section)\s+.+|\d+\.\s+.+|\d+(?:\.\d+)+\.?\s+.+)$',
                line,
                re.IGNORECASE,
            )
            if section_match:
                # Save previous section
                if current_section:
                    sections.append({
                        "text": '\n'.join(current_section),
                        "type": current_type,
                        "heading": current_heading,
                        "page_number": current_page,
                        "slide_number": current_slide,
                    })

                # Start new section
                current_section = [line]
                current_heading = line
                section_title = line.lower()
                current_type = self._classify_section_type(section_title)
            else:
                current_section.append(line)

        # Add final section
        if current_section:
            sections.append({
                "text": '\n'.join(current_section),
                "type": current_type,
                "heading": current_heading,
                "page_number": current_page,
                "slide_number": current_slide,
            })

        return sections if sections else [{
            "text": content,
            "type": "content",
            "heading": "",
            "page_number": 0,
            "slide_number": 0,
        }]

    def _looks_like_table_row(self, text: str) -> bool:
        """Detect compact row-like chunks without assuming a table schema."""
        stripped = " ".join((text or "").split())
        if not stripped:
            return False
        if re.search(r"^\d+\.\s+", stripped):
            return True
        if re.search(r"\b\d+\s+(?:minutes?|hours?|days?)\b", stripped, flags=re.IGNORECASE):
            return True
        return False

    def _classify_section_type(self, section_title: str) -> str:
        """Classify section type based on title"""
        title_lower = section_title.lower()

        if any(word in title_lower for word in ['method', 'approach', 'design', 'procedure']):
            return "methodology"
        elif any(word in title_lower for word in ['theory', 'framework', 'literature', 'review']):
            return "theory"
        elif any(word in title_lower for word in ['result', 'finding', 'analysis', 'data']):
            return "results"
        elif any(word in title_lower for word in ['conclusion', 'discussion', 'implication']):
            return "conclusion"
        elif any(word in title_lower for word in ['introduction', 'background', 'abstract']):
            return "introduction"
        else:
            return "content"

    def _extract_keywords(self, text: str) -> str:
        """Extract key terms from text chunk"""
        # Simple keyword extraction - could be enhanced with NLP
        words = text.lower().split()

        # Academic keywords to prioritize
        academic_terms = set([
            'methodology', 'theory', 'analysis', 'research', 'study', 'data',
            'framework', 'approach', 'method', 'findings', 'results', 'literature',
            'hypothesis', 'experiment', 'survey', 'interview', 'observation',
            'qualitative', 'quantitative', 'mixed-methods', 'case study'
        ])

        found_keywords = [word for word in words if word in academic_terms]
        return ' '.join(found_keywords[:5])  # Top 5 keywords
