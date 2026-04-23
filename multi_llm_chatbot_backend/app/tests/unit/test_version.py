"""Sanity checks for the centralized ``__version__`` string.

Guards against regressions where the release automation assumes it can
locate and parse ``app/version.py``.
"""

import re
import sys
import unittest
from unittest.mock import MagicMock

from fastapi import APIRouter


VERSION_REGEX = re.compile(r"^\d+\.\d+\.\d+([a-zA-Z0-9.\-+]*)?$")
_MISSING = object()


class TestVersion(unittest.TestCase):

    def test_version_string_is_importable_and_well_formed(self):
        from app.version import __version__

        self.assertIsInstance(__version__, str)
        self.assertTrue(__version__)
        self.assertRegex(
            __version__,
            VERSION_REGEX,
            f"Unexpected version format: {__version__!r}",
        )


class TestRootEndpointVersion(unittest.TestCase):
    """Exercise the FastAPI `/` handler to ensure the version it surfaces
    matches the one imported from ``app.version``.

    ``app.api.routes.__init__`` eagerly imports every sibling route
    module, several of which pull in the LLM stack, NLTK downloads, and
    ChromaDB at import time and fail without runtime credentials.  Stub
    those heavy siblings (and the transitive heavy modules they load)
    in ``setUp`` so ``root.py`` can be imported in isolation, and
    restore ``sys.modules`` in ``tearDown`` to avoid leaking the stubs
    into other test modules.
    """

    _STUBBED_MODULES = (
        "app.core.bootstrap",
        "app.core.rag_manager",
        "app.api.routes.chat",
        "app.api.routes.documents",
        "app.api.routes.sessions",
        "app.api.routes.provider",
        "app.api.routes.debug",
        "app.api.routes.phd_canvas",
    )
    # Real modules that must be re-imported against the stubs above, so
    # they are evicted first and restored afterwards.
    _EVICTED_MODULES = (
        "app.api",
        "app.api.routes",
        "app.api.routes.root",
    )

    def setUp(self):
        self._saved = {}

        stub_router_module = MagicMock(router=APIRouter())
        for name in self._STUBBED_MODULES:
            self._saved[name] = sys.modules.get(name, _MISSING)
            sys.modules[name] = stub_router_module

        for name in self._EVICTED_MODULES:
            self._saved.setdefault(name, sys.modules.get(name, _MISSING))
            sys.modules.pop(name, None)

    def tearDown(self):
        for name, original in self._saved.items():
            if original is _MISSING:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original
        self._saved.clear()

        # Evict any app.api.routes.* submodules that were imported against
        # the stubs so unrelated tests get clean imports.
        for name in list(sys.modules):
            if name.startswith("app.api.routes") and name not in sys.modules:
                continue
            if name == "app.api.routes" or name.startswith("app.api.routes."):
                del sys.modules[name]

    def test_root_endpoint_exposes_imported_version(self):
        from app.api.routes.root import root
        from app.version import __version__

        payload = root()
        self.assertEqual(payload["version"], __version__)
