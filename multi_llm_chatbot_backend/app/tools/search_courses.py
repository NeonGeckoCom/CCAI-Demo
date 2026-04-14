"""
search_courses tool — live query against CU Boulder's FOSE class-search API.

Exposes TOOL_DEFINITION (Gemini function-declaration schema) and an
execute() coroutine that the tool-calling loop dispatches to.
"""

import logging
import re
from typing import Any, Dict, List, Optional
import httpx
from app.tools import BROWSER_UA

logger = logging.getLogger(__name__)

FOSE_SEARCH_URL = "https://classes.colorado.edu/api/?page=fose&route=search"
CLASSES_BASE_URL = "https://classes.colorado.edu"

TOOL_DEFINITION: Dict[str, Any] = {
    "name": "search_courses",
    "description": (
        "Search the CU Boulder course catalog for classes in a given "
        "subject, optionally filtered by course number and semester. "
        "Returns a list of matching sections with title, instructor, "
        "schedule, and location."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": (
                    "Department / subject code, e.g. 'CSCI', 'MATH', 'PHYS'."
                ),
            },
            "course_number": {
                "type": "string",
                "description": (
                    "Catalog number to filter on, e.g. '1300'. "
                    "Omit to return all courses in the subject."
                ),
            },
            "semester": {
                "type": "string",
                "description": (
                    "Semester name, e.g. 'Spring 2026', 'Fall 2025'. "
                    "Defaults to 'Spring 2026' if not provided."
                ),
            },
            "limit": {
                "type": "integer",
                "description": (
                    "Maximum number of course sections to return. "
                    "Defaults to 20. Use a smaller value for broad queries."
                ),
            },
        },
        "required": ["subject"],
    },
}

def _term_to_srcdb(term: str) -> str:
    """Convert 'Spring 2026' to '2261', 'Fall 2025' to '2257', etc.

    CU Boulder's FOSE API uses a 4-digit code: literal '2', the last
    two digits of the year, and a season digit (1=Spring, 4=Summer, 7=Fall).
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


def _parse_schedule(meets: str) -> Dict[str, str]:
    """Parse 'MWF 10:00am-10:50am' into structured fields."""
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
    """Convert a FOSE result row to a lightweight course dict.
    Returns None for rows that should be skipped (recitations, cancelled sections, etc.).
    """
    schd = item.get("schd", "")
    if schd and schd not in ("LEC", "SEM", ""):
        return None
    if item.get("isCancelled"):
        return None

    code = item.get("code", "").strip()
    if not code:
        code = (
            f"{item.get('subject', '')} "
            f"{item.get('catalog_nbr', item.get('catalogNbr', ''))}"
        ).strip()

    return {
        "course_code": code,
        "title": item.get("title", ""),
        "section": item.get("no", "") or item.get("section", ""),
        "instructor": item.get("instr", "") or item.get("instructor", "Staff"),
        "schedule": _parse_schedule(item.get("meets", "") or ""),
        "location": item.get("bldg", item.get("location", "")),
        "semester": term,
    }


MAX_RESULTS = 20

async def execute(
    *,
    name: str = "",
    subject: str,
    course_number: str = "",
    semester: str = "Spring 2026",
    limit: int = MAX_RESULTS,
) -> Dict[str, Any]:
    """Query the CU Boulder FOSE API and return matching courses.

    The 'name' kwarg is passed by the dispatch loop and ignored here.
    Returns {"courses": [...], "query": {...}}.
    """
    srcdb = _term_to_srcdb(semester)
    subject = subject.upper().strip()

    payload = {
        "other": {"srcdb": srcdb},
        "criteria": [{"field": "subject", "value": subject}],
    }
    headers = {
        "User-Agent": BROWSER_UA,
        "Content-Type": "application/json",
        "Referer": CLASSES_BASE_URL,
        "Origin": CLASSES_BASE_URL,
    }

    courses: List[Dict[str, Any]] = []

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.post(
                FOSE_SEARCH_URL, json=payload, headers=headers,
            )
            if resp.status_code != 200:
                logger.warning("FOSE API returned %s for %s", resp.status_code, subject)
                return {"courses": [], "query": {"subject": subject, "semester": semester}}

            body = resp.json()
            results = body.get("results", body.get("data", []))

            for item in results:
                row = _row_to_course(item, semester)
                if row:
                    courses.append(row)

    except Exception as exc:
        logger.error("FOSE API error for %s: %s", subject, exc)
        return {"courses": [], "error": str(exc), "query": {"subject": subject, "semester": semester}}

    if course_number:
        cn = course_number.strip()
        courses = [c for c in courses if cn in c["course_code"]]

    total = len(courses)
    truncated = total > limit
    courses = courses[:limit]

    return {
        "courses": courses,
        "total_results": total,
        "truncated": truncated,
        "query": {
            "subject": subject,
            "course_number": course_number or None,
            "semester": semester,
        },
    }
