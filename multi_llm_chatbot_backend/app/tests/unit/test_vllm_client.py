import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from openai import APIConnectionError, APIStatusError

from app.llm.llm_client import ToolCallResult
from app.llm.improved_vllm_client import ImprovedVllmClient


FAKE_URL = "https://fake.example.com/vllm0"
FAKE_KEY = "test-key"

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


def _make_completion_mock(content="Response"):
    """Build a mock that looks like an OpenAI ChatCompletion."""
    mock_message = MagicMock()
    mock_message.content = content
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    return MagicMock(choices=[mock_choice])


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


@patch("app.llm.improved_vllm_client.get_context_manager")
@patch("app.llm.improved_vllm_client.AsyncOpenAI")
class TestImprovedVllmClient(unittest.TestCase):

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def test_constructor_stores_attributes(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        self.assertEqual(client.api_url, FAKE_URL)
        self.assertEqual(client.api_key, FAKE_KEY)
        self.assertEqual(client.model_name, "test-model")

    def test_constructor_defaults_model_to_none(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(api_url=FAKE_URL, api_key=FAKE_KEY)
        self.assertIsNone(client.model_name)

    # ------------------------------------------------------------------
    # Model discovery
    # ------------------------------------------------------------------

    def test_refresh_model_discovers_model(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(api_url=FAKE_URL, api_key=FAKE_KEY)

        mock_model = MagicMock()
        mock_model.id = "discovered-model"
        client.client.models.list = AsyncMock(
            return_value=MagicMock(data=[mock_model])
        )

        asyncio.run(client.refresh_model())
        self.assertEqual(client.model_name, "discovered-model")

    # ------------------------------------------------------------------
    # generate – happy path
    # ------------------------------------------------------------------

    def test_generate_returns_cleaned_response(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock("  Here is my response.  ")
        )

        result = asyncio.run(client.generate(
            system_prompt="You are helpful.",
            context=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100,
        ))
        self.assertEqual(result, "Here is my response.")

    def test_generate_auto_discovers_model_when_none(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name=None,
        )

        mock_model = MagicMock()
        mock_model.id = "auto-discovered"
        client.client.models.list = AsyncMock(
            return_value=MagicMock(data=[mock_model])
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock()
        )

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))

        client.client.models.list.assert_called_once()
        self.assertEqual(client.model_name, "auto-discovered")

    # ------------------------------------------------------------------
    # generate – error handling
    # ------------------------------------------------------------------

    def test_generate_handles_connection_error(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIConnectionError(request=MagicMock())
        )

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("unable to connect", result.lower())

    def test_generate_handles_status_error(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        mock_response = MagicMock()
        mock_response.status_code = 500
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                message="Server error", response=mock_response, body=None,
            )
        )

        result = asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIn("error", result.lower())

    def test_generate_clears_model_on_404(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="stale-model",
        )
        mock_response = MagicMock()
        mock_response.status_code = 404
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIStatusError(
                message="Model not found", response=mock_response, body=None,
            )
        )

        asyncio.run(client.generate(
            system_prompt="Test",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.5,
            max_tokens=50,
        ))
        self.assertIsNone(client.model_name)

    # ------------------------------------------------------------------
    # generate – response_format for JSON
    # ------------------------------------------------------------------

    def test_generate_passes_response_format_for_json(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock('{"key": "value"}')
        )

        asyncio.run(client.generate(
            system_prompt="Return JSON",
            context=[{"role": "user", "content": "Hi"}],
            temperature=0.3,
            max_tokens=100,
            response_mime_type="application/json",
        ))

        call_kwargs = client.client.chat.completions.create.call_args.kwargs
        self.assertEqual(call_kwargs["response_format"], {"type": "json_object"})

    def test_generate_omits_response_format_when_no_mime_type(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_completion_mock("plain text response")
        )

        asyncio.run(client.generate(
            system_prompt="You are helpful.",
            context=[{"role": "user", "content": "Hello"}],
            temperature=0.7,
            max_tokens=100,
        ))

        call_kwargs = client.client.chat.completions.create.call_args.kwargs
        self.assertNotIn("response_format", call_kwargs)

    # ------------------------------------------------------------------
    # _clean_response
    # ------------------------------------------------------------------

    def test_clean_response_normalizes_whitespace(self, MockAsyncOpenAI, mock_get_ctx):
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        dirty = "Line one.\r\n\r\n\r\n\r\nLine two.  "
        cleaned = client._clean_response(dirty)
        self.assertNotIn("\r", cleaned)
        self.assertNotIn("\n\n\n", cleaned)
        self.assertEqual(cleaned, "Line one.\n\nLine two.")


@patch("app.llm.improved_vllm_client.get_context_manager")
@patch("app.llm.improved_vllm_client.AsyncOpenAI")
class TestVllmGenerateWithTools(unittest.TestCase):
    """Unit tests for ImprovedVllmClient.generate_with_tools()."""

    # ------------------------------------------------------------------
    # Happy path — no tool call
    # ------------------------------------------------------------------

    def test_text_response_returns_not_used(self, MockAsyncOpenAI, mock_get_ctx):
        """When the model responds with plain text, return used_tool=False."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_text_completion_mock("Hello, world!"),
        )

        result = asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Hi there",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertEqual(result.text, "Hello, world!")
        self.assertFalse(result.used_tool)

    # ------------------------------------------------------------------
    # Happy path — tool call
    # ------------------------------------------------------------------

    def test_tool_call_executes_and_returns_final_text(self, MockAsyncOpenAI, mock_get_ctx):
        """When the model requests a tool call, execute it and return
        the text from the follow-up completion."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("CSCI 1300 is available MWF 10-10:50."),
        ])
        mock_executor = AsyncMock(
            return_value={"courses": [{"title": "Intro to CS"}]},
        )

        result = asyncio.run(client.generate_with_tools(
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
        self.assertEqual(client.client.chat.completions.create.call_count, 2)

    # ------------------------------------------------------------------
    # Payload format
    # ------------------------------------------------------------------

    def test_tool_definitions_passed_through_in_openai_format(self, MockAsyncOpenAI, mock_get_ctx):
        """Tool definitions (already in OpenAI format) are passed through
        directly to the completions API."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            return_value=_make_text_completion_mock("Ok"),
        )

        asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Hello",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        call_kwargs = client.client.chat.completions.create.call_args[1]
        tools = call_kwargs["tools"]
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["type"], "function")
        self.assertEqual(tools[0]["function"]["name"], "search_courses")
        self.assertIn("parameters", tools[0]["function"])

    def test_tool_result_appended_to_followup(self, MockAsyncOpenAI, mock_get_ctx):
        """After executing a tool, the follow-up call must include
        the assistant message, a ``role: tool`` message, and ``tools=``."""
        tool_output = {"courses": [{"title": "Algorithms"}]}
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("Here are the results."),
        ])
        mock_executor = AsyncMock(return_value=tool_output)

        asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Find CSCI courses",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        second_call_kwargs = client.client.chat.completions.create.call_args_list[1][1]
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

    def test_tool_executor_failure_serialises_error_and_continues(self, MockAsyncOpenAI, mock_get_ctx):
        """If the tool executor raises, the error is serialised as the
        tool result and the loop continues to the follow-up completion."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("search_courses", {"subject": "CSCI"}),
            _make_text_completion_mock("Sorry, I couldn't look that up."),
        ])
        mock_executor = AsyncMock(side_effect=RuntimeError("network down"))

        result = asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Find CSCI courses",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertTrue(result.used_tool)
        self.assertEqual(result.tool_name, "search_courses")
        self.assertEqual(len(result.tool_calls_made), 1)

        second_call_msgs = client.client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msg = [m for m in second_call_msgs if m.get("role") == "tool"][0]
        self.assertIn("network down", json.loads(tool_msg["content"])["error"])

    def test_connection_error_returns_not_used(self, MockAsyncOpenAI, mock_get_ctx):
        """APIConnectionError during tool calling returns used_tool=False."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(
            side_effect=APIConnectionError(request=MagicMock()),
        )

        result = asyncio.run(client.generate_with_tools(
            system_prompt="Test",
            user_message="Hi",
            tool_definitions=[FAKE_TOOL],
            tool_executor=AsyncMock(),
        ))

        self.assertIsInstance(result, ToolCallResult)
        self.assertFalse(result.used_tool)
        self.assertIn("unable to connect", result.text.lower())

    # ------------------------------------------------------------------
    # Multi-tool call in a single response
    # ------------------------------------------------------------------

    def test_parallel_tool_calls_all_executed(self, MockAsyncOpenAI, mock_get_ctx):
        """When the model requests multiple tool calls in one response,
        all of them are executed and their results fed back."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
            _make_multi_tool_call_mock([
                ("rate_my_professor", {"professor_name": "Dubson"}, "call_a"),
                ("rate_my_professor", {"professor_name": "West"}, "call_b"),
            ]),
            _make_text_completion_mock("Dubson has a 4.5 rating. West has a 3.8 rating."),
        ])
        mock_executor = AsyncMock(
            side_effect=[
                {"professors": [{"name": "Dubson", "rating": 4.5}]},
                {"professors": [{"name": "West", "rating": 3.8}]},
            ],
        )

        result = asyncio.run(client.generate_with_tools(
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
        self.assertEqual(client.client.chat.completions.create.call_count, 2)

    def test_parallel_tool_results_all_in_followup_messages(self, MockAsyncOpenAI, mock_get_ctx):
        """All tool results must appear as separate role:tool messages
        in the follow-up request."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
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

        asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Compare",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        second_call_msgs = client.client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msgs = [m for m in second_call_msgs if m.get("role") == "tool"]
        self.assertEqual(len(tool_msgs), 2)
        self.assertEqual(tool_msgs[0]["tool_call_id"], "call_a")
        self.assertEqual(tool_msgs[1]["tool_call_id"], "call_b")

    # ------------------------------------------------------------------
    # Multi-round tool calling
    # ------------------------------------------------------------------

    def test_sequential_tool_rounds(self, MockAsyncOpenAI, mock_get_ctx):
        """The loop handles a second round of tool calls after the first
        results are fed back."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
            _make_tool_call_mock("rate_my_professor", {"professor_name": "Dubson"}, "call_1"),
            _make_tool_call_mock("rate_my_professor", {"professor_name": "West"}, "call_2"),
            _make_text_completion_mock("Dubson is rated higher than West."),
        ])
        mock_executor = AsyncMock(side_effect=[
            {"professors": [{"name": "Dubson", "rating": 4.5}]},
            {"professors": [{"name": "West", "rating": 3.8}]},
        ])

        result = asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Compare Dubson and West",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertEqual(mock_executor.call_count, 2)
        self.assertTrue(result.used_tool)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(result.tool_name, "rate_my_professor")
        self.assertEqual(client.client.chat.completions.create.call_count, 3)

    # ------------------------------------------------------------------
    # Tool executor failure in multi-tool context
    # ------------------------------------------------------------------

    def test_partial_tool_failure_continues(self, MockAsyncOpenAI, mock_get_ctx):
        """If one tool call in a batch fails, the error is serialised
        and the loop continues to the follow-up."""
        client = ImprovedVllmClient(
            api_url=FAKE_URL, api_key=FAKE_KEY, model_name="test-model",
        )
        client.client.chat.completions.create = AsyncMock(side_effect=[
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

        result = asyncio.run(client.generate_with_tools(
            system_prompt="You are helpful.",
            user_message="Compare",
            tool_definitions=[FAKE_TOOL],
            tool_executor=mock_executor,
        ))

        self.assertTrue(result.used_tool)
        self.assertEqual(len(result.tool_calls_made), 2)
        self.assertEqual(client.client.chat.completions.create.call_count, 2)

        second_call_msgs = client.client.chat.completions.create.call_args_list[1][1]["messages"]
        tool_msgs = [m for m in second_call_msgs if m.get("role") == "tool"]
        self.assertEqual(len(tool_msgs), 2)
        error_content = json.loads(tool_msgs[1]["content"])
        self.assertIn("error", error_content)

