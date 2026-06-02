"""Document parsing package.

Public API:

- :func:`extract_text_from_file` — dispatch to the right parser
- :func:`resolve_file_type` — short label for RAG metadata

Per-format parser classes are also exposed so callers can target a
specific format directly (mirroring TrustRAG's
``trustrag/modules/document/`` layout).
"""

from app.parsing.base import BaseParser
from app.parsing.csv_parser import CsvParser
from app.parsing.docx_parser import DocxParser
from app.parsing.document_extractor import (
    EXT_TO_FILE_TYPE,
    MIME_TO_FILE_TYPE,
    extract_text_from_file,
    resolve_file_type,
)
from app.parsing.excel_parser import ExcelParser
from app.parsing.html_parser import HtmlParser
from app.parsing.json_parser import JsonParser
from app.parsing.markdown_parser import MarkdownParser
from app.parsing.pdf_parser import PdfParser
from app.parsing.ppt_parser import PptParser
from app.parsing.txt_parser import TxtParser, decode_text

__all__ = [
    "BaseParser",
    "CsvParser",
    "DocxParser",
    "ExcelParser",
    "HtmlParser",
    "JsonParser",
    "MarkdownParser",
    "PdfParser",
    "PptParser",
    "TxtParser",
    "EXT_TO_FILE_TYPE",
    "MIME_TO_FILE_TYPE",
    "decode_text",
    "extract_text_from_file",
    "resolve_file_type",
]
