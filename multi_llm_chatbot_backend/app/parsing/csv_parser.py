"""CSV parser — renders rows as pipe-delimited lines."""

from __future__ import annotations

import csv
from io import StringIO

from app.parsing.base import BaseParser
from app.parsing.txt_parser import decode_text


class CsvParser(BaseParser):
    """Render CSV as ``cell | cell | …`` rows, one per line."""

    def parse(self, file_bytes: bytes) -> str:
        raw = decode_text(file_bytes)
        reader = csv.reader(StringIO(raw))
        return "\n".join(" | ".join(cell.strip() for cell in row) for row in reader)
