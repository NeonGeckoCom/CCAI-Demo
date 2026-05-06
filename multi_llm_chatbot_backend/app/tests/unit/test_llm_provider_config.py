import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.chat import resolve_llm_clients
from app.api.routes.provider import switch_provider
from app.models.user import User, UserLLMConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(llm_config=None):
    return User(
        _id=ObjectId(),
        firstName="Test",
        lastName="User",
        email="test@example.com",
        hashed_password="fakehash",
        llm_config=llm_config,
    )


# ===================================================================
# 1. UserLLMConfig — Pydantic model validation
# ===================================================================

class TestUserLLMConfig(unittest.TestCase):
    """Validate the UserLLMConfig Pydantic model and its _validate_hybrid_fields
    model validator."""

    def test_defaults(self):
        cfg = UserLLMConfig()
        self.assertEqual(cfg.mode, "uniform")
        self.assertEqual(cfg.default_backend, "gemini")
        self.assertIsNone(cfg.orchestrator_backend)
        self.assertIsNone(cfg.persona_backends)

    def test_uniform_strips_hybrid_fields(self):
        cfg = UserLLMConfig(
            mode="uniform",
            default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"x": "vllm"},
        )
        self.assertIsNone(cfg.orchestrator_backend)
        self.assertIsNone(cfg.persona_backends)

    def test_hybrid_requires_at_least_one_override(self):
        with self.assertRaises(ValidationError) as ctx:
            UserLLMConfig(mode="hybrid", default_backend="gemini")
        self.assertIn("hybrid mode requires", str(ctx.exception))

    def test_hybrid_with_orchestrator_only(self):
        cfg = UserLLMConfig(
            mode="hybrid",
            default_backend="gemini",
            orchestrator_backend="ollama",
        )
        self.assertEqual(cfg.orchestrator_backend, "ollama")
        self.assertIsNone(cfg.persona_backends)

    def test_hybrid_with_persona_backends_only(self):
        cfg = UserLLMConfig(
            mode="hybrid",
            default_backend="gemini",
            persona_backends={"advisor_1": "vllm"},
        )
        self.assertIsNone(cfg.orchestrator_backend)
        self.assertEqual(cfg.persona_backends, {"advisor_1": "vllm"})

    def test_hybrid_with_both(self):
        cfg = UserLLMConfig(
            mode="hybrid",
            default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"advisor_1": "vllm"},
        )
        self.assertEqual(cfg.orchestrator_backend, "ollama")
        self.assertEqual(cfg.persona_backends, {"advisor_1": "vllm"})

    def test_rejects_unknown_backend_name(self):
        with self.assertRaises(ValidationError):
            UserLLMConfig(default_backend="claude")

    def test_extra_fields_forbidden(self):
        with self.assertRaises(ValidationError):
            UserLLMConfig(default_backend="gemini", surprise="boom")

    def test_model_dump_roundtrip(self):
        original = UserLLMConfig(
            mode="hybrid",
            default_backend="ollama",
            orchestrator_backend="gemini",
            persona_backends={"a": "vllm", "b": "gemini"},
        )
        restored = UserLLMConfig(**original.model_dump())
        self.assertEqual(original.model_dump(), restored.model_dump())


# ===================================================================
# 2. resolve_llm_clients — chat routing logic
# ===================================================================

class TestResolveLlmClients(unittest.TestCase):
    """Verify that resolve_llm_clients maps a user's stored config to the
    correct LLM client instances."""

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_no_config_returns_nones(self, mock_get, mock_orch):
        result = resolve_llm_clients(_make_user(llm_config=None))
        self.assertIsNone(result["orchestrator"])
        self.assertIsNone(result["personas"])
        mock_get.assert_not_called()

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_uniform_same_client_for_all(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock(), "b": MagicMock(), "c": MagicMock()}
        sentinel = MagicMock(name="shared_client")
        mock_get.return_value = sentinel

        user = _make_user(UserLLMConfig(mode="uniform", default_backend="ollama"))
        result = resolve_llm_clients(user)

        mock_get.assert_called_once_with("ollama")
        self.assertIs(result["orchestrator"], sentinel)
        for pid in ("a", "b", "c"):
            self.assertIs(result["personas"][pid], sentinel)

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_hybrid_orchestrator_override(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock()}
        clients = {"gemini": MagicMock(), "ollama": MagicMock()}
        mock_get.side_effect = lambda b: clients[b]

        user = _make_user(UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"a": "gemini"},
        ))
        result = resolve_llm_clients(user)
        self.assertIs(result["orchestrator"], clients["ollama"])

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_hybrid_orchestrator_falls_back_to_default(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock()}
        sentinel = MagicMock()
        mock_get.return_value = sentinel

        user = _make_user(UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"a": "gemini"},
        ))
        result = resolve_llm_clients(user)
        self.assertIs(result["orchestrator"], sentinel)

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_hybrid_persona_override(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock(), "b": MagicMock()}
        clients = {"gemini": MagicMock(), "vllm": MagicMock()}
        mock_get.side_effect = lambda b: clients[b]

        user = _make_user(UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"a": "vllm", "b": "gemini"},
        ))
        result = resolve_llm_clients(user)
        self.assertIs(result["personas"]["a"], clients["vllm"])

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_hybrid_unmapped_persona_uses_default(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock(), "unmapped": MagicMock()}
        clients = {"gemini": MagicMock(), "vllm": MagicMock()}
        mock_get.side_effect = lambda b: clients[b]

        user = _make_user(UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"a": "vllm"},
        ))
        result = resolve_llm_clients(user)
        self.assertIs(result["personas"]["unmapped"], clients["gemini"])

    @patch("app.api.routes.chat.chat_orchestrator")
    @patch("app.api.routes.chat.get_llm_client")
    def test_hybrid_mixed(self, mock_get, mock_orch):
        mock_orch.personas = {"a": MagicMock(), "b": MagicMock()}
        clients = {"gemini": MagicMock(), "ollama": MagicMock(), "vllm": MagicMock()}
        mock_get.side_effect = lambda b: clients[b]

        user = _make_user(UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"a": "vllm"},
        ))
        result = resolve_llm_clients(user)
        self.assertIs(result["orchestrator"], clients["ollama"])
        self.assertIs(result["personas"]["a"], clients["vllm"])
        self.assertIs(result["personas"]["b"], clients["gemini"])


# ===================================================================
# 3. switch_provider — endpoint validation
# ===================================================================

class TestSwitchProvider(unittest.IsolatedAsyncioTestCase):
    """Validate the switch_provider endpoint's guard logic."""

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_rejects_unknown_persona_id(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {"known": MagicMock()}
        mock_get.return_value = MagicMock()

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"unknown_id": "gemini"},
        )
        with self.assertRaises(HTTPException) as ctx:
            await switch_provider(cfg, _make_user())
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Unknown persona IDs", ctx.exception.detail)

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_accepts_known_persona_ids(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {"a": MagicMock(), "b": MagicMock()}
        mock_get.return_value = MagicMock()
        mock_db.return_value.users.update_one = AsyncMock()

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"a": "gemini", "b": "gemini"},
        )
        result = await switch_provider(cfg, _make_user())
        self.assertEqual(result["message"], "LLM configuration updated")

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_rejects_unconfigured_default_backend(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {}
        mock_get.side_effect = ValueError("not configured")

        cfg = UserLLMConfig(mode="uniform", default_backend="ollama")
        with self.assertRaises(HTTPException) as ctx:
            await switch_provider(cfg, _make_user())
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("not configured", ctx.exception.detail)

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_rejects_unconfigured_orchestrator_backend(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {}

        def side_effect(backend):
            if backend == "vllm":
                raise ValueError("no vLLM endpoint")
            return MagicMock()
        mock_get.side_effect = side_effect

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            orchestrator_backend="vllm",
        )
        with self.assertRaises(HTTPException) as ctx:
            await switch_provider(cfg, _make_user())
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("not configured", ctx.exception.detail)

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_rejects_unconfigured_persona_backend(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {"a": MagicMock()}

        def side_effect(backend):
            if backend == "vllm":
                raise ValueError("no vLLM endpoint")
            return MagicMock()
        mock_get.side_effect = side_effect

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            persona_backends={"a": "vllm"},
        )
        with self.assertRaises(HTTPException) as ctx:
            await switch_provider(cfg, _make_user())
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("not configured", ctx.exception.detail)

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_checks_all_distinct_backends(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {"a": MagicMock(), "b": MagicMock()}
        mock_get.return_value = MagicMock()
        mock_db.return_value.users.update_one = AsyncMock()

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"a": "vllm", "b": "gemini"},
        )
        await switch_provider(cfg, _make_user())

        checked = {call.args[0] for call in mock_get.call_args_list}
        self.assertEqual(checked, {"gemini", "ollama", "vllm"})

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_persists_to_database(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {}
        mock_get.return_value = MagicMock()
        mock_collection = MagicMock()
        mock_collection.update_one = AsyncMock()
        mock_db.return_value.users = mock_collection

        user = _make_user()
        cfg = UserLLMConfig(mode="uniform", default_backend="ollama")
        await switch_provider(cfg, user)

        mock_collection.update_one.assert_awaited_once()
        call_args = mock_collection.update_one.call_args
        self.assertEqual(call_args[0][0], {"_id": user.id})
        self.assertEqual(
            call_args[0][1],
            {"$set": {"llm_config": cfg.model_dump()}},
        )

    @patch("app.api.routes.provider.get_database")
    @patch("app.api.routes.provider.get_llm_client")
    @patch("app.api.routes.provider.chat_orchestrator")
    async def test_returns_updated_config(self, mock_orch, mock_get, mock_db):
        mock_orch.personas = {"a": MagicMock()}
        mock_get.return_value = MagicMock()
        mock_db.return_value.users.update_one = AsyncMock()

        cfg = UserLLMConfig(
            mode="hybrid", default_backend="gemini",
            orchestrator_backend="ollama",
            persona_backends={"a": "vllm"},
        )
        result = await switch_provider(cfg, _make_user())

        self.assertEqual(result["message"], "LLM configuration updated")
        self.assertEqual(result["llm_config"], cfg.model_dump())


if __name__ == "__main__":
    unittest.main()
