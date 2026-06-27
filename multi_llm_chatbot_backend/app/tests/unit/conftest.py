"""Session-wide stubs for modules that do heavy work at import time.

``app.api.routes.__init__`` eagerly imports every sibling route, and
``app.api.routes.provider`` instantiates real LLM clients at module
load.  ``app.core.bootstrap`` and ``app.core.rag_manager`` likewise
start NLTK, ChromaDB, and the LLM stack the moment they are imported.

We install harmless ``MagicMock`` substitutes for those modules once,
before any test file in this directory is collected, so every test
gets a consistent, importable view of ``app.api.routes`` without
having to reproduce the same stubbing recipe in every test module.

Tests that want to exercise the real version of a specific route
module (for example, ``test_version.py`` wanting the real
``app.api.routes.root``) can still pop their target out of
``sys.modules`` in their own setup -- they no longer have to
coordinate cleanup with peer test modules.
"""

import sys
from unittest.mock import MagicMock

from fastapi import APIRouter


for _name in ("app.core.bootstrap", "app.core.rag_manager"):
    sys.modules.setdefault(_name, MagicMock())

_stub_router_module = MagicMock(router=APIRouter())
for _name in (
    "app.api.routes.chat",
    "app.api.routes.documents",
    "app.api.routes.sessions",
    "app.api.routes.provider",
    "app.api.routes.debug",
    "app.api.routes.phd_canvas",
):
    sys.modules.setdefault(_name, _stub_router_module)
