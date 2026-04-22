#!/usr/bin/env python3
"""Look up a RateMyProfessors school ID by name.

Usage:
    python3 scripts/rmp_school_lookup.py "University of Colorado"

Prints matching schools with their GraphQL IDs (the value to put in
your config.yaml under tools.rate_my_professor.school_id).
"""

import asyncio
import re
import sys

import httpx

RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
RMP_LANDING_URL = "https://www.ratemyprofessors.com/"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

SCHOOL_SEARCH_QUERY = """
query SchoolSearchQuery($query: SchoolSearchQuery!) {
  newSearch {
    schools(query: $query) {
      edges {
        node {
          id
          name
          city
          state
        }
      }
    }
  }
}
"""


async def _extract_auth_token(client: httpx.AsyncClient) -> str:
    try:
        resp = await client.get(RMP_LANDING_URL, headers={"User-Agent": BROWSER_UA})
        m = re.search(r'"Authorization"\s*:\s*"(Basic\s+[A-Za-z0-9+/=]+)"', resp.text)
        if m:
            return m.group(1)
    except Exception:
        pass
    return "Basic dGVzdDp0ZXN0"


async def search_schools(school_name: str) -> list:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        auth_token = await _extract_auth_token(client)
        resp = await client.post(
            RMP_GRAPHQL_URL,
            json={
                "query": SCHOOL_SEARCH_QUERY,
                "variables": {"query": {"text": school_name}},
            },
            headers={
                "User-Agent": BROWSER_UA,
                "Authorization": auth_token,
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        edges = (
            data.get("data", {})
            .get("newSearch", {})
            .get("schools", {})
            .get("edges", [])
        )
        return [
            {
                "school_id": edge["node"]["id"],
                "name": edge["node"]["name"],
                "city": edge["node"].get("city", ""),
                "state": edge["node"].get("state", ""),
            }
            for edge in edges
            if edge.get("node")
        ]


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/rmp_school_lookup.py <school name>")
        print('Example: python3 scripts/rmp_school_lookup.py "University of Colorado"')
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    results = asyncio.run(search_schools(query))

    if not results:
        print(f"No schools found matching '{query}'")
        sys.exit(0)

    print(f"Found {len(results)} school(s) matching '{query}':\n")
    for school in results:
        location = ", ".join(filter(None, [school["city"], school["state"]]))
        print(f"  {school['name']}")
        print(f"    Location:  {location}")
        print(f"    school_id: {school['school_id']}")
        print()


if __name__ == "__main__":
    main()
