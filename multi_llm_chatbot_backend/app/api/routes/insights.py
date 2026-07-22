"""Insights brain — the analytical layer over everything the app knows.

Synthesizes the knowledge markdown (chat memory, documents, meetings, defense
practice, wellbeing) plus wellness check-ins and the plan context the frontend
sends into three focus areas: quality of work, mental wellbeing, and timeline
progress. Cached daily; regenerated on demand.
"""

import json
import logging
import re
from datetime import timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_active_user
from app.core.database import get_database
from app.core.library import get_knowledge, list_documents
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

BRAIN_COLLECTION = "insights_brain"
FOCUS_KEYS = ("work", "mental", "timeline")


class BrainRequest(BaseModel):
    context: Dict[str, Any] = Field(default_factory=dict)
    force: bool = False


def _public(doc: Dict[str, Any], cached: bool) -> Dict[str, Any]:
    return {
        "focus": doc.get("focus") or {},
        "created_at": doc["created_at"].isoformat(),
        "cached": cached,
    }


def _fallback_focus() -> Dict[str, Any]:
    empty = {
        "headline": "Not enough signal yet",
        "narrative": "Keep using the app — chat, documents, check-ins, and meetings all feed this page.",
        "suggestions": [],
    }
    return {k: dict(empty) for k in FOCUS_KEYS}


@router.post("/insights/brain")
async def insights_brain(
    body: BrainRequest, current_user: User = Depends(get_current_active_user)
):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    user_id = str(current_user.id)

    from app.api.routes.wellness import _build_summary, _now

    cached = await db[BRAIN_COLLECTION].find_one(
        {"user_id": user_id}, sort=[("created_at", -1)]
    )
    if cached and not body.force and cached["created_at"] >= _now() - timedelta(hours=20):
        return _public(cached, cached=True)

    knowledge_md = ""
    try:
        knowledge_md = (await get_knowledge(user_id))["markdown"][:6000]
    except Exception:
        pass
    try:
        wellness = await _build_summary(user_id)
    except Exception:
        wellness = {}
    try:
        docs = await list_documents(user_id)
    except Exception:
        docs = []

    context = body.context or {}
    plan = context.get("plan") or {}
    checkin_lines = [
        f"- {c['date']}: mood {c['mood']}/5, stress {c['stress']}/5"
        + (f", worked {c['work_hours']}h" if c.get("work_hours") is not None else "")
        + (f" — \"{str(c['note'])[:150]}\"" if c.get("note") else "")
        for c in (wellness.get("recent") or [])[:14]
    ]
    doc_lines = [
        f"- {d['name']} ({d['source']}; {d['word_count']} words"
        + (f"; topics: {', '.join((d.get('analysis') or {}).get('topics') or [])}" if d.get("analysis") else "")
        + ")"
        for d in docs[:12]
    ]

    system_prompt = (
        "You are the analytical brain of a PhD coaching app. From everything "
        "the app knows about one student, produce a candid, personal analysis "
        "in three focus areas:\n"
        "1. work — quality of work: is what they're producing what they want "
        "it to be? Ground it in their documents, drafts, and chat history.\n"
        "2. mental — are they doing OK? Ground it in check-ins, burnout "
        "signal, and notes. Warm and honest, never clinical or diagnostic.\n"
        "3. timeline — are they making progress? Where are they slower than "
        "they need to be, and what concrete strategies would speed things up?\n"
        "Rules: reference their actual data — names, numbers, deadlines, "
        "quotes from notes. If a focus area has thin data, say so honestly "
        "instead of inventing. Respond ONLY with JSON: {\"work\": {...}, "
        "\"mental\": {...}, \"timeline\": {...}} where each value is "
        "{\"headline\": string (max 10 words), \"narrative\": string (3-5 "
        "sentences), \"suggestions\": [string, ...] (2-3 concrete actions)}."
    )
    user_prompt = (
        f"PLAN CONTEXT (from the student's live plan):\n{json.dumps(plan)[:2500]}\n\n"
        f"WELLBEING — burnout signal: {json.dumps(wellness.get('burnout') or {})}; "
        f"streak {wellness.get('streak', 0)} days; 7-day averages {json.dumps(wellness.get('averages') or {})}\n"
        f"Recent check-ins:\n{chr(10).join(checkin_lines) or '(none)'}\n\n"
        f"DOCUMENT LIBRARY:\n{chr(10).join(doc_lines) or '(empty)'}\n\n"
        f"EVERYTHING THE COACH KNOWS (accumulated notes from chat, documents, "
        f"meetings, defense practice, wellbeing):\n{knowledge_md or '(nothing yet)'}"
    )

    focus = None
    try:
        from app.llm.clients.provider_manager import create_llm_client

        llm = create_llm_client()
        raw = await llm.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": user_prompt}],
            temperature=0.4,
            max_tokens=1400,
            response_mime_type="application/json",
        )
        cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(cleaned)
        focus = {}
        for key in FOCUS_KEYS:
            section = parsed.get(key) or {}
            focus[key] = {
                "headline": str(section.get("headline") or "")[:120],
                "narrative": str(section.get("narrative") or "")[:1200],
                "suggestions": [str(s)[:300] for s in (section.get("suggestions") or [])[:3]],
            }
        if not any(focus[k]["narrative"] for k in FOCUS_KEYS):
            focus = None
    except Exception as exc:
        logger.warning("Insights brain generation failed for %s: %s", user_id, exc)

    if focus is None:
        focus = _fallback_focus()

    record = {"user_id": user_id, "focus": focus, "created_at": _now()}
    await db[BRAIN_COLLECTION].insert_one(record)
    return _public(record, cached=False)
