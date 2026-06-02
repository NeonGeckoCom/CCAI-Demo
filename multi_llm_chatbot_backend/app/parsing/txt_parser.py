"""Plain-text parser.

Also exposes :func:`decode_text`, an encoding-tolerant decoder used by
the Markdown / HTML / JSON / CSV parsers as their first step.
"""

from __future__ import annotations

from app.parsing.base import BaseParser


def decode_text(file_bytes: bytes) -> str:
    """Decode bytes as text, tolerating a few common encodings."""
    for encoding in ("utf-8", "utf-8-sig", "utf-16", "latin-1"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    return file_bytes.decode("utf-8", errors="replace")


class TxtParser(BaseParser):
    """Return the file content as-is, decoded from bytes."""

    def parse(self, file_bytes: bytes) -> str:
        return decode_text(file_bytes)
