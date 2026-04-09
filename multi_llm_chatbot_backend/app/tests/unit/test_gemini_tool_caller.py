import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.llm.gemini_tool_caller import generate_with_tools, ToolCallResult


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
    """Simulate a Gemini response that requests a function call."""
    return {
        "candidates": [{
            "content": {
                "parts": [{"functionCall": {"name": name, "args": args}}],
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


class TestGenerateWithTools(unittest.TestCase):
    """Unit tests for the Gemini tool-calling loop."""

    def test_direct_text_response_returns_text(self):
        """When Gemini responds with text (no tool call), return it."""
        ctx, client = _mock_httpx_client([
            _gemini_text_response("Hello, world!"),
        ])
        mock_executor = AsyncMock()

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(generate_with_tools(
                api_key="fake-key",
                model_name="gemini-2.0-flash",
                system_prompt="You are helpful.",
                user_message="Hi there",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertEqual(result.text, "Hello, world!")
        self.assertFalse(result.used_tool)
        mock_executor.assert_not_called()

    def test_function_call_triggers_executor_and_returns_final_text(self):
        """When Gemini requests a function call, execute it and return
        the text from the follow-up Gemini response."""
        ctx, client = _mock_httpx_client([
            _gemini_function_call_response("search_courses", {"subject": "CSCI"}),
            _gemini_text_response("CSCI 1300 is available MWF 10-10:50."),
        ])
        mock_executor = AsyncMock(
            return_value={"courses": [{"title": "Intro to CS"}]}
        )

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(generate_with_tools(
                api_key="fake-key",
                model_name="gemini-2.0-flash",
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
        self.assertEqual(client.post.call_count, 2)

    def test_tool_definitions_included_in_payload(self):
        """The first Gemini request payload must include the tool schemas
        inside ``tools[].function_declarations``."""
        ctx, client = _mock_httpx_client([
            _gemini_text_response("Ok"),
        ])

        with patch("httpx.AsyncClient", return_value=ctx):
            asyncio.run(generate_with_tools(
                api_key="fake-key",
                model_name="gemini-2.0-flash",
                system_prompt="You are helpful.",
                user_message="Hello",
                tool_definitions=[FAKE_TOOL],
                tool_executor=AsyncMock(),
            ))

        payload = client.post.call_args[1]["json"]
        self.assertIn("tools", payload)
        declarations = payload["tools"][0]["function_declarations"]
        self.assertEqual(declarations[0]["name"], "search_courses")

    def test_function_response_appended_to_second_request(self):
        """After executing a tool, the second Gemini request must contain
        the model's ``functionCall`` and the ``functionResponse``."""
        tool_result = {"courses": [{"title": "Algorithms"}]}
        ctx, client = _mock_httpx_client([
            _gemini_function_call_response("search_courses", {"subject": "CSCI"}),
            _gemini_text_response("Here are the results."),
        ])
        mock_executor = AsyncMock(return_value=tool_result)

        with patch("httpx.AsyncClient", return_value=ctx):
            asyncio.run(generate_with_tools(
                api_key="fake-key",
                model_name="gemini-2.0-flash",
                system_prompt="You are helpful.",
                user_message="Find CSCI courses",
                tool_definitions=[FAKE_TOOL],
                tool_executor=mock_executor,
            ))

        second_payload = client.post.call_args_list[1][1]["json"]
        contents = second_payload["contents"]

        model_msg = contents[-2]
        self.assertEqual(model_msg["role"], "model")
        self.assertIn("functionCall", model_msg["parts"][0])

        tool_msg = contents[-1]
        self.assertEqual(tool_msg["role"], "user")
        fn_resp = tool_msg["parts"][0]["functionResponse"]
        self.assertEqual(fn_resp["name"], "search_courses")
        self.assertEqual(fn_resp["response"], tool_result)

    def test_no_candidates_returns_error_string(self):
        """If Gemini returns no candidates, return a user-friendly error."""
        bad_resp = MagicMock()
        bad_resp.json.return_value = {"candidates": []}
        bad_resp.raise_for_status = MagicMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=AsyncMock(post=AsyncMock(return_value=bad_resp)))
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(generate_with_tools(
                api_key="fake-key",
                model_name="gemini-2.0-flash",
                system_prompt="You are helpful.",
                user_message="Hello",
                tool_definitions=[FAKE_TOOL],
                tool_executor=AsyncMock(),
            ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertIn("unable", result.text.lower())
        self.assertFalse(result.used_tool)
