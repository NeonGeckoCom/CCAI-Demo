"""Base interface for document parsers.

Each per-format parser exposes a ``parse(file_bytes: bytes) -> str``
method that returns plain text suitable for the RAG chunker.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseParser(ABC):
    """Common interface for all document parsers."""

    @abstractmethod
    def parse(self, file_bytes: bytes) -> str:
        """Extract plain text from raw file bytes."""
        raise NotImplementedError
