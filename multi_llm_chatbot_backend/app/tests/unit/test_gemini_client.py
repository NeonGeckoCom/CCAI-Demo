import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from openai import APIConnectionError, APIStatusError

from app.llm.llm_client import ToolCallResult
from app.llm.improved_gemini_client import ImprovedGeminiClient


FAKE_TOOL = {
    "type": "function",
    "function": {
        "name": "search_courses",
        "description": "Search courses",
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "Subject code"},
            },
        },
    },
}


def _make_text_completion_mock(content="Response"):
    """Build a ChatCompletion mock with no tool calls."""
    mock_message = MagicMock()
    mock_message.content = content
    mock_message.tool_calls = None
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    return MagicMock(choices=[mock_choice])


def _make_tool_call_mock(fn_name, fn_args_dict, tool_call_id="call_123"):
    """Build a ChatCompletion mock where the model requests a tool call."""
    fn_args_json = json.dumps(fn_args_dict)

    tool_call = MagicMock()
    tool_call.id = tool_call_id
    tool_call.function.name = fn_name
    tool_call.function.arguments = fn_args_json

    mock_message = MagicMock()
    mock_message.content = None
    mock_message.tool_calls = [tool_call]
    mock_message.model_dump.return_value = {
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": tool_call_id,
            "type": "function",
            "function": {"name": fn_name, "arguments": fn_args_json},
        }],
    }

    mock_choice = MagicMock()
    mock_choice.message = mock_message
    return MagicMock(choices=[mock_choice])


def _make_multi_tool_call_mock(calls):
    """Build a ChatCompletion mock with multiple parallel tool calls.

    *calls* is a list of (fn_name, fn_args_dict, tool_call_id) tuples.
    """
    tool_calls = []
    dump_calls = []
    for fn_name, fn_args_dict, tool_call_id in calls:
        fn_args_json = json.dumps(fn_args_dict)
        tc = MagicMock()
        tc.id = tool_call_id
        tc.function.name = fn_name
        tc.function.arguments = fn_args_json
        tool_calls.append(tc)
        dump_calls.append({
            "id": tool_call_id,
            "type": "function",
            "function": {"name": fn_name, "arguments": fn_args_json},
        })

    mock_message = MagicMock()
    mock_message.content = None
    mock_message.tool_calls = tool_calls
    mock_message.model_dump.return_value = {
        "role": "assistant",
        "content": None,
        "tool_calls": dump_calls,
    }

    mock_choice = MagicMock()
    mock_choice.message = mock_message
    return MagicMock(choices=[mock_choice])


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
    """Unit tests for ImprovedGeminiClient.generate_with_tools()
    using the OpenAI-compatible endpoint."""

    # ------------------------------------------------------------------
    # Happy path — no tool call
    # ------------------------------------------------------------------

    def test_direct_text_response_returns_text(self, MockSettings, MockCtxMgr):
        """When the model responds with text (no tool call), return it."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(
            return_value=_make_text_completion_mock("Hello, world!"),
        )
        mock_executor = AsyncMock()

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

    # ------------------------------------------------------------------
    # Happy path — tool call
    # ------------------------------------------------------------------

    def test_function_call_triggers_executor_and_returns_final_text(self, MockSettings, MockCtxMgr):
        """When the model requests a tool call, execute it and return
        the text from the follow-up completion."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("CSCI 1300 is available MWF 10-10:50."),
        ])
        mock_executor = AsyncMock(
            return_value={"courses": [{"title": "Intro to CS"}]}
        )

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
        self.assertEqual(len(result.tool_calls_made), 1)
        self.assertEqual(result.tool_calls_made[0].name, "search_courses")
        self.assertEqual(gemini.openai_client.chat.completions.create.call_count, 2)

    # ------------------------------------------------------------------
    # Payload format
    # ------------------------------------------------------------------

    def test_tool_definitions_passed_through_in_openai_format(self, MockSettings, MockCtxMgr):
        """Tool definitions (already in OpenAI format) are passed through
        directly to the completions API."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(
            return_value=_make_text_completion_mock("Ok"),
        )

        asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Hello",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        call_kwargs = gemini.openai_client.chat.completions.create.call_args[1]
        tools = call_kwargs["tools"]
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["type"], "function")
        self.assertEqual(tools[0]["function"]["name"], "search_courses")
        self.assertIn("parameters", tools[0]["function"])

    def test_tool_result_appended_to_followup(self, MockSettings, MockCtxMgr):
        """After executing a tool, the follow-up call must include
        the assistant message, a ``role: tool`` message, and ``tools=``."""
        tool_output = {"courses": [{"title": "Algorithms"}]}
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("Here are the results."),
        ])
        mock_executor = AsyncMock(return_value=tool_output)

        asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Find CSCI courses",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        second_call_kwargs = gemini.openai_client.chat.completions.create.call_args_list[1][1]
        messages = second_call_kwargs["messages"]

        assistant_msg = messages[-2]
        self.assertEqual(assistant_msg["role"], "assistant")

        tool_msg = messages[-1]
        self.assertEqual(tool_msg["role"], "tool")
        self.assertEqual(tool_msg["tool_call_id"], "call_123")
        self.assertEqual(json.loads(tool_msg["content"]), tool_output)

        self.assertIn("tools", second_call_kwargs,
                       "Follow-up call must include tools= so the model can "
                       "request additional tool calls if needed")

    # ------------------------------------------------------------------
    # Error handling
    # ------------------------------------------------------------------

    def test_tool_executor_failure_serialises_error_and_continues(self, MockSettings, MockCtxMgr):
        """If the tool executor raises, the error is serialised as the
        tool result and the loop continues to the follow-up completion."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("Sorry, I couldn't look that up."),
        ])
        mock_executor = AsyncMock(side_effect=RuntimeError("network down"))

        result = asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Find CSCI courses",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertTrue(result.used_tool)
        self.assertEqual(result.tool_name, "search_courses")
        self.assertEqual(len(result.tool_calls_made), 1)

        second_call_msgs = gemini.openai_client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msg = [m for m in second_call_msgs if m.get("role") == "tool"][0]
        self.assertIn("network down", json.loads(tool_msg["content"])["error"])

    def test_connection_error_returns_not_used(self, MockSettings, MockCtxMgr):
        """APIConnectionError during tool calling returns used_tool=False."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(
            side_effect=APIConnectionError(request=MagicMock()),
        )

        result = asyncio.run(gemini.generate_with_tools(
            system_prompt="Test",
            user_message="Hi",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertFalse(result.used_tool)
        self.assertIn("unable to connect", result.text.lower())

    def test_status_error_returns_not_used(self, MockSettings, MockCtxMgr):
        """APIStatusError during tool calling returns used_tool=False."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        mock_response = MagicMock()
        mock_response.status_code = 500
        gemini.openai_client.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                message="Server error", response=mock_response, body=None,
            )
        )

        result = asyncio.run(gemini.generate_with_tools(
            system_prompt="Test",
            user_message="Hi",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertFalse(result.used_tool)
        self.assertIn("error", result.text.lower())

    # ------------------------------------------------------------------
    # Multi-tool call in a single response
    # ------------------------------------------------------------------

    def test_parallel_tool_calls_all_executed(self, MockSettings, MockCtxMgr):
        """When the model requests multiple tool calls in one response,
        all of them are executed and their results fed back."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_multi_tool_call_mock([
                ("rate_my_professor", {"professor_name": "Dubson"}, "call_a"),
                ("rate_my_professor", {"professor_name": "West"}, "call_b"),
            ]),
            _make_text_completion_mock("Dubson has a 4.5 rating. West has a 3.8 rating."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            {"professors": [{"name": "West", "rating": 3.8}]},
        ])

        result = asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Is professor Dubson or West rated better?",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertEqual(mock_executor.call_count, 2)
        self.assertTrue(result.used_tool)
        self.assertIn("Dubson", result.text)
        self.assertIn("West", result.text)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(result.tool_calls_made[0].name, "rate_my_professor")
        self.assertEqual(result.tool_calls_made[1].args, {"professor_name": "West"})
        self.assertEqual(gemini.openai_client.chat.completions.create.call_count, 2)

    def test_parallel_tool_results_all_in_followup_messages(self, MockSettings, MockCtxMgr):
        """All tool results must appear as separate role:tool messages
        in the follow-up request."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_multi_tool_call_mock([
                ("rate_my_professor", {"professor_name": "Dubson"}, "call_a"),
                ("rate_my_professor", {"professor_name": "West"}, "call_b"),
            ]),
            _make_text_completion_mock("Comparison complete."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson"}]},
            {"professors": [{"name": "West"}]},
        ])

        asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Compare",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        second_call_msgs = gemini.openai_client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msgs = [m for m in second_call_msgs if m.get("role") == "tool"]
        self.assertEqual(len(tool_msgs), 2)
        self.assertEqual(tool_msgs[0]["tool_call_id"], "call_a")
        self.assertEqual(tool_msgs[1]["tool_call_id"], "call_b")

    # ------------------------------------------------------------------
    # Multi-round tool calling
    # ------------------------------------------------------------------

    def test_sequential_tool_rounds(self, MockSettings, MockCtxMgr):
        """The loop handles a second round of tool calls after the first
        results are fed back."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("rate_my_professor", {"professor_name": "Dubson"}, "call_1"),
            _make_tool_call_mock("rate_my_professor", {"professor_name": "West"}, "call_2"),
            _make_text_completion_mock("Dubson is rated higher than West."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            {"professors": [{"name": "West", "rating": 3.8}]},
        ])

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
        self.assertEqual(gemini.openai_client.chat.completions.create.call_count, 3)

    # ------------------------------------------------------------------
    # Partial failure in multi-tool context
    # ------------------------------------------------------------------

    def test_partial_tool_failure_continues(self, MockSettings, MockCtxMgr):
        """If one tool call in a batch fails, the error is serialised
        and the loop continues to the follow-up."""
        gemini = _make_gemini_client(MockSettings, MockCtxMgr)
        gemini.openai_client.chat.completions.create = AsyncMock(side_effect=[
            _make_multi_tool_call_mock([
                ("rate_my_professor", {"professor_name": "Dubson"}, "call_a"),
                ("rate_my_professor", {"professor_name": "West"}, "call_b"),
            ]),
            _make_text_completion_mock("Only Dubson data available."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            RuntimeError("network down"),
        ])

        result = asyncio.run(gemini.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Compare",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertTrue(result.used_tool)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(gemini.openai_client.chat.completions.create.call_count, 2)

        second_call_msgs = gemini.openai_client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msgs = [m for m in second_call_msgs if m.get("role") == "tool"]
        self.assertEqual(len(tool_msgs), 2)
        error_content = json.loads(tool_msgs[1]["content"])
        self.assertIn("error", error_content)
