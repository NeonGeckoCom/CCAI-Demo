"""Dispatcher that picks the right per-format parser for an uploaded file.

The actual parsing logic lives in the sibling ``*_parser.py`` modules,
one per format — mirroring TrustRAG's ``trustrag/modules/document/``
layout. This module only handles dispatch (MIME type first, filename
extension fallback) and the short-label mapping used by the RAG layer.
"""

from __future__ import annotations

import os
from typing import Callable, Dict, Optional

from app.parsing.csv_parser import CsvParser
from app.parsing.docx_parser import DocxParser
from app.parsing.excel_parser import ExcelParser
from app.parsing.html_parser import HtmlParser
from app.parsing.json_parser import JsonParser
from app.parsing.markdown_parser import MarkdownParser
from app.parsing.pdf_parser import PdfParser
from app.parsing.ppt_parser import PptParser
from app.parsing.txt_parser import TxtParser

_pdf = PdfParser().parse
_docx = DocxParser().parse
_txt = TxtParser().parse
_md = MarkdownParser().parse
_html = HtmlParser().parse
_json = JsonParser().parse
_csv = CsvParser().parse
_xlsx = ExcelParser().parse
_pptx = PptParser().parse


_MIME_TO_EXTRACTOR: Dict[str, Callable[[bytes], str]] = {
    "application/pdf": _pdf,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": _docx,
    "application/msword": _docx,
    "text/plain": _txt,
    "text/markdown": _md,
    "text/x-markdown": _md,
    "text/html": _html,
    "application/xhtml+xml": _html,
    "application/json": _json,
    "text/csv": _csv,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": _xlsx,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": _pptx,
}

_EXT_TO_EXTRACTOR: Dict[str, Callable[[bytes], str]] = {
    ".pdf": _pdf,
    ".docx": _docx,
    ".doc": _docx,
    ".txt": _txt,
    ".md": _md,
    ".markdown": _md,
    ".html": _html,
    ".htm": _html,
    ".json": _json,
    ".csv": _csv,
    ".xlsx": _xlsx,
    ".pptx": _pptx,
}

MIME_TO_FILE_TYPE: Dict[str, str] = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "docx",
    "text/plain": "txt",
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "application/json": "json",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
}

EXT_TO_FILE_TYPE: Dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".txt": "txt",
    ".md": "markdown",
    ".markdown": "markdown",
    ".html": "html",
    ".htm": "html",
    ".json": "json",
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".pptx": "pptx",
}


def resolve_file_type(content_type: Optional[str], filename: Optional[str]) -> str:
    """Return a short type label (``pdf``, ``docx``, …) for RAG metadata."""
    if content_type and content_type in MIME_TO_FILE_TYPE:
        return MIME_TO_FILE_TYPE[content_type]
    if filename:
        ext = os.path.splitext(filename)[1].lower()
        if ext in EXT_TO_FILE_TYPE:
            return EXT_TO_FILE_TYPE[ext]
    return "unknown"


def extract_text_from_file(
    file_bytes: bytes,
    content_type: Optional[str] = None,
    filename: Optional[str] = None,
) -> str:
    """Dispatch to the right parser based on MIME type or filename.

    ``content_type`` is checked first; if it's missing or generic
    (e.g. ``application/octet-stream``), the filename extension is
    used as a fallback.
    """
    extractor = _MIME_TO_EXTRACTOR.get(content_type or "")
    if extractor is None and filename:
        ext = os.path.splitext(filename)[1].lower()
        extractor = _EXT_TO_EXTRACTOR.get(ext)

    if extractor is None:
        raise ValueError(
            f"Unsupported file type (content_type={content_type!r}, filename={filename!r})."
        )

    return extractor(file_bytes)
