import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.llm.llm_client import ToolCallResult
from app.llm.improved_gemini_client import ImprovedGeminiClient


FAKE_TOOL = {
    "name": "search_courses",
    "description": "Search courses",
    "parameters": {
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "Subject code"},
        },
    },
}


def _gemini_function_call_response(name, args):
    """Simulate a Gemini response that requests a single function call."""
    return {
        "candidates": [{
            "content": {
                "parts": [{"functionCall": {"name": name, "args": args}}],
                "role": "model",
            }
        }]
    }


def _gemini_multi_function_call_response(*calls):
    """Simulate a Gemini response with multiple parallel function calls.

    Each *call* is a ``(name, args)`` tuple.
    """
    return {
        "candidates": [{
            "content": {
                "parts": [
                    {"functionCall": {"name": n, "args": a}} for n, a in calls
                ],
                "role": "model",
            }
        }]
    }


def _gemini_text_response(text):
    """Simulate a Gemini response containing plain text."""
    return {
        "candidates": [{
            "content": {
                "parts": [{"text": text}],
                "role": "model",
            }
        }]
    }


def _mock_httpx_client(responses):
    """Build a patched ``httpx.AsyncClient`` that returns *responses* in order.

    *responses* is a list of dicts; each is returned by ``resp.json()``.
    """
    mock_resps = []
    for body in responses:
        r = MagicMock()
        r.json.return_value = body
        r.raise_for_status = MagicMock()
        mock_resps.append(r)

    client_instance = AsyncMock()
    if len(mock_resps) == 1:
        client_instance.post.return_value = mock_resps[0]
    else:
        client_instance.post = AsyncMock(side_effect=mock_resps)

    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client_instance)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx, client_instance


def _make_gemini_client(MockSettings, MockCtxMgr):
    """Instantiate an ImprovedGeminiClient with mocked dependencies."""
    mock_settings = MagicMock()
    mock_settings.llm.gemini.api_key = "fake-key"
    mock_settings.llm.gemini.model = "gemini-2.0-flash"
    MockSettings.return_value = mock_settings
    MockCtxMgr.return_value = MagicMock()
    return ImprovedGeminiClient()


@patch("app.llm.improved_gemini_client.get_context_manager")
@patch("app.llm.improved_gemini_client.get_settings")
class TestGeminiGenerateWithTools(unittest.TestCase):
    """Unit tests for ImprovedGeminiClient.generate_with_tools()."""

    def test_direct_text_response_returns_text(self, MockSettings, MockCtxMgr):
        """When Gemini responds with text (no tool call), return it."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([_gemini_text_response("Hello, world!")])
        mock_executor = AsyncMock()

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Hi there",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertEqual(result.text, "Hello, world!")
        self.assertFalse(result.used_tool)
        mock_executor.assert_not_called()

    def test_function_call_triggers_executor_and_returns_final_text(self, MockSettings, MockCtxMgr):
        """When Gemini requests a function call, execute it and return
        the text from the follow-up response."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_function_call_response("search_courses", {"subject": "CSCI"}),
            _gemini_text_response("CSCI 1300 is available MWF 10-10:50."),
        ])
        mock_executor = AsyncMock(
            return_value={"courses": [{"title": "Intro to CS"}]}
        )

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="What CSCI classes are there?",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        mock_executor.assert_called_once_with(
            name="search_courses", subject="CSCI",
        )
        self.assertIsInstance(result, ToolCallResult)
        self.assertEqual(result.text, "CSCI 1300 is available MWF 10-10:50.")
        self.assertTrue(result.used_tool)
        self.assertEqual(result.tool_name, "search_courses")
        self.assertEqual(result.tool_args, {"subject": "CSCI"})
        self.assertEqual(http.post.call_count, 2)

    def test_tool_definitions_included_in_payload(self, MockSettings, MockCtxMgr):
        """The first Gemini request payload must include the tool schemas
        inside ``tools[].function_declarations``."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([_gemini_text_response("Ok")])

        with patch("httpx.AsyncClient", return_value=ctx):
            asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Hello",
                tool_definitions=[FAKE_TOOL],
                tool_executor=AsyncMock(),
            ))

        payload = http.post.call_args[1]["json"]
        self.assertIn("tools", payload)
        declarations = payload["tools"][0]["function_declarations"]
        self.assertEqual(declarations[0]["name"], "search_courses")

    def test_function_response_appended_to_second_request(self, MockSettings, MockCtxMgr):
        """After executing a tool, the second Gemini request must contain
        the model's ``functionCall`` and the ``functionResponse``."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        tool_result = {"courses": [{"title": "Algorithms"}]}
        ctx, http = _mock_httpx_client([
            _gemini_function_call_response("search_courses", {"subject": "CSCI"}),
            _gemini_text_response("Here are the results."),
        ])
        mock_executor = AsyncMock(return_value=tool_result)

        with patch("httpx.AsyncClient", return_value=ctx):
            asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Find CSCI courses",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        second_payload = http.post.call_args_list[1][1]["json"]
        contents = second_payload["contents"]

        model_msg = contents[-2]
        self.assertEqual(model_msg["role"], "model")
        self.assertIn("functionCall", model_msg["parts"][0])

        tool_msg = contents[-1]
        self.assertEqual(tool_msg["role"], "user")
        fn_resp = tool_msg["parts"][0]["functionResponse"]
        self.assertEqual(fn_resp["name"], "search_courses")
        self.assertEqual(fn_resp["response"], tool_result)

    def test_no_candidates_returns_error_string(self, MockSettings, MockCtxMgr):
        """If Gemini returns no candidates, return a user-friendly error."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)

        bad_resp = MagicMock()
        bad_resp.json.return_value = {"candidates": []}
        bad_resp.raise_for_status = MagicMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=AsyncMock(post=AsyncMock(return_value=bad_resp)))
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Hello",
                tool_definitions=[FAKE_TOOL],
                tool_executor=AsyncMock(),
            ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertIn("unable", result.text.lower())
        self.assertFalse(result.used_tool)

    def test_tool_executor_failure_serialises_error_and_continues(self, MockSettings, MockCtxMgr):
        """If the tool executor raises, the error is serialised as the
        tool result and the loop continues to the follow-up."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_function_call_response("search_courses", {"subject": "CSCI"}),
            _gemini_text_response("Sorry, I couldn't look that up."),
        ])
        mock_executor = AsyncMock(side_effect=RuntimeError("network down"))

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Find CSCI courses",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertTrue(result.used_tool)
        self.assertEqual(result.tool_name, "search_courses")
        self.assertEqual(len(result.tool_calls_made), 1)
        self.assertEqual(http.post.call_count, 2)

    # ------------------------------------------------------------------
    # Multi-tool call in a single response
    # ------------------------------------------------------------------

    def test_parallel_tool_calls_all_executed(self, MockSettings, MockCtxMgr):
        """When Gemini requests multiple function calls in one response,
        all of them are executed and their results fed back."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_multi_function_call_response(
                ("rate_my_professor", {"professor_name": "Dubson"}),
                ("rate_my_professor", {"professor_name": "West"}),
            ),
            _gemini_text_response("Dubson has a 4.5 rating. West has a 3.8 rating."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            {"professors": [{"name": "West", "rating": 3.8}]},
        ])

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Is professor Dubson or West rated better?",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertEqual(mock_executor.call_count, 2)
        self.assertTrue(result.used_tool)
        self.assertIn("Dubson", result.text)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(result.tool_calls_made[0].name, "rate_my_professor")
        self.assertEqual(result.tool_calls_made[1].args, {"professor_name": "West"})
        self.assertEqual(http.post.call_count, 2)

    def test_parallel_tool_results_in_single_user_message(self, MockSettings, MockCtxMgr):
        """All tool results must appear as functionResponse parts in a
        single role:user message in the follow-up request."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_multi_function_call_response(
                ("rate_my_professor", {"professor_name": "Dubson"}),
                ("rate_my_professor", {"professor_name": "West"}),
            ),
            _gemini_text_response("Comparison complete."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson"}]},
            {"professors": [{"name": "West"}]},
        ])

        with patch("httpx.AsyncClient", return_value=ctx):
            asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Compare",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        second_payload = http.post.call_args_list[1][1]["json"]
        contents = second_payload["contents"]

        model_msg = contents[-2]
        self.assertEqual(model_msg["role"], "model")
        self.assertEqual(len(model_msg["parts"]), 2)
        self.assertIn("functionCall", model_msg["parts"][0])
        self.assertIn("functionCall", model_msg["parts"][1])

        user_msg = contents[-1]
        self.assertEqual(user_msg["role"], "user")
        self.assertEqual(len(user_msg["parts"]), 2)
        self.assertEqual(user_msg["parts"][0]["functionResponse"]["name"], "rate_my_professor")
        self.assertEqual(user_msg["parts"][1]["functionResponse"]["name"], "rate_my_professor")

    # ------------------------------------------------------------------
    # Multi-round tool calling
    # ------------------------------------------------------------------

    def test_sequential_tool_rounds(self, MockSettings, MockCtxMgr):
        """The loop handles a second round of tool calls after the first
        results are fed back."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_function_call_response("rate_my_professor", {"professor_name": "Dubson"}),
            _gemini_function_call_response("rate_my_professor", {"professor_name": "West"}),
            _gemini_text_response("Dubson is rated higher than West."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            {"professors": [{"name": "West", "rating": 3.8}]},
        ])

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Compare Dubson and West",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertEqual(mock_executor.call_count, 2)
        self.assertTrue(result.used_tool)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(result.tool_name, "rate_my_professor")
        self.assertEqual(http.post.call_count, 3)

    # ------------------------------------------------------------------
    # Partial failure in multi-tool context
    # ------------------------------------------------------------------

    def test_partial_tool_failure_continues(self, MockSettings, MockCtxMgr):
        """If one tool call in a batch fails, the error is serialised
        and the loop continues to the follow-up."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        ctx, http = _mock_httpx_client([
            _gemini_multi_function_call_response(
                ("rate_my_professor", {"professor_name": "Dubson"}),
                ("rate_my_professor", {"professor_name": "West"}),
            ),
            _gemini_text_response("Only Dubson data available."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            RuntimeError("network down"),
        ])

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(gemini.generate_with_tools(
                system_prompt="You are helpful.",
                user_message="Compare",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertTrue(result.used_tool)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(http.post.call_count, 2)
