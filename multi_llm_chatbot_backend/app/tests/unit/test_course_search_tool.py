import asyncio
import unittest

from app.tools.search_courses import TOOL_DEFINITION, execute


class TestSearchCoursesContract(unittest.TestCase):
    """The search_courses tool module must export a valid OpenAI
    tool definition and an async executor."""

    def test_tool_definition_has_required_fields(self):
        self.assertEqual(TOOL_DEFINITION["type"], "function")
        self.assertIn("function", TOOL_DEFINITION)
        fn = TOOL_DEFINITION["function"]
        self.assertIn("name", fn)
        self.assertIn("description", fn)
        self.assertIn("parameters", fn)

    def test_tool_definition_name(self):
        self.assertEqual(TOOL_DEFINITION["function"]["name"], "search_courses")

    def test_tool_definition_has_nonempty_description(self):
        self.assertIsInstance(TOOL_DEFINITION["function"]["description"], str)
        self.assertGreater(len(TOOL_DEFINITION["function"]["description"]), 0)

    def test_tool_definition_parameters_is_valid_schema(self):
        params = TOOL_DEFINITION["function"]["parameters"]
        self.assertEqual(params["type"], "object")
        self.assertIn("properties", params)
        self.assertIn("subject", params["properties"])

    def test_execute_is_async_callable(self):
        self.assertTrue(asyncio.iscoroutinefunction(execute))
