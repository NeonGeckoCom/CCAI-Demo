import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError


# ------------------------------------------------------------------
# ChatMessage – response_mode field
# ------------------------------------------------------------------


class TestChatMessageResponseMode(unittest.TestCase):

    def test_defaults_to_panel(self):
        from app.api.routes.chat import ChatMessage
        msg = ChatMessage(user_input="hello")
        self.assertEqual(msg.response_mode, "panel")

    def test_accepts_panel(self):
        from app.api.routes.chat import ChatMessage
        msg = ChatMessage(user_input="hello", response_mode="panel")
        self.assertEqual(msg.response_mode, "panel")

    def test_accepts_aggregated(self):
        from app.api.routes.chat import ChatMessage
        msg = ChatMessage(user_input="hello", response_mode="aggregated")
        self.assertEqual(msg.response_mode, "aggregated")

    def test_rejects_invalid_value(self):
        from app.api.routes.chat import ChatMessage
        with self.assertRaises(ValidationError):
            ChatMessage(user_input="hello", response_mode="bogus")


# ------------------------------------------------------------------
# synthesize_aggregated_response
# ------------------------------------------------------------------


SAMPLE_PANEL_RESULTS = [
    {
        "persona_id": "mentor",
        "persona_name": "Socratic Mentor",
        "response": "Consider the philosophical implications.",
        "used_documents": False,
        "document_chunks_used": 0,
        "response_length": "medium",
        "context_quality": "conversation_only",
    },
    {
        "persona_id": "methodologist",
        "persona_name": "Methodologist",
        "response": "Use a mixed-methods approach.",
        "used_documents": True,
        "document_chunks_used": 3,
        "response_length": "medium",
        "context_quality": "high",
    },
]


def _run(coro):
    """Run an async coroutine synchronously for testing."""
    return asyncio.run(coro)


class TestSynthesizeAggregatedResponse(unittest.TestCase):

    def _make_orchestrator(self, llm_response="Synthesized answer."):
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=llm_response)

        from app.core.improved_orchestrator import ImprovedChatOrchestrator
        orch = ImprovedChatOrchestrator.__new__(ImprovedChatOrchestrator)
        orch.personas = {}
        orch.llm_client = mock_llm
        orch.session_manager = MagicMock()
        orch.context_manager = MagicMock()
        return orch, mock_llm

    def test_returns_expected_shape(self):
        orch, _ = self._make_orchestrator("A unified answer.")
        result = _run(orch.synthesize_aggregated_response(
            user_input="What should I do?",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertIsNotNone(result)
        self.assertEqual(result["persona_id"], "aggregated")
        self.assertTrue(result["is_aggregated"])
        self.assertEqual(result["source_personas"], ["mentor", "methodologist"])
        self.assertIn("### Thought", result["response"])
        self.assertEqual(result["context_quality"], "synthesized")

    def test_aggregates_document_usage(self):
        orch, _ = self._make_orchestrator("Answer.")
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertTrue(result["used_documents"])
        self.assertEqual(result["document_chunks_used"], 3)

    def test_empty_panel_results_returns_none(self):
        orch, _ = self._make_orchestrator()
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=[],
        ))
        self.assertIsNone(result)

    def test_llm_empty_response_returns_none(self):
        orch, _ = self._make_orchestrator("")
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertIsNone(result)

    def test_llm_whitespace_response_returns_none(self):
        orch, _ = self._make_orchestrator("   \n  ")
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertIsNone(result)

    def test_llm_exception_returns_none(self):
        orch, mock_llm = self._make_orchestrator()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("API timeout"))
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertIsNone(result)

    def test_uses_provided_llm_client(self):
        orch, default_llm = self._make_orchestrator()
        override_llm = AsyncMock()
        override_llm.generate = AsyncMock(return_value="Override answer.")
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
            llm_client=override_llm,
        ))
        override_llm.generate.assert_called_once()
        default_llm.generate.assert_not_called()
        self.assertIn("### Thought", result["response"])

    def test_respects_response_length(self):
        orch, mock_llm = self._make_orchestrator("Short.")
        _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
            response_length="short",
        ))
        call_kwargs = mock_llm.generate.call_args.kwargs
        self.assertEqual(call_kwargs["max_tokens"], 800)

    def test_persona_name_is_set(self):
        orch, _ = self._make_orchestrator("Answer.")
        result = _run(orch.synthesize_aggregated_response(
            user_input="question",
            panel_results=SAMPLE_PANEL_RESULTS,
        ))
        self.assertIn("persona_name", result)
        self.assertTrue(len(result["persona_name"]) > 0)
