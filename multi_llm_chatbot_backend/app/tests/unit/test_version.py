"""Sanity checks for the centralized ``__version__`` string.

Guards against regressions where the release automation assumes it can
locate and parse ``app/version.py``.
"""

import re
import unittest

from app.api.routes.root import root
from app.version import __version__


VERSION_REGEX = re.compile(r"^\d+\.\d+\.\d+([a-zA-Z0-9.\-+]*)?$")


class TestVersion(unittest.TestCase):

    def test_version_string_is_importable_and_well_formed(self):
        self.assertIsInstance(__version__, str)
        self.assertTrue(__version__)
        self.assertRegex(
            __version__,
            VERSION_REGEX,
            f"Unexpected version format: {__version__!r}",
        )


class TestRootEndpointVersion(unittest.TestCase):
    """The ``/`` handler should surface the same version we imported
    from ``app.version``.

    ``app.api.routes.__init__`` eagerly imports every sibling route
    module; the heavy ones are replaced with ``MagicMock`` stubs once,
    session-wide, in ``conftest.py`` so ``root.py`` can be loaded via
    normal import machinery.
    """

    def test_root_endpoint_exposes_imported_version(self):
        payload = root()
        self.assertEqual(payload["version"], __version__)
