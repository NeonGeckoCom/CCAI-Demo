"""
Bundled avatar image registry.

Provides helpers for resolving and listing the avatar images shipped in
``app/assets/avatars/``.
"""

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_AVATARS_DIR = Path(__file__).resolve().parent.parent / "assets" / "avatars"


def get_bundled_avatar_path(name: str) -> Path | None:
    """Return the filesystem path for a bundled avatar, or *None* if the
    file does not exist."""
    if not _AVATARS_DIR.is_dir():
        return None
    candidate = _AVATARS_DIR / name
    if candidate.is_file():
        return candidate
    return None


@lru_cache(maxsize=1)
def list_bundled_avatars() -> tuple[str, ...]:
    """Return the filenames of all bundled avatar images."""
    if not _AVATARS_DIR.is_dir():
        return ()
    avatars = tuple(sorted(f.name for f in _AVATARS_DIR.iterdir() if f.is_file()))
    logger.info("Found %d bundled avatar images.", len(avatars))
    return avatars
