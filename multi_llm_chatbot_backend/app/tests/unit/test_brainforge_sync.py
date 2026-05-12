import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.brainforge_sync import (
    PERSONA_ID_PREFIX,
    SKIP_PERSONA_NAMES,
    _make_persona_id,
    build_brainforge_personas,
    async_sync_brainforge_personas,
)


FAKE_URL = "https://fake.brainforge.example.com"

SAMPLE_MODELS = [
    {
        "name": "BrainForge/neonai",
        "version": "2026.01.26",
        "personas": [
            {
                "persona_name": "NeonAI",
                "system_prompt": "You are the Neon AI assistant.",
                "enabled": True,
            },
            {
                "persona_name": "vanilla",
                "system_prompt": None,
                "enabled": True,
            },
        ],
    },
    {
        "name": "BrainForge/NucleotidingsLLM",
        "version": "2026.04.03",
        "personas": [
            {
                "persona_name": "Nucleotidings",
                "system_prompt": "You are a bioinformatics assistant.",
                "enabled": True,
            },
            {
                "persona_name": "DisabledBot",
                "system_prompt": "I am disabled.",
                "enabled": False,
            },
        ],
    },
]


class TestMakePersonaId(unittest.TestCase):
    """Tests for the _make_persona_id helper."""

    def test_basic_id_generation(self):
        pid = _make_persona_id("BrainForge/neonai", "NeonAI")
        self.assertEqual(pid, "bf_neonai_NeonAI")

    def test_slugifies_special_characters(self):
        pid = _make_persona_id("BrainForge/test-model", "Dr. Smith's Bot!")
        self.assertTrue(pid.startswith(f"{PERSONA_ID_PREFIX}_"))
        self.assertNotIn(" ", pid)
        self.assertNotIn(".", pid)
        self.assertNotIn("'", pid)
        self.assertNotIn("!", pid)

    def test_strips_trailing_underscores(self):
        pid = _make_persona_id("BrainForge/model", "  spaces  ")
        self.assertFalse(pid.endswith("_"))

    def test_uses_last_segment_of_model_name(self):
        pid = _make_persona_id("Org/SubOrg/deepmodel", "Bot")
        self.assertIn("deepmodel", pid)
        self.assertNotIn("Org", pid)

    def test_prefix_is_correct(self):
        pid = _make_persona_id("BrainForge/neonai", "NeonAI")
        self.assertTrue(pid.startswith(f"{PERSONA_ID_PREFIX}_"))


@patch("app.llm.improved_brainforge_client.get_context_manager")
class TestBuildBrainforgePersonas(unittest.TestCase):
    """Tests for build_brainforge_personas."""

    def test_builds_personas_from_model_data(self, mock_ctx):
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(SAMPLE_MODELS, mock_auth, FAKE_URL)

        names = {p.name for p in personas}
        self.assertIn("NeonAI", names)
        self.assertIn("Nucleotidings", names)

        for p in personas:
            self.assertTrue(p.id.startswith(f"{PERSONA_ID_PREFIX}_"))

    def test_skips_vanilla_persona(self, mock_ctx):
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(SAMPLE_MODELS, mock_auth, FAKE_URL)

        names = {p.name for p in personas}
        for skip_name in SKIP_PERSONA_NAMES:
            self.assertNotIn(skip_name, names)

    def test_skips_disabled_persona(self, mock_ctx):
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(SAMPLE_MODELS, mock_auth, FAKE_URL)

        names = {p.name for p in personas}
        self.assertNotIn("DisabledBot", names)

    def test_skips_persona_without_prompt(self, mock_ctx):
        models = [{
            "name": "BrainForge/test",
            "version": "1.0",
            "personas": [
                {"persona_name": "EmptyBot", "system_prompt": "", "enabled": True},
                {"persona_name": "NullBot", "enabled": True},
            ],
        }]
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(models, mock_auth, FAKE_URL)
        self.assertEqual(len(personas), 0)

    def test_persona_has_correct_model_id(self, mock_ctx):
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(SAMPLE_MODELS, mock_auth, FAKE_URL)

        neon_persona = next(p for p in personas if p.name == "NeonAI")
        self.assertEqual(neon_persona.llm.model_id, "BrainForge/neonai@2026.01.26")

    def test_persona_shares_auth_manager(self, mock_ctx):
        mock_auth = AsyncMock()
        personas = build_brainforge_personas(SAMPLE_MODELS, mock_auth, FAKE_URL)

        for p in personas:
            self.assertIs(p.llm._auth, mock_auth)


def _make_mock_orchestrator(existing_personas=None):
    """Create a mock orchestrator with optional pre-registered personas."""
    orch = MagicMock()
    orch.personas = dict(existing_personas or {})

    def register_side_effect(persona):
        orch.personas[persona.id] = persona

    def unregister_side_effect(pid):
        orch.personas.pop(pid, None)

    orch.register_persona.side_effect = register_side_effect
    orch.unregister_persona.side_effect = unregister_side_effect
    return orch


def _make_mock_settings(api_url=FAKE_URL, username="user", password="pass"):
    """Create mock settings with BrainForge config."""
    settings = MagicMock()
    settings.llm.brainforge.api_url = api_url
    settings.llm.brainforge.username = username
    settings.llm.brainforge.password = password
    settings.llm.brainforge.sync_interval = 300
    return settings


@patch("app.llm.improved_brainforge_client.get_context_manager")
@patch("app.core.brainforge_sync.fetch_brainforge_models", new_callable=AsyncMock)
@patch("app.core.brainforge_sync.get_settings")
class TestAsyncSyncBrainforgePersonas(unittest.TestCase):
    """Tests for async_sync_brainforge_personas."""

    def test_sync_registers_new_personas(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings()
        mock_fetch.return_value = SAMPLE_MODELS

        orch = _make_mock_orchestrator()
        count = asyncio.run(async_sync_brainforge_personas(orch))

        self.assertEqual(count, 2)
        self.assertEqual(orch.register_persona.call_count, 2)
        registered_ids = {call.args[0].id for call in orch.register_persona.call_args_list}
        self.assertTrue(all(pid.startswith(f"{PERSONA_ID_PREFIX}_") for pid in registered_ids))

    def test_sync_removes_stale_personas(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings()
        mock_fetch.return_value = SAMPLE_MODELS[:1]

        stale_persona = MagicMock()
        stale_persona.id = "bf_nucleotidingsllm_Nucleotidings"
        stale_persona.name = "Nucleotidings"

        orch = _make_mock_orchestrator({
            "bf_nucleotidingsllm_Nucleotidings": stale_persona,
        })
        asyncio.run(async_sync_brainforge_personas(orch))

        self.assertNotIn("bf_nucleotidingsllm_Nucleotidings", orch.personas)

    def test_sync_upserts_existing_personas(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings()
        mock_fetch.return_value = SAMPLE_MODELS

        existing = MagicMock()
        existing.id = "bf_neonai_NeonAI"
        existing.name = "NeonAI"

        orch = _make_mock_orchestrator({"bf_neonai_NeonAI": existing})
        asyncio.run(async_sync_brainforge_personas(orch))

        self.assertTrue(orch.register_persona.called)
        re_registered_ids = {call.args[0].id for call in orch.register_persona.call_args_list}
        self.assertIn("bf_neonai_NeonAI", re_registered_ids)

    def test_sync_skips_when_no_url(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings(api_url="")

        orch = _make_mock_orchestrator()
        count = asyncio.run(async_sync_brainforge_personas(orch))

        self.assertEqual(count, 0)
        mock_fetch.assert_not_called()

    def test_sync_skips_when_no_credentials(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings(username="", password="")

        orch = _make_mock_orchestrator()
        count = asyncio.run(async_sync_brainforge_personas(orch))

        self.assertEqual(count, 0)
        mock_fetch.assert_not_called()

    def test_sync_skips_when_no_models(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings()
        mock_fetch.return_value = []

        orch = _make_mock_orchestrator()
        count = asyncio.run(async_sync_brainforge_personas(orch))

        self.assertEqual(count, 0)

    def test_sync_preserves_non_bf_personas(self, mock_settings, mock_fetch, mock_ctx):
        mock_settings.return_value = _make_mock_settings()
        mock_fetch.return_value = SAMPLE_MODELS

        static_persona = MagicMock()
        static_persona.id = "critic"
        static_persona.name = "Constructive Critic"

        orch = _make_mock_orchestrator({"critic": static_persona})
        asyncio.run(async_sync_brainforge_personas(orch))

        self.assertIn("critic", orch.personas)
        unregistered_ids = [call.args[0] for call in orch.unregister_persona.call_args_list]
        self.assertNotIn("critic", unregistered_ids)
