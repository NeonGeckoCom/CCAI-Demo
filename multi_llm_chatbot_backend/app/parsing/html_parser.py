"""HTML parser — strips tags and returns visible text."""

from __future__ import annotations

import logging

from app.parsing.base import BaseParser
from app.parsing.txt_parser import decode_text

logger = logging.getLogger(__name__)


class HtmlParser(BaseParser):
    """Return visible page text, with ``<script>``/``<style>`` removed."""

    def parse(self, file_bytes: bytes) -> str:
        raw = decode_text(file_bytes)
        try:
            from bs4 import BeautifulSoup  # type: ignore

            soup = BeautifulSoup(raw, "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            return soup.get_text(separator="\n", strip=True)
        except ImportError:
            logger.warning("beautifulsoup4 not installed; returning raw HTML")
            return raw
