"""Session-wide stubs for heavy-import modules.

``app.core.rag_manager`` starts NLTK / ChromaDB the moment it is
imported, so we replace it with a ``MagicMock`` before any test is
collected.

``app.core.bootstrap`` (and the route modules that import it) can load
normally because we pre-set ``GEMINI_API_KEY`` and ``CONFIG_PATH``
before any import occurs.  This lets ``get_settings()``, the LLM-client
constructors, and the orchestrator initialise without real credentials
or config files.

Route modules that are *not* under direct test (documents, sessions,
debug, phd_canvas) are still replaced with lightweight stubs so their
dependency trees are never pulled in.
"""

import os
import sys
from unittest.mock import MagicMock

from fastapi import APIRouter

os.environ.setdefault("GEMINI_API_KEY", "fake-test-key")
os.environ.setdefault("CONFIG_PATH", "")

# rag_manager triggers NLTK / ChromaDB on import — always stub it.
sys.modules.setdefault("app.core.rag_manager", MagicMock())

# Stub route modules that are NOT under direct test to avoid pulling
# in their full dependency trees when app.api.routes.__init__ runs.
_stub_router_module = MagicMock(router=APIRouter())
for _name in (
    "app.api.routes.documents",
    "app.api.routes.sessions",
    "app.api.routes.debug",
    "app.api.routes.phd_canvas",
):
    sys.modules.setdefault(_name, _stub_router_module)
