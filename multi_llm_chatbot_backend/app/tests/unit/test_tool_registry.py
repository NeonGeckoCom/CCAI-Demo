import asyncio
import unittest
from unittest.mock import AsyncMock

from app.tools import (
    get_tool_definitions,
    get_tool_executor,
    list_registered_tools,
    _REGISTRY,
)


KNOWN_TOOLS = {"search_courses", "rate_my_professor"}


class TestToolDiscovery(unittest.TestCase):
    """Auto-discovery should find every tool module that exports
    TOOL_DEFINITION + execute."""

    def test_known_tools_are_discovered(self):
        registered = set(list_registered_tools())
        for name in KNOWN_TOOLS:
            self.assertIn(name, registered, f"Tool '{name}' was not discovered")

    def test_registry_entries_have_definition_and_executor(self):
        for name, entry in _REGISTRY.items():
            self.assertIn("definition", entry, f"'{name}' missing definition")
            self.assertIn("executor", entry, f"'{name}' missing executor")

    def test_definitions_have_required_fields(self):
        for name, entry in _REGISTRY.items():
            defn = entry["definition"]
            self.assertIn("name", defn)
            self.assertIn("description", defn)
            self.assertIn("parameters", defn)
            self.assertEqual(defn["name"], name)

    def test_executors_are_async_callables(self):
        for name, entry in _REGISTRY.items():
            self.assertTrue(
                asyncio.iscoroutinefunction(entry["executor"]),
                f"Executor for '{name}' is not an async function",
            )


class TestGetToolDefinitions(unittest.TestCase):
    """get_tool_definitions() returns Gemini function-declaration dicts,
    optionally filtered."""

    def test_returns_all_when_no_filter(self):
        defs = get_tool_definitions()
        names = {d["name"] for d in defs}
        self.assertTrue(KNOWN_TOOLS.issubset(names))

    def test_filter_to_single_tool(self):
        defs = get_tool_definitions(enabled=["search_courses"])
        self.assertEqual(len(defs), 1)
        self.assertEqual(defs[0]["name"], "search_courses")

    def test_filter_to_multiple_tools(self):
        defs = get_tool_definitions(enabled=["search_courses", "rate_my_professor"])
        names = {d["name"] for d in defs}
        self.assertEqual(names, KNOWN_TOOLS)

    def test_filter_with_unknown_name_returns_empty(self):
        defs = get_tool_definitions(enabled=["nonexistent_tool"])
        self.assertEqual(defs, [])

    def test_filter_with_empty_list_returns_empty(self):
        defs = get_tool_definitions(enabled=[])
        self.assertEqual(defs, [])

    def test_filter_ignores_unknown_names_keeps_valid(self):
        defs = get_tool_definitions(enabled=["search_courses", "bogus"])
        self.assertEqual(len(defs), 1)
        self.assertEqual(defs[0]["name"], "search_courses")


class TestGetToolExecutor(unittest.TestCase):
    """get_tool_executor() returns a dispatcher that routes to the
    correct tool executor."""

    def test_dispatch_known_tool(self):
        mock_exec = AsyncMock(return_value={"courses": []})
        original = _REGISTRY["search_courses"]["executor"]
        _REGISTRY["search_courses"]["executor"] = mock_exec
        try:
            dispatch = get_tool_executor()
            result = asyncio.run(dispatch(name="search_courses", subject="CSCI"))
            mock_exec.assert_called_once_with(name="search_courses", subject="CSCI")
            self.assertEqual(result, {"courses": []})
        finally:
            _REGISTRY["search_courses"]["executor"] = original

    def test_dispatch_unknown_tool_returns_error(self):
        dispatch = get_tool_executor()
        result = asyncio.run(dispatch(name="nonexistent"))
        self.assertIn("error", result)

    def test_filtered_executor_allows_enabled_tool(self):
        mock_exec = AsyncMock(return_value={"courses": []})
        original = _REGISTRY["search_courses"]["executor"]
        _REGISTRY["search_courses"]["executor"] = mock_exec
        try:
            dispatch = get_tool_executor(enabled=["search_courses"])
            result = asyncio.run(dispatch(name="search_courses", subject="CSCI"))
            self.assertNotIn("error", result)
        finally:
            _REGISTRY["search_courses"]["executor"] = original

    def test_filtered_executor_blocks_disabled_tool(self):
        dispatch = get_tool_executor(enabled=["search_courses"])
        result = asyncio.run(dispatch(name="rate_my_professor", professor_name="Smith"))
        self.assertIn("error", result)
        self.assertIn("not enabled", result["error"])

    def test_filtered_executor_with_empty_list_blocks_all(self):
        dispatch = get_tool_executor(enabled=[])
        result = asyncio.run(dispatch(name="search_courses", subject="CSCI"))
        self.assertIn("error", result)
