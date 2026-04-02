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
Course Catalog Scraper — fetches CU Boulder course listings from
classes.colorado.edu and stores results in MongoDB.

Multi-strategy approach:
  1. FOSE JSON API with 202-polling support
  2. Playwright headless browser (executes API calls from a real session)

Scrapes ALL terms available in the classes.colorado.edu dropdown
(typically the current and adjacent semesters).
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

LOG = logging.getLogger(__name__)

FOSE_SEARCH_URL = "https://classes.colorado.edu/api/?page=fose&route=search"
FOSE_TERMS_URL = "https://classes.colorado.edu/api/?page=fose&route=search"
CLASSES_BASE_URL = "https://classes.colorado.edu"

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

DEFAULT_SUBJECTS = [
    "CSCI", "ENES", "MATH", "PHYS", "WRTG", "CHEM", "BIOL", "ECON",
    "PSYC", "ENGL", "HIST", "ENVD", "APPM", "ASEN", "MCEN", "ECEN",
    "CVEN", "CHEN", "IPHY", "COMM", "SOCY", "POLS", "PHIL", "ARTS",
    "MUSC", "ATLS", "INFO", "GEOG", "ANTH", "LING",
]

KNOWN_TERMS = [
    "Fall 2025",
    "Spring 2026",
    "Summer 2026",
]


def _term_to_srcdb(term: str) -> str:
    """Convert 'Spring 2026' -> '2261', 'Fall 2025' -> '2257', etc.

    CU Boulder's FOSE API uses a 4-digit code: the literal prefix '2',
    the last two digits of the year, and a season digit
    (1=Spring, 4=Summer, 7=Fall).
    """
    term_lower = term.lower()
    ym = re.search(r"20(\d{2})", term)
    yy = ym.group(1) if ym else "26"
    if "spring" in term_lower:
        return f"2{yy}1"
    if "summer" in term_lower:
        return f"2{yy}4"
    if "fall" in term_lower:
        return f"2{yy}7"
    return f"2{yy}1"


def _parse_schedule(meets: str) -> Dict[str, Any]:
    """Parse 'MWF 10:00am-10:50am' into structured data."""
    if not meets:
        return {"days": "", "start_time": "", "end_time": "", "raw": ""}

    day_match = re.match(r"([A-Za-z]+)", meets)
    days = day_match.group(1) if day_match else ""

    time_match = re.search(
        r"(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)", meets, re.I
    )
    start = time_match.group(1).strip() if time_match else ""
    end = time_match.group(2).strip() if time_match else ""

    return {"days": days, "start_time": start, "end_time": end, "raw": meets}


def _row_to_course(item: Dict[str, Any], term: str) -> Optional[Dict[str, Any]]:
    """Convert a FOSE API result row to our DB schema.

    Returns ``None`` for rows that should be skipped (recitations,
    cancelled sections, etc.).
    """
    schd = item.get("schd", "")
    if schd and schd not in ("LEC", "SEM", ""):
        return None
    if item.get("isCancelled"):
        return None

    meets = item.get("meets", "") or ""
    code = item.get("code", "").strip()
    if not code:
        code = (
            f"{item.get('subject', '')} "
            f"{item.get('catalog_nbr', item.get('catalogNbr', ''))}"
        ).strip()

    section = item.get("no", "") or item.get("section", "")
    instructor = item.get("instr", "") or item.get("instructor", "Staff")

    enrollment_total = 0
    try:
        enrollment_total = int(item.get("total", 0))
    except (ValueError, TypeError):
        pass

    return {
        "course_code": code,
        "title": item.get("title", ""),
        "section": section,
        "instructor": instructor,
        "schedule": _parse_schedule(meets),
        "location": item.get("bldg", item.get("location", "")),
        "seats_available": 0,
        "enrollment_total": enrollment_total,
        "enrollment_cap": 0,
        "semester": term,
        "scraped_at": datetime.utcnow(),
    }


# ── Strategy 1: FOSE JSON API ───────────────────────────────────────────────

async def _scrape_via_api(
    term: str,
    subjects: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    courses: List[Dict[str, Any]] = []
    srcdb = _term_to_srcdb(term)
    subjects = subjects or DEFAULT_SUBJECTS

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        try:
            await client.get(
                CLASSES_BASE_URL, headers={"User-Agent": BROWSER_UA}
            )
        except Exception as e:
            LOG.warning(f"CU classes landing page fetch failed: {e}")

        for subj in subjects:
            payload = {
                "other": {"srcdb": srcdb},
                "criteria": [{"field": "subject", "value": subj}],
            }
            headers = {
                "User-Agent": BROWSER_UA,
                "Content-Type": "application/json",
                "Referer": CLASSES_BASE_URL,
                "Origin": CLASSES_BASE_URL,
            }

            try:
                resp = await client.post(
                    FOSE_SEARCH_URL, json=payload, headers=headers
                )

                if resp.status_code == 202:
                    data = resp.json() if resp.content else {}
                    task_id = (
                        data.get("id")
                        or data.get("resultId")
                        or data.get("task_id")
                    )
                    if task_id:
                        result = await _poll_fose(client, task_id, headers)
                        if result:
                            for item in result:
                                row = _row_to_course(item, term)
                                if row:
                                    courses.append(row)
                            continue

                    await asyncio.sleep(3)
                    resp = await client.post(
                        FOSE_SEARCH_URL, json=payload, headers=headers
                    )

                if resp.status_code != 200:
                    LOG.warning(
                        f"CU API returned {resp.status_code} for {subj}"
                    )
                    continue

                body = resp.json()
                if "fatal" in body:
                    LOG.warning(f"CU API fatal for {subj}: {body['fatal']}")
                    continue

                results = body.get("results", body.get("data", []))
                added = 0
                for item in results:
                    row = _row_to_course(item, term)
                    if row:
                        courses.append(row)
                        added += 1

                LOG.debug(f"API: {added} lecture sections for {subj} (of {len(results)} total)")

            except Exception as e:
                LOG.warning(f"CU API error for {subj}: {e}")
                continue

    return courses


async def _poll_fose(
    client: httpx.AsyncClient,
    task_id: str,
    headers: Dict[str, str],
    max_attempts: int = 10,
) -> Optional[List]:
    """Poll the FOSE API for async results."""
    for attempt in range(max_attempts):
        await asyncio.sleep(2 * (attempt + 1))
        try:
            poll_url = f"{FOSE_SEARCH_URL}&resultId={task_id}"
            resp = await client.get(poll_url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("results", data.get("data", []))
        except Exception:
            pass
    return None


# ── Strategy 2: Playwright browser ──────────────────────────────────────────

_BROWSER_FETCH_JS = """
async ([srcdb, subject]) => {
    const resp = await fetch('/api/?page=fose&route=search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            other: {srcdb: srcdb},
            criteria: [{field: 'subject', value: subject}]
        })
    });

    if (resp.status === 202) {
        let data;
        try { data = await resp.json(); } catch(e) { return null; }
        const taskId = data.id || data.resultId || data.task_id;
        if (!taskId) return null;

        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const poll = await fetch(
                    '/api/?page=fose&route=search&resultId=' + taskId
                );
                if (poll.ok) return await poll.json();
            } catch(e) {}
        }
        return null;
    }

    if (!resp.ok) return null;
    return await resp.json();
}
"""


async def _scrape_via_playwright(
    term: str,
    subjects: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Launch a real browser, visit classes.colorado.edu (establishes cookies),
    then execute API calls from the browser context to bypass bot protection.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        LOG.warning("playwright not installed — browser scrape unavailable")
        return []

    courses: List[Dict[str, Any]] = []
    srcdb = _term_to_srcdb(term)
    subjects = subjects or DEFAULT_SUBJECTS

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        ctx = await browser.new_context(user_agent=BROWSER_UA)
        page = await ctx.new_page()

        try:
            LOG.info("Playwright: navigating to CU classes site")
            await page.goto(
                CLASSES_BASE_URL, timeout=60_000, wait_until="domcontentloaded"
            )
            await page.wait_for_timeout(5000)

            for subj in subjects:
                try:
                    result = await page.evaluate(
                        _BROWSER_FETCH_JS, [srcdb, subj]
                    )
                    if result:
                        items = result.get("results", result.get("data", []))
                        for item in items:
                            row = _row_to_course(item, term)
                            if row:
                                courses.append(row)
                        LOG.debug(
                            f"Playwright: {len(items)} courses for {subj}"
                        )
                    await page.wait_for_timeout(500)
                except Exception as e:
                    LOG.warning(f"Playwright fetch for {subj} failed: {e}")
                    continue

        except Exception as e:
            LOG.error(f"Playwright CU courses error: {e}")
        finally:
            await browser.close()

    return courses


# ── Public API ───────────────────────────────────────────────────────────────

async def scrape_courses(
    term: str = "Spring 2026",
    subjects: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Run scraping strategies in order; return the first that succeeds."""
    LOG.info(f"Starting CU course scrape for {term}")

    courses = await _scrape_via_api(term, subjects)
    if courses:
        LOG.info(f"API strategy succeeded: {len(courses)} courses for {term}")
        return courses

    LOG.info(f"API failed for {term} — trying Playwright")
    courses = await _scrape_via_playwright(term, subjects)
    if courses:
        LOG.info(f"Playwright strategy succeeded: {len(courses)} courses for {term}")
        return courses

    LOG.error(f"All CU course scraping strategies failed for {term}")
    return []


async def scrape_all_terms(
    terms: Optional[List[str]] = None,
    subjects: Optional[List[str]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Scrape courses for every term in *terms* (defaults to KNOWN_TERMS).

    Returns a dict mapping term name -> list of course dicts.
    """
    terms = terms or KNOWN_TERMS
    results: Dict[str, List[Dict[str, Any]]] = {}
    for term in terms:
        courses = await scrape_courses(term=term, subjects=subjects)
        results[term] = courses
        LOG.info(f"Scraped {len(courses)} courses for {term}")
    return results


async def store_courses(courses: List[Dict[str, Any]]) -> None:
    """Upsert course data into MongoDB."""
    from app.core.database import get_database

    db = get_database()
    coll = db.courses

    for c in courses:
        await coll.update_one(
            {
                "course_code": c["course_code"],
                "section": c["section"],
                "semester": c["semester"],
            },
            {"$set": c},
            upsert=True,
        )

    LOG.info(f"Stored/updated {len(courses)} course records")


async def get_available_terms() -> List[str]:
    """Return the list of terms we scrape (for use by the query engine)."""
    return list(KNOWN_TERMS)


async def run_course_scrape(term: str = "Spring 2026") -> int:
    """Scrape + store for a single term."""
    courses = await scrape_courses(term=term)
    if courses:
        await store_courses(courses)
    return len(courses)


async def run_all_terms_scrape(
    terms: Optional[List[str]] = None,
) -> int:
    """Scrape + store for all available terms. Returns total course count."""
    all_courses = await scrape_all_terms(terms=terms)
    total = 0
    for term, courses in all_courses.items():
        if courses:
            await store_courses(courses)
            total += len(courses)
    LOG.info(f"All-terms scrape complete: {total} total courses across {len(all_courses)} terms")
    return total
