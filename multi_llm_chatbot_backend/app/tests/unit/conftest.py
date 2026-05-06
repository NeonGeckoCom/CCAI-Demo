import os
import sys
from unittest.mock import MagicMock, patch

os.environ.setdefault("GEMINI_API_KEY", "fake-test-key")
os.environ.setdefault("CONFIG_PATH", "")

sys.modules.setdefault("app.core.rag_manager", MagicMock())

with patch(
    "app.llm.improved_gemini_client.ImprovedGeminiClient.__init__",
    lambda self, **kw: None,
):
    import app.core.bootstrap  # noqa: F401
    import app.api.routes  # noqa: F401
