"""Markdown parser.

Returns the source as-is — chunkers handle markup fine and dropping the
syntax would lose heading structure useful for retrieval.
"""

from __future__ import annotations

from app.parsing.base import BaseParser
from app.parsing.txt_parser import decode_text


class MarkdownParser(BaseParser):
    """Return the Markdown source verbatim."""

    def parse(self, file_bytes: bytes) -> str:
        return decode_text(file_bytes)
