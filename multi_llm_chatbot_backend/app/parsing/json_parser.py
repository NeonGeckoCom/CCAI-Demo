"""JSON parser — pretty-prints valid JSON, otherwise returns raw text."""

from __future__ import annotations

import json

from app.parsing.base import BaseParser
from app.parsing.txt_parser import decode_text


class JsonParser(BaseParser):
    """Pretty-print so chunkers see one key/value per line."""

    def parse(self, file_bytes: bytes) -> str:
        raw = decode_text(file_bytes)
        try:
            data = json.loads(raw)
            return json.dumps(data, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            return raw
