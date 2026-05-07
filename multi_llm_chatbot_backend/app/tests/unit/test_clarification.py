import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.improved_orchestrator import ImprovedChatOrchestrator


def _make_session(user_message_count=1):
    """Build a mock ConversationContext with N user messages."""
    session = MagicMock()
    session.messages = [
        {"role": "user", "content": f"message {i}"}
        for i in range(user_message_count)
    ]
    return session


def _make_mock_settings():
    """Build a mock settings object with the fields needs_clarification_improved reads."""
    settings = MagicMock()
    settings.app.title = "Test Advisory Panel"
    settings.app.subtitle = "AI-Powered Test Guidance"
    settings.orchestrator.specific_keywords = ["methodology", "theory", "research"]
    settings.orchestrator.min_words_without_keywords = 6
    settings.orchestrator.clarification_questions = ["Could you provide more details?"]
    settings.orchestrator.clarification_suggestions = ["Ask about methodology."]
    return settings


def _make_orchestrator(persona_llm=None):
    """Build an orchestrator with mocked dependencies, bypassing __init__."""
    orch = ImprovedChatOrchestrator.__new__(ImprovedChatOrchestrator)
    orch.llm_client = None
    orch.session_manager = MagicMock()
    orch.context_manager = MagicMock()

    if persona_llm is not None:
        persona = MagicMock()
        persona.name = "Dr. Test"
        persona.id = "tester"
        persona.llm = persona_llm
        orch.personas = {"tester": persona}
    else:
        orch.personas = {}

    return orch


@patch("app.core.improved_orchestrator.get_settings")
class TestNeedsClarificationImproved(unittest.TestCase):

    def _run(self, coro):
        return asyncio.run(coro)

    # ------------------------------------------------------------------
    # First-message gate
    # ------------------------------------------------------------------

    def test_skips_when_session_has_multiple_user_messages(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock()
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=3)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertFalse(result)
        llm.generate.assert_not_called()

    def test_proceeds_when_session_has_one_user_message(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(orch.needs_clarification_improved(session, "explain transformers"))

        llm.generate.assert_called_once()

    # ------------------------------------------------------------------
    # LLM happy path — clear input
    # ------------------------------------------------------------------

    def test_returns_false_when_llm_says_clear(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "The user asked about a specific topic.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "explain transformers")
        )

        self.assertFalse(result)

    # ------------------------------------------------------------------
    # LLM happy path — vague input
    # ------------------------------------------------------------------

    def test_returns_true_when_llm_says_vague(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": True,
            "reason": "Single generic word with no topic.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertTrue(result)

    # ------------------------------------------------------------------
    # Strict boolean parsing
    # ------------------------------------------------------------------

    def test_rejects_string_false_and_falls_back(self, mock_settings):
        """bool("false") is True in Python; ensure string values are rejected."""
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": "false",
            "reason": "Should have been a boolean.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        orch.needs_clarification = MagicMock(return_value=False)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "methodology")
        )

        self.assertFalse(result)
        orch.needs_clarification.assert_called_once()

    def test_rejects_string_true_and_falls_back(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": "true",
            "reason": "Should have been a boolean.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        orch.needs_clarification = MagicMock(return_value=True)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertTrue(result)
        orch.needs_clarification.assert_called_once()

    def test_rejects_missing_key_and_falls_back(self, mock_settings):
        """If the LLM omits the key entirely, fall back."""
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "reason": "Forgot the main field.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        orch.needs_clarification = MagicMock(return_value=True)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertTrue(result)
        orch.needs_clarification.assert_called_once()

    # ------------------------------------------------------------------
    # Malformed JSON → fallback
    # ------------------------------------------------------------------

    def test_falls_back_on_malformed_json(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value="this is not json at all")
        orch = _make_orchestrator(persona_llm=llm)
        orch.needs_clarification = MagicMock(return_value=False)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "something")
        )

        self.assertFalse(result)
        orch.needs_clarification.assert_called_once()

    # ------------------------------------------------------------------
    # LLM exception → fallback
    # ------------------------------------------------------------------

    def test_falls_back_on_llm_exception(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(side_effect=RuntimeError("connection refused"))
        orch = _make_orchestrator(persona_llm=llm)
        orch.needs_clarification = MagicMock(return_value=True)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertTrue(result)
        orch.needs_clarification.assert_called_once()

    # ------------------------------------------------------------------
    # No personas registered → fallback
    # ------------------------------------------------------------------

    def test_falls_back_when_no_personas_registered(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        orch = _make_orchestrator(persona_llm=None)
        orch.needs_clarification = MagicMock(return_value=True)
        session = _make_session(user_message_count=1)

        result = self._run(
            orch.needs_clarification_improved(session, "help")
        )

        self.assertTrue(result)
        orch.needs_clarification.assert_called_once()

    # ------------------------------------------------------------------
    # LLM call parameters
    # ------------------------------------------------------------------

    def test_llm_called_with_json_mode_and_zero_temp(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(
            orch.needs_clarification_improved(session, "explain transformers")
        )

        call_kwargs = llm.generate.call_args.kwargs
        self.assertEqual(call_kwargs["temperature"], 0.0)
        self.assertEqual(call_kwargs["max_tokens"], 128)
        self.assertEqual(call_kwargs["response_mime_type"], "application/json")

    def test_system_prompt_includes_app_context(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(
            orch.needs_clarification_improved(session, "explain transformers")
        )

        system_prompt = llm.generate.call_args.kwargs["system_prompt"]
        self.assertIn("Test Advisory Panel", system_prompt)
        self.assertIn("AI-Powered Test Guidance", system_prompt)

    def test_system_prompt_includes_domain_keywords(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(
            orch.needs_clarification_improved(session, "explain transformers")
        )

        system_prompt = llm.generate.call_args.kwargs["system_prompt"]
        self.assertIn("methodology", system_prompt)
        self.assertIn("theory", system_prompt)
        self.assertIn("research", system_prompt)

    def test_system_prompt_includes_advisor_names(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(
            orch.needs_clarification_improved(session, "explain transformers")
        )

        system_prompt = llm.generate.call_args.kwargs["system_prompt"]
        self.assertIn("Dr. Test (tester)", system_prompt)

    def test_user_input_passed_in_user_prompt(self, mock_settings):
        mock_settings.return_value = _make_mock_settings()
        llm = MagicMock()
        llm.generate = AsyncMock(return_value=json.dumps({
            "needs_clarification": False,
            "reason": "Clear.",
        }))
        orch = _make_orchestrator(persona_llm=llm)
        session = _make_session(user_message_count=1)

        self._run(
            orch.needs_clarification_improved(session, "How do I structure my lit review?")
        )

        context = llm.generate.call_args.kwargs["context"]
        self.assertEqual(len(context), 1)
        self.assertEqual(context[0]["role"], "user")
        self.assertIn("How do I structure my lit review?", context[0]["content"])
