"""Workspace state + AI assists for the PhD Navigator home tools.

Per-user persistence for the dashboard tools (deadlines, notes, reading queue,
funding, faculty) plus Gemini-powered helpers:
  - reading suggestions (find the right papers/links for a topic)
  - funding source suggestions (fellowships/grants that fit the student)

State is one Mongo document per user in `user_workspace`:
  { user_id, sections: { deadlines: [...], notes: [...], ... }, updated_at }
The frontend keeps localStorage as an offline cache and syncs through here.
"""
import html as html_lib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_active_user
from app.core.bootstrap import chat_orchestrator
from app.core.database import get_database
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

# Sections the client may sync. Keep this a closed set so arbitrary keys can't
# grow the document unbounded.
WORKSPACE_SECTIONS = {
    "deadlines", "notes", "reading", "funding", "faculty",
    "tasks", "bibliography", "pomodoro", "meetings", "reminders",
    # Plan backup: "roadmap" holds the roadmap object, "progress" the list of
    # completed task keys — synced so sign-in on a new device restores the plan.
    "roadmap", "progress",
}
MAX_SECTION_BYTES = 2_000_000  # ~2MB per section (audio notes are data URLs)


class SectionUpdate(BaseModel):
    items: Any = Field(default_factory=list)


class CiteUrlRequest(BaseModel):
    url: str


class ReadingSuggestRequest(BaseModel):
    topic: str = ""
    program: str = ""
    milestone: str = ""
    already_have: List[str] = Field(default_factory=list)
    count: int = 6


class FundingSuggestRequest(BaseModel):
    program: str = ""
    institution: str = ""
    topic: str = ""
    stage: str = ""
    citizenship_note: str = ""
    count: int = 6


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _llm_client():
    client = getattr(chat_orchestrator, "llm_client", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No AI provider is configured on this server.",
        )
    return client


def _parse_llm_json(raw: str) -> Any:
    """Parse LLM output as JSON, tolerating code fences and stray prose."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The AI service returned an unreadable response. Please try again.",
    )


# ---------------------------------------------------------------------------
# Workspace state sync
# ---------------------------------------------------------------------------
@router.get("/workspace/state")
async def get_workspace_state(current_user: User = Depends(get_current_active_user)):
    db = get_database()
    doc = await db.user_workspace.find_one({"user_id": str(current_user.id)})
    sections = (doc or {}).get("sections", {})
    return {
        "sections": {k: sections.get(k, []) for k in WORKSPACE_SECTIONS},
        "updated_at": (doc or {}).get("updated_at"),
    }


@router.put("/workspace/state/{section}")
async def put_workspace_section(
    section: str,
    body: SectionUpdate,
    current_user: User = Depends(get_current_active_user),
):
    if section not in WORKSPACE_SECTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown workspace section: {section}")
    try:
        payload_size = len(json.dumps(body.items, default=str))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Section payload is not JSON-serializable.")
    if payload_size > MAX_SECTION_BYTES:
        raise HTTPException(
            status_code=413,
            detail="This section is too large to sync. Trim old items or long recordings.",
        )
    db = get_database()
    await db.user_workspace.update_one(
        {"user_id": str(current_user.id)},
        {
            "$set": {f"sections.{section}": body.items, "updated_at": _now()},
            "$setOnInsert": {"user_id": str(current_user.id)},
        },
        upsert=True,
    )

    # Meeting notes feed the knowledge markdown so chat advisors know what was
    # discussed and what the student committed to (best-effort).
    if section == "meetings":
        try:
            from app.core.library import upsert_knowledge_section

            meetings = [m for m in body.items if isinstance(m, dict)][-5:][::-1]
            lines = []
            for m in meetings:
                note = " ".join(str(m.get("notes") or "").split())[:240]
                open_actions = [
                    str(a.get("text") or a.get("t") or "")[:90]
                    for a in (m.get("actions") or [])
                    if isinstance(a, dict) and not a.get("done")
                ]
                line = f"- Meeting with {m.get('withName') or 'advisor'} ({m.get('date') or 'undated'})"
                if note:
                    line += f": {note}"
                if open_actions:
                    line += " | open action items: " + "; ".join(a for a in open_actions[:4] if a)
                lines.append(line)
            if lines:
                await upsert_knowledge_section(
                    str(current_user.id), "Recent meeting notes", "\n".join(lines)
                )
        except Exception as exc:
            logger.warning("Meeting knowledge update failed: %s", exc)

    return {"ok": True, "section": section}


# ---------------------------------------------------------------------------
# Faculty (also reachable through /workspace/state/faculty; these endpoints
# exist so Settings can read/write without pulling the whole workspace doc)
# ---------------------------------------------------------------------------
@router.get("/workspace/faculty")
async def get_faculty(current_user: User = Depends(get_current_active_user)):
    db = get_database()
    doc = await db.user_workspace.find_one(
        {"user_id": str(current_user.id)}, {"sections.faculty": 1}
    )
    return {"items": ((doc or {}).get("sections") or {}).get("faculty", [])}


@router.put("/workspace/faculty")
async def put_faculty(
    body: SectionUpdate,
    current_user: User = Depends(get_current_active_user),
):
    return await put_workspace_section("faculty", body, current_user)


# ---------------------------------------------------------------------------
# Citation: resolve a web page's metadata (the browser can't cross-origin fetch)
# ---------------------------------------------------------------------------
_PRIVATE_HOST_RE = re.compile(
    r"^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|169\.254\.|\[?::1)", re.I
)


@router.post("/workspace/citation/url")
async def cite_url(
    body: CiteUrlRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Fetch a page and extract citation metadata (Highwire/OpenGraph meta tags)."""
    url = (body.url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname \
            or _PRIVATE_HOST_RE.match(parsed.hostname):
        raise HTTPException(status_code=400, detail="Provide a public http(s) URL.")
    try:
        async with httpx.AsyncClient(
            timeout=12, follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; PhD-Navigator citation fetcher)"},
        ) as client:
            res = await client.get(url)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Couldn't fetch that page.")
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"The page returned HTTP {res.status_code}.")
    text = res.text[:400_000]

    def metas(*names: str) -> List[str]:
        vals: List[str] = []
        for name in names:
            for m in re.finditer(
                rf'<meta[^>]+(?:name|property)=["\']{re.escape(name)}["\'][^>]*>', text, re.I
            ):
                c = re.search(r'content=["\']([^"\']+)["\']', m.group(0), re.I)
                if c:
                    vals.append(html_lib.unescape(c.group(1)).strip())
        return vals

    title = (metas("citation_title") or metas("og:title") or [""])[0]
    if not title:
        tm = re.search(r"<title[^>]*>([\s\S]*?)</title>", text, re.I)
        title = html_lib.unescape(tm.group(1)).strip() if tm else (parsed.hostname or "")
    return {
        "title": re.sub(r"\s+", " ", title)[:300],
        "authors": metas("citation_author")[:6] or metas("author")[:6],
        "site": (metas("og:site_name") or [(parsed.hostname or "").replace("www.", "")])[0][:120],
        "container": (metas("citation_journal_title") or [""])[0][:200],
        "published": (metas("citation_publication_date") or metas("article:published_time")
                      or metas("citation_date") or [""])[0][:40],
        "doi": (metas("citation_doi") or [""])[0][:100],
        "url": str(res.url),
    }


# ---------------------------------------------------------------------------
# AI: reading suggestions
# ---------------------------------------------------------------------------
READING_SYSTEM_PROMPT = """You are a research librarian helping a PhD student build a reading list.
Given the student's program, current milestone, and topic, suggest the most useful,
real, well-known papers, books, or resources. Prefer canonical/highly-cited works and
recent influential surveys. For links, only use URLs you are confident exist:
- DOI links (https://doi.org/...)
- arXiv abstract pages (https://arxiv.org/abs/...)
- Google Scholar search links (https://scholar.google.com/scholar?q=...) when unsure.
Never invent a DOI or arXiv id — when not certain, use the Scholar search link form.
Return ONLY valid JSON: an array of objects with keys:
  title (string), authors (string), year (string), venue (string),
  url (string), why (one sentence on why it fits this student), kind ("paper"|"book"|"survey"|"resource").
"""


@router.post("/workspace/reading/suggest")
async def suggest_reading(
    body: ReadingSuggestRequest,
    current_user: User = Depends(get_current_active_user),
):
    client = _llm_client()
    count = max(1, min(body.count, 10))
    have = "\n".join(f"- {t}" for t in body.already_have[:30]) or "(none)"
    user_prompt = (
        f"Program: {body.program or 'PhD program'}\n"
        f"Current milestone: {body.milestone or 'unspecified'}\n"
        f"Topic / what they need to read about: {body.topic or body.milestone or body.program}\n"
        f"Already in their queue (do not repeat):\n{have}\n\n"
        f"Suggest {count} items. Return ONLY the JSON array."
    )
    raw = await client.generate(
        system_prompt=READING_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.4,
        max_tokens=2048,
        response_mime_type="application/json",
    )
    items = _parse_llm_json(raw)
    if isinstance(items, dict):
        items = items.get("items") or items.get("suggestions") or []
    if not isinstance(items, list):
        items = []
    cleaned = []
    for it in items[:count]:
        if not isinstance(it, dict) or not (it.get("title") or "").strip():
            continue
        cleaned.append({
            "title": str(it.get("title", "")).strip(),
            "authors": str(it.get("authors", "")).strip(),
            "year": str(it.get("year", "")).strip(),
            "venue": str(it.get("venue", "")).strip(),
            "url": str(it.get("url", "")).strip(),
            "why": str(it.get("why", "")).strip(),
            "kind": str(it.get("kind", "paper")).strip() or "paper",
        })
    return {"items": cleaned}


# ---------------------------------------------------------------------------
# AI: defense practice answer feedback
# ---------------------------------------------------------------------------
class AnswerFeedbackRequest(BaseModel):
    format: str = "defense"
    difficulty: str = "standard"
    areas_of_focus: str = Field(default="", max_length=1200)
    items: List[Dict[str, Any]] = Field(default_factory=list)  # [{question, answer, tag}]


ANSWER_FB_SYSTEM_PROMPT = """You are a dissertation-committee coach reviewing a student's
practice answers. For EACH question/answer pair, assess the answer as a committee member
would: did it actually answer the question, show command of the work, and stay honest
about limitations? Return ONLY valid JSON:
{"items": [{"verdict": "strong" | "okay" | "needs_work",
            "note": "ONE specific sentence: what made it work, or the single best improvement"}]}
Same order and length as the input. A skipped/empty answer is always "needs_work" with a
note about how to approach it."""


@router.post("/workspace/defense/answer-feedback")
async def defense_answer_feedback(
    body: AnswerFeedbackRequest,
    current_user: User = Depends(get_current_active_user),
):
    items = [i for i in body.items if isinstance(i, dict) and (i.get("question") or "").strip()][:12]
    if not items:
        raise HTTPException(status_code=400, detail="No answers to review.")
    client = _llm_client()
    qa = "\n\n".join(
        f"{n + 1}. [{i.get('tag', 'Question')}] Q: {i['question']}\n"
        f"A: {(i.get('answer') or '').strip() or '(skipped)'}"
        for n, i in enumerate(items)
    )
    raw = await client.generate(
        system_prompt=ANSWER_FB_SYSTEM_PROMPT,
        context=[{"role": "user", "content": (
            f"Practice format: {body.format}\n"
            f"Difficulty: {body.difficulty}\n"
            f"Student's requested areas of focus: {body.areas_of_focus or '(none)'}\n\n"
            f"{qa}\n\nReturn ONLY the JSON object."
        )}],
        temperature=0.2,
        max_tokens=1536,
        response_mime_type="application/json",
    )
    parsed = _parse_llm_json(raw)
    out = []
    src = parsed.get("items") if isinstance(parsed, dict) else parsed
    for i, fb in enumerate((src or [])[:len(items)]):
        if not isinstance(fb, dict):
            continue
        verdict = str(fb.get("verdict", "okay")).strip()
        out.append({
            "verdict": verdict if verdict in ("strong", "okay", "needs_work") else "okay",
            "note": str(fb.get("note", "")).strip()[:300],
        })
    return {"items": out}


# ---------------------------------------------------------------------------
# AI: meeting agenda drafting + action-item extraction
# ---------------------------------------------------------------------------
class MeetingSuggestRequest(BaseModel):
    with_name: str = ""
    with_role: str = ""
    program: str = ""
    milestone: str = ""
    milestone_tasks: List[str] = Field(default_factory=list)
    prior_notes: str = ""
    focus: str = ""


class MeetingActionsRequest(BaseModel):
    notes: str = ""
    agenda: List[str] = Field(default_factory=list)


MEETING_SYSTEM_PROMPT = """You help a PhD student prepare a meeting agenda. Given who they
are meeting (and that person's role), where the student is in their PhD (current milestone
and its open tasks), any prior meeting notes, and an optional focus, draft a tight,
realistic agenda: 4-7 items, each a short actionable line the student can say out loud
(updates to give, questions to ask, decisions to request, blockers to raise).
Return ONLY valid JSON: {"title": "short meeting title", "items": ["...", "..."]}"""


@router.post("/workspace/meeting/suggest")
async def suggest_meeting_agenda(
    body: MeetingSuggestRequest,
    current_user: User = Depends(get_current_active_user),
):
    client = _llm_client()
    tasks = "\n".join(f"- {t}" for t in body.milestone_tasks[:12]) or "(unknown)"
    user_prompt = (
        f"Meeting with: {body.with_name or 'their advisor'} ({body.with_role or 'Advisor'})\n"
        f"Program: {body.program or 'PhD program'}\n"
        f"Current milestone: {body.milestone or 'unspecified'}\n"
        f"Open tasks on this milestone:\n{tasks}\n"
        f"Most recent meeting notes with this person:\n{(body.prior_notes or '(none)')[:4000]}\n"
        f"Student's stated focus for this meeting: {body.focus or '(none given)'}\n\n"
        "Draft the agenda. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=MEETING_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.4,
        max_tokens=1024,
        response_mime_type="application/json",
    )
    parsed = _parse_llm_json(raw)
    if not isinstance(parsed, dict):
        parsed = {}
    items = [str(x).strip() for x in (parsed.get("items") or []) if str(x).strip()][:8]
    return {"title": str(parsed.get("title", "")).strip()[:120], "items": items}


ACTIONS_SYSTEM_PROMPT = """You extract concrete action items from a PhD student's meeting
notes (and the agenda that was discussed). An action item is something the STUDENT must do:
specific, starts with a verb, small enough to check off. Ignore things other people will do
unless the student must follow up. Return ONLY valid JSON: {"items": ["...", "..."]} with
3-8 items, or {"items": []} if the notes contain none."""


@router.post("/workspace/meeting/actions")
async def extract_meeting_actions(
    body: MeetingActionsRequest,
    current_user: User = Depends(get_current_active_user),
):
    client = _llm_client()
    agenda = "\n".join(f"- {a}" for a in body.agenda[:12]) or "(none)"
    user_prompt = (
        f"Agenda discussed:\n{agenda}\n\n"
        f"Meeting notes:\n{(body.notes or '')[:6000]}\n\n"
        "Extract the student's action items. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=ACTIONS_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=768,
        response_mime_type="application/json",
    )
    parsed = _parse_llm_json(raw)
    items = []
    if isinstance(parsed, dict):
        items = [str(x).strip() for x in (parsed.get("items") or []) if str(x).strip()][:10]
    elif isinstance(parsed, list):
        items = [str(x).strip() for x in parsed if str(x).strip()][:10]
    return {"items": items}


# ---------------------------------------------------------------------------
# AI: meeting recording → transcript + notes + action items (Gemini multimodal)
# ---------------------------------------------------------------------------
MAX_MEETING_MEDIA_BYTES = 60 * 1024 * 1024  # ~60MB ≈ well over an hour of opus audio

RECORDING_SYSTEM_PROMPT = """You are given an audio recording of a PhD student's meeting
(usually with an advisor, committee member, or collaborator), plus the agenda they walked
in with. Listen to the whole recording and produce:
1. transcript — a clean, readable transcript. Label speakers "Student" and the other
   party's name/role when distinguishable, otherwise "Speaker 1"/"Speaker 2". Skip filler.
2. notes — well-organized meeting notes in short paragraphs/bullets: decisions made,
   feedback given, deadlines mentioned, open questions.
3. summary — 2-3 sentences capturing the meeting's outcome.
4. action_items — concrete things the STUDENT must do, each starting with a verb.
Return ONLY valid JSON:
{"transcript": "...", "notes": "...", "summary": "...", "action_items": ["...", "..."]}"""


@router.post("/workspace/meeting/analyze-recording")
async def analyze_meeting_recording(
    media: UploadFile = File(...),
    agenda_json: str = Form("[]"),
    with_name: str = Form(""),
    title: str = Form(""),
    current_user: User = Depends(get_current_active_user),
):
    client = _llm_client()
    multimodal = getattr(client, "generate_multimodal", None)
    if multimodal is None:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="The current AI provider can't process audio. Switch to Gemini for meeting recordings.",
        )
    media_bytes = await media.read()
    if not media_bytes:
        raise HTTPException(status_code=400, detail="The recording was empty.")
    if len(media_bytes) > MAX_MEETING_MEDIA_BYTES:
        raise HTTPException(
            status_code=413,
            detail="That recording is too large (over 60MB). Try a shorter meeting segment.",
        )
    try:
        agenda = json.loads(agenda_json or "[]")
    except json.JSONDecodeError:
        agenda = []
    agenda_lines = "\n".join(f"- {str(a)}" for a in agenda[:12]) or "(no agenda provided)"
    text_prompt = (
        f"Meeting: {title or 'PhD meeting'}\n"
        f"The student is meeting with: {with_name or 'their advisor'}\n"
        f"Agenda they brought:\n{agenda_lines}\n\n"
        "Analyze the attached audio recording. Return ONLY the JSON object."
    )
    raw = await multimodal(
        system_prompt=RECORDING_SYSTEM_PROMPT,
        text_prompt=text_prompt,
        media_bytes=media_bytes,
        media_mime_type=media.content_type or "audio/webm",
        temperature=0.2,
        max_tokens=8192,
        response_mime_type="application/json",
    )
    parsed = _parse_llm_json(raw)
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="The AI service returned an unreadable analysis.")
    return {
        "transcript": str(parsed.get("transcript", ""))[:120_000],
        "notes": str(parsed.get("notes", ""))[:20_000],
        "summary": str(parsed.get("summary", ""))[:2_000],
        "action_items": [str(x).strip() for x in (parsed.get("action_items") or []) if str(x).strip()][:12],
    }


# ---------------------------------------------------------------------------
# AI: funding suggestions
# ---------------------------------------------------------------------------
FUNDING_SYSTEM_PROMPT = """You help PhD students find real funding: fellowships, grants,
travel awards, and dissertation-completion funds. Suggest only real, well-known programs
(e.g. NSF GRFP, Ford Foundation, Fulbright, NIH F31, university-internal awards described
generically). For url, use the sponsor's main program page if you are confident, otherwise
a Google search link (https://www.google.com/search?q=...). Be honest about typical amounts
and cycles; if unsure of the next deadline, describe the usual cycle (e.g. "typically October").
Return ONLY valid JSON: an array of objects with keys:
  name, sponsor, amount (string, e.g. "$34,000/yr stipend"), cycle (string),
  url, fit (one sentence on why it fits this student), effort ("low"|"medium"|"high").
"""


@router.post("/workspace/funding/suggest")
async def suggest_funding(
    body: FundingSuggestRequest,
    current_user: User = Depends(get_current_active_user),
):
    client = _llm_client()
    count = max(1, min(body.count, 10))
    user_prompt = (
        f"Program: {body.program or 'PhD program'}\n"
        f"Institution: {body.institution or 'a US university'}\n"
        f"Research topic: {body.topic or 'their dissertation research'}\n"
        f"Stage: {body.stage or 'unspecified'}\n"
        f"Notes: {body.citizenship_note or '(none)'}\n\n"
        f"Suggest {count} funding sources, most promising first. Return ONLY the JSON array."
    )
    raw = await client.generate(
        system_prompt=FUNDING_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.4,
        max_tokens=2048,
        response_mime_type="application/json",
    )
    items = _parse_llm_json(raw)
    if isinstance(items, dict):
        items = items.get("items") or items.get("suggestions") or []
    if not isinstance(items, list):
        items = []
    cleaned = []
    for it in items[:count]:
        if not isinstance(it, dict) or not (it.get("name") or "").strip():
            continue
        cleaned.append({
            "name": str(it.get("name", "")).strip(),
            "sponsor": str(it.get("sponsor", "")).strip(),
            "amount": str(it.get("amount", "")).strip(),
            "cycle": str(it.get("cycle", "")).strip(),
            "url": str(it.get("url", "")).strip(),
            "fit": str(it.get("fit", "")).strip(),
            "effort": str(it.get("effort", "medium")).strip() or "medium",
        })
    return {"items": cleaned}
