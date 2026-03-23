"""
Lucide icon name registry.

Reads a pre-generated list of valid PascalCase Lucide icon names from a
bundled JSON file.  Regenerate with::

    python3 scripts/generate_icon_names.py
"""

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_ICON_NAMES_JSON = Path(__file__).resolve().parent / "_lucide_icon_names.json"


@lru_cache(maxsize=1)
def get_valid_icon_names() -> frozenset[str]:
    """Return the set of valid PascalCase Lucide icon names."""
    try:
        data = json.loads(_ICON_NAMES_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read icon names from %s: %s", _ICON_NAMES_JSON, exc)
        return frozenset()

    icons = frozenset(data["icons"])
    logger.info("Loaded %d Lucide icon names (v%s)", len(icons), data.get("version"))
    return icons
