"""Sanity checks for the centralized ``__version__`` string.

These guard against regressions where the release automation assumes it
can locate and parse ``app/version.py`` via ``setup.py --version``.
"""

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]


def test_version_string_is_importable_and_well_formed():
    from app.version import __version__

    assert isinstance(__version__, str)
    assert __version__
    # Must be parseable as (semver core)(optional prerelease suffix)
    assert re.match(r"^\d+\.\d+\.\d+([a-zA-Z0-9.\-+]*)?$", __version__), (
        f"Unexpected version format: {__version__!r}"
    )


def test_setup_py_reports_matching_version():
    """``python setup.py --version`` is what the release workflows read."""
    from app.version import __version__

    result = subprocess.run(
        [sys.executable, "setup.py", "--version"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == __version__


def test_root_endpoint_exposes_version():
    """The FastAPI root response includes the imported version."""
    from app.api.routes.root import root
    from app.version import __version__

    payload = root()
    assert payload["version"] == __version__
