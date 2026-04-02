# NEON AI (TM) SOFTWARE, Software Development Kit & Application Framework
# All Rights Reserved 2008-2025
# Licensed under the BSD 3-Clause License
# https://opensource.org/licenses/BSD-3-Clause
#
# Copyright (c) 2008-2025, Neongecko.com Inc.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright notice,
#    this list of conditions and the following disclaimer in the documentation
#    and/or other materials provided with the distribution.
# 3. Neither the name of the copyright holder nor the names of its contributors
#    may be used to endorse or promote products derived from this software
#    without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.

"""
Professor Ratings Scraper — fetches CU Boulder professor ratings from
RateMyProfessors and stores results in MongoDB.

Multi-strategy approach:
  1. GraphQL API with proper auth token & pagination
  2. Playwright headless browser (intercepts GraphQL responses)
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

import httpx

LOG = logging.getLogger(__name__)

RMP_SEARCH_URL = "https://www.ratemyprofessors.com/search/professors/1087?q=*"
RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"

# base64("School-1087") — the CU Boulder school ID used by RMP's GraphQL API
CU_BOULDER_SCHOOL_ID = "U2Nob29sLTEwODc="

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

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


def _node_to_professor(node: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a GraphQL teacher node to our DB schema."""
    return {
        "name": f"{node.get('firstName', '')} {node.get('lastName', '')}".strip(),
        "department": node.get("department", ""),
        "rating": node.get("avgRating", 0),
        "difficulty": node.get("avgDifficulty", 0),
        "would_take_again_pct": node.get("wouldTakeAgainPercent", -1),
        "num_ratings": node.get("numRatings", 0),
        "rmp_id": node.get("id", ""),
        "scraped_at": datetime.utcnow(),
    }


async def _extract_auth_token(client: httpx.AsyncClient) -> str:
    """
    Fetch the RMP landing page and try to pull the auth token from the
    JavaScript bundle.  Falls back to the well-known Basic test:test token.
    """
    try:
        resp = await client.get(
            "https://www.ratemyprofessors.com/",
            headers={"User-Agent": BROWSER_UA},
        )
        html = resp.text

        m = re.search(
            r'"Authorization"\s*:\s*"(Basic\s+[A-Za-z0-9+/=]+)"', html
        )
        if m:
            LOG.info("Extracted auth token from page JS")
            return m.group(1)

    except Exception as e:
        LOG.debug(f"Auth token extraction failed: {e}")

    return "Basic dGVzdDp0ZXN0"


# ── Strategy 1: GraphQL API ─────────────────────────────────────────────────

async def _scrape_via_graphql() -> List[Dict[str, Any]]:
    professors: List[Dict[str, Any]] = []
    page = 0
    cursor = ""

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        auth_token = await _extract_auth_token(client)
        headers = {
            "User-Agent": BROWSER_UA,
            "Authorization": auth_token,
            "Content-Type": "application/json",
            "Referer": RMP_SEARCH_URL,
            "Origin": "https://www.ratemyprofessors.com",
        }

        while page < 150:
            variables = {
                "count": 20,
                "cursor": cursor or "",
                "query": {
                    "text": "",
                    "schoolID": CU_BOULDER_SCHOOL_ID,
                    "fallback": True,
                    "departmentID": None,
                },
            }

            try:
                if page > 0:
                    await asyncio.sleep(0.4)

                resp = await client.post(
                    RMP_GRAPHQL_URL,
                    json={"query": TEACHER_SEARCH_QUERY, "variables": variables},
                    headers=headers,
                )

                if resp.status_code == 403:
                    LOG.warning(f"RMP GraphQL 403 on page {page} — auth may be invalid")
                    break

                resp.raise_for_status()
                data = resp.json()
                teachers = (
                    data.get("data", {})
                    .get("search", {})
                    .get("teachers", {})
                )
                edges = teachers.get("edges", [])
                page_info = teachers.get("pageInfo", {})

                if not edges:
                    break

                for edge in edges:
                    node = edge.get("node", {})
                    if node:
                        professors.append(_node_to_professor(node))

                if not page_info.get("hasNextPage"):
                    break
                cursor = page_info.get("endCursor", "")
                page += 1

            except Exception as e:
                LOG.error(f"RMP GraphQL error (page {page}): {e}")
                break

    return professors


# ── Strategy 2: Playwright browser ──────────────────────────────────────────

async def _scrape_via_playwright() -> List[Dict[str, Any]]:
    """
    Launch a real browser, navigate to the RMP search page, and intercept the
    GraphQL network responses to capture structured professor data.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        LOG.warning("playwright not installed — browser scrape unavailable")
        return []

    professors: List[Dict[str, Any]] = []
    captured: List[Dict[str, Any]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        ctx = await browser.new_context(user_agent=BROWSER_UA)
        page = await ctx.new_page()

        async def _on_response(resp) -> None:
            if "/graphql" in resp.url:
                try:
                    body = await resp.json()
                    captured.append(body)
                except Exception:
                    pass

        page.on("response", _on_response)

        async def _block_ads(route) -> None:
            await route.abort()

        await page.route(
            re.compile(
                r"(doubleclick|googlesyndication|googletagmanager|facebook"
                r"|analytics|adsystem|adservice|amazon-adsystem|moatads|quantserve)"
            ),
            _block_ads,
        )

        try:
            LOG.info("Playwright: navigating to RMP search page")
            await page.goto(
                RMP_SEARCH_URL, timeout=60_000, wait_until="domcontentloaded"
            )
            await page.wait_for_timeout(5000)

            for sel in [
                'button:has-text("Close")',
                'button:has-text("Accept")',
                'button:has-text("Got it")',
                'button:has-text("I Accept")',
                '[aria-label="Close"]',
                '[class*="FullPageModal"] button',
                '[class*="CCPAModal"] button',
            ]:
                try:
                    loc = page.locator(sel).first
                    if await loc.is_visible(timeout=1500):
                        await loc.click()
                        await page.wait_for_timeout(500)
                except Exception:
                    pass

            stale_rounds = 0
            prev_len = len(captured)
            for _ in range(200):
                try:
                    btn = page.locator('button:has-text("Show More")').first
                    if await btn.is_visible(timeout=3000):
                        await btn.click()
                        await page.wait_for_timeout(2000)

                        if len(captured) == prev_len:
                            stale_rounds += 1
                        else:
                            stale_rounds = 0
                            prev_len = len(captured)

                        if stale_rounds >= 5:
                            break
                    else:
                        break
                except Exception:
                    break

        except Exception as e:
            LOG.error(f"Playwright navigation error: {e}")
        finally:
            await browser.close()

    for payload in captured:
        teachers = (
            payload.get("data", {}).get("search", {}).get("teachers", {})
        )
        for edge in teachers.get("edges", []):
            node = edge.get("node", {})
            if node:
                professors.append(_node_to_professor(node))

    return professors


# ── Helpers ──────────────────────────────────────────────────────────────────

def _deduplicate(profs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Set = set()
    unique: List[Dict[str, Any]] = []
    for p in profs:
        key = (p["name"], p["department"])
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


# ── Public API ───────────────────────────────────────────────────────────────

async def scrape_professors() -> List[Dict[str, Any]]:
    """Run scraping strategies in order; return the first that succeeds."""
    LOG.info("Starting RMP professor scrape for CU Boulder")

    profs = await _scrape_via_graphql()
    if profs:
        profs = _deduplicate(profs)
        LOG.info(f"GraphQL strategy succeeded: {len(profs)} professors")
        return profs

    LOG.info("GraphQL failed — trying Playwright")
    profs = await _scrape_via_playwright()
    if profs:
        profs = _deduplicate(profs)
        LOG.info(f"Playwright strategy succeeded: {len(profs)} professors")
        return profs

    LOG.error("All RMP scraping strategies failed")
    return []


async def store_professors(professors: List[Dict[str, Any]]) -> None:
    """Upsert professor ratings into MongoDB."""
    from app.core.database import get_database

    db = get_database()
    coll = db.professor_ratings

    for p in professors:
        await coll.update_one(
            {"name": p["name"], "department": p["department"]},
            {"$set": p},
            upsert=True,
        )

    LOG.info(f"Stored/updated {len(professors)} professor records")


async def run_professor_scrape() -> int:
    """Full pipeline: scrape + store."""
    profs = await scrape_professors()
    if profs:
        await store_professors(profs)
    return len(profs)
