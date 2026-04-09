"""
rate_my_professor tool — live query against RateMyProfessors' GraphQL API
for CU Boulder professors.

Exposes TOOL_DEFINITION (Gemini function-declaration schema) and an
execute() coroutine that the tool-calling loop dispatches to.
"""

import logging
import re
from typing import Any, Dict, List
import httpx
from app.tools import BROWSER_UA

logger = logging.getLogger(__name__)

RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
RMP_LANDING_URL = "https://www.ratemyprofessors.com/"
RMP_SEARCH_URL = "https://www.ratemyprofessors.com/search/professors/1087"

# base64("School-1087") — CU Boulder's school ID in RMP's GraphQL schema
CU_BOULDER_SCHOOL_ID = "U2Nob29sLTEwODc="

TEACHER_SEARCH_QUERY = """
query TeacherSearchPaginationQuery(
  $count: Int!
  $cursor: String
  $query: TeacherSearchQuery!
) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      didFallback
      edges {
        cursor
        node {
          id
          legacyId
          firstName
          lastName
          department
          school { id name }
          avgRating
          avgDifficulty
          wouldTakeAgainPercent
          numRatings
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

TOOL_DEFINITION: Dict[str, Any] = {
    "name": "rate_my_professor",
    "description": (
        "Look up RateMyProfessors ratings for a CU Boulder professor. "
        "Returns rating, difficulty, percentage of students who would "
        "take the professor again, and number of ratings."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "professor_name": {
                "type": "string",
                "description": (
                    "Full or partial name of the professor to search for, "
                    "e.g. 'Hoenigman', 'Jane Smith'."
                ),
            },
        },
        "required": ["professor_name"],
    },
}


def _node_to_professor(node: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a GraphQL teacher node to a lightweight result dict."""
    return {
        "name": f"{node.get('firstName', '')} {node.get('lastName', '')}".strip(),
        "department": node.get("department", ""),
        "rating": node.get("avgRating", 0),
        "difficulty": node.get("avgDifficulty", 0),
        "would_take_again_pct": node.get("wouldTakeAgainPercent", -1),
        "num_ratings": node.get("numRatings", 0),
        "rmp_id": node.get("id", ""),
    }


async def _extract_auth_token(client: httpx.AsyncClient) -> str:
    """Fetch the RMP landing page and extract the auth token from the JS bundle.

    Falls back to the well-known Basic test:test token.
    """
    try:
        resp = await client.get(
            RMP_LANDING_URL, headers={"User-Agent": BROWSER_UA},
        )
        m = re.search(
            r'"Authorization"\s*:\s*"(Basic\s+[A-Za-z0-9+/=]+)"', resp.text,
        )
        if m:
            logger.info("Extracted RMP auth token from page JS")
            return m.group(1)
    except Exception as exc:
        logger.debug("RMP auth token extraction failed: %s", exc)

    return "Basic dGVzdDp0ZXN0"


async def execute(
    *,
    name: str = "",
    professor_name: str,
) -> Dict[str, Any]:
    """Query RateMyProfessors for a CU Boulder professor by name.

    The 'name' kwarg is passed by the dispatch loop and ignored here.
    Returns {"professors": [...], "query": {...}}.
    """
    professors: List[Dict[str, Any]] = []

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            auth_token = await _extract_auth_token(client)

            headers = {
                "User-Agent": BROWSER_UA,
                "Authorization": auth_token,
                "Content-Type": "application/json",
                "Referer": f"{RMP_SEARCH_URL}?q={professor_name}",
                "Origin": "https://www.ratemyprofessors.com",
            }

            variables = {
                "count": 20,
                "cursor": "",
                "query": {
                    "text": professor_name,
                    "schoolID": CU_BOULDER_SCHOOL_ID,
                    "fallback": True,
                    "departmentID": None,
                },
            }

            resp = await client.post(
                RMP_GRAPHQL_URL,
                json={"query": TEACHER_SEARCH_QUERY, "variables": variables},
                headers=headers,
            )

            if resp.status_code == 403:
                logger.warning("RMP GraphQL returned 403 — auth may be invalid")
                return {
                    "professors": [],
                    "error": "RateMyProfessors authentication failed",
                    "query": {"professor_name": professor_name},
                }

            resp.raise_for_status()
            data = resp.json()

            teachers = (
                data.get("data", {})
                .get("search", {})
                .get("teachers", {})
            )

            for edge in teachers.get("edges", []):
                node = edge.get("node", {})
                if node:
                    professors.append(_node_to_professor(node))

    except Exception as exc:
        logger.error("RMP API error for %s: %s", professor_name, exc)
        return {
            "professors": [],
            "error": str(exc),
            "query": {"professor_name": professor_name},
        }

    return {
        "professors": professors,
        "query": {"professor_name": professor_name},
    }
