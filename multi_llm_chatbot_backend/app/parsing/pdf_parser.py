"""PDF parser — prefers PyMuPDF, falls back to PyPDF2.

Modeled on TrustRAG's ``pdf_parser_fast.py``. The MinerU-based deep
parser is intentionally not ported (heavy ML stack).
"""

from __future__ import annotations

import logging
from io import BytesIO

import PyPDF2

from app.parsing.base import BaseParser

logger = logging.getLogger(__name__)


class PdfParser(BaseParser):
    """Extract text from a PDF using PyMuPDF, with a PyPDF2 fallback."""

    def parse(self, file_bytes: bytes) -> str:
        try:
            import fitz  # type: ignore  # PyMuPDF

            text_parts = []
            with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                for page in doc:
                    page_text = page.get_text("text")
                    if page_text:
                        text_parts.append(page_text)
            joined = "\n".join(text_parts).strip()
            if joined:
                return joined
            logger.info("PyMuPDF returned empty text; falling back to PyPDF2")
        except ImportError:
            logger.debug("PyMuPDF (fitz) not installed; using PyPDF2")
        except Exception as e:
            logger.warning(f"PyMuPDF failed ({e}); falling back to PyPDF2")

        reader = PyPDF2.PdfReader(BytesIO(file_bytes))
        return "\n".join(page.extract_text() for page in reader.pages if page.extract_text())
