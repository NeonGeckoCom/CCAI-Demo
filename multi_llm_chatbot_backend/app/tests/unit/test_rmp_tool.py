import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.tools.rate_my_professor import TOOL_DEFINITION, execute


def _graphql_success_response(nodes):
    """Build a mock RMP GraphQL response containing the given teacher nodes."""
    edges = [{"cursor": f"c{i}", "node": n} for i, n in enumerate(nodes)]
    return {
        "data": {
            "search": {
                "teachers": {
                    "didFallback": False,
                    "edges": edges,
                    "pageInfo": {"hasNextPage": False, "endCursor": ""},
                }
            }
        }
    }


SAMPLE_NODE = {
    "id": "VGVhY2hlci0xMjM0",
    "legacyId": 1234,
    "firstName": "Jane",
    "lastName": "Smith",
    "department": "Computer Science",
    "school": {"id": "U2Nob29sLTEwODc=", "name": "University of Colorado Boulder"},
    "avgRating": 4.2,
    "avgDifficulty": 3.1,
    "wouldTakeAgainPercent": 85.0,
    "numRatings": 42,
}


class TestRMPToolContract(unittest.TestCase):
    """The rate_my_professor tool module must export a valid Gemini
    function declaration and an async executor."""

    def test_tool_definition_has_required_fields(self):
        self.assertIn("name", TOOL_DEFINITION)
        self.assertIn("description", TOOL_DEFINITION)
        self.assertIn("parameters", TOOL_DEFINITION)

    def test_tool_definition_name(self):
        self.assertEqual(TOOL_DEFINITION["name"], "rate_my_professor")

    def test_tool_definition_has_nonempty_description(self):
        self.assertIsInstance(TOOL_DEFINITION["description"], str)
        self.assertGreater(len(TOOL_DEFINITION["description"]), 0)

    def test_tool_definition_parameters_schema(self):
        params = TOOL_DEFINITION["parameters"]
        self.assertEqual(params["type"], "object")
        self.assertIn("properties", params)
        self.assertIn("professor_name", params["properties"])

    def test_execute_is_async_callable(self):
        self.assertTrue(asyncio.iscoroutinefunction(execute))


class TestRMPToolExecutor(unittest.TestCase):
    """Unit tests for rate_my_professor.execute() with mocked HTTP."""

    def _mock_client(self, get_response, post_response):
        """Build a mock httpx.AsyncClient with canned GET and POST responses."""
        get_resp = MagicMock()
        get_resp.text = '<script>"Authorization":"Basic dGVzdDp0ZXN0"</script>'
        get_resp.raise_for_status = MagicMock()
        if get_response is not None:
            get_resp.text = get_response

        post_resp = MagicMock()
        post_resp.status_code = 200
        post_resp.json.return_value = post_response
        post_resp.raise_for_status = MagicMock()

        client_instance = AsyncMock()
        client_instance.get = AsyncMock(return_value=get_resp)
        client_instance.post = AsyncMock(return_value=post_resp)

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=client_instance)
        ctx.__aexit__ = AsyncMock(return_value=False)
        return ctx, client_instance

    def test_execute_returns_professor_data(self):
        """Successful GraphQL response returns structured professor data."""
        ctx, client = self._mock_client(
            get_response=None,
            post_response=_graphql_success_response([SAMPLE_NODE]),
        )

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(execute(professor_name="Smith"))

        self.assertIn("professors", result)
        self.assertEqual(len(result["professors"]), 1)

        prof = result["professors"][0]
        self.assertEqual(prof["name"], "Jane Smith")
        self.assertEqual(prof["department"], "Computer Science")
        self.assertAlmostEqual(prof["rating"], 4.2)
        self.assertAlmostEqual(prof["difficulty"], 3.1)
        self.assertEqual(prof["num_ratings"], 42)

    def test_execute_returns_empty_on_no_results(self):
        """When the GraphQL API returns no matching professors, return
        an empty list — not an error."""
        ctx, _ = self._mock_client(
            get_response=None,
            post_response=_graphql_success_response([]),
        )

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(execute(professor_name="Nonexistent"))

        self.assertIn("professors", result)
        self.assertEqual(len(result["professors"]), 0)

    def test_execute_returns_error_on_api_failure(self):
        """When the HTTP request fails, return an error payload instead
        of raising an exception."""
        ctx = MagicMock()
        client_instance = AsyncMock()
        client_instance.get = AsyncMock(side_effect=Exception("connection refused"))
        ctx.__aenter__ = AsyncMock(return_value=client_instance)
        ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(execute(professor_name="Smith"))

        self.assertIn("professors", result)
        self.assertEqual(len(result["professors"]), 0)
        self.assertIn("error", result)

    def test_execute_accepts_name_kwarg(self):
        """The dispatcher passes name= as a kwarg; execute must accept
        and ignore it without error."""
        ctx, _ = self._mock_client(
            get_response=None,
            post_response=_graphql_success_response([SAMPLE_NODE]),
        )

        with patch("httpx.AsyncClient", return_value=ctx):
            result = asyncio.run(
                execute(name="rate_my_professor", professor_name="Smith")
            )

        self.assertIn("professors", result)
        self.assertEqual(len(result["professors"]), 1)
