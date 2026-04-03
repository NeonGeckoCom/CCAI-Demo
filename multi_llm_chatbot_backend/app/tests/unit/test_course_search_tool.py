import asyncio
import unittest

from app.tools.search_courses import TOOL_DEFINITION, execute


class TestSearchCoursesContract(unittest.TestCase):
    """The search_courses tool module must export a valid Gemini
    function declaration and an async executor."""

    def test_tool_definition_has_required_fields(self):
        self.assertIn("name", TOOL_DEFINITION)
        self.assertIn("description", TOOL_DEFINITION)
        self.assertIn("parameters", TOOL_DEFINITION)

    def test_tool_definition_name(self):
        self.assertEqual(TOOL_DEFINITION["name"], "search_courses")

    def test_tool_definition_has_nonempty_description(self):
        self.assertIsInstance(TOOL_DEFINITION["description"], str)
        self.assertGreater(len(TOOL_DEFINITION["description"]), 0)

    def test_tool_definition_parameters_is_valid_schema(self):
        params = TOOL_DEFINITION["parameters"]
        self.assertEqual(params["type"], "object")
        self.assertIn("properties", params)
        self.assertIn("subject", params["properties"])

    def test_execute_is_async_callable(self):
        self.assertTrue(asyncio.iscoroutinefunction(execute))
