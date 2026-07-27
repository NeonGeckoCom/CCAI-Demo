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
SECTION_TYPES = ("narrative", "chart", "actions", "highlight")
CHART_SERIES = ("mood_stress", "work_hours", "phase_progress", "library")
NARRATIVE_ICONS = ("PenTool", "Heart", "TrendingUp", "Lightbulb", "AlertTriangle", "Sparkles", "BookOpen", "Users", "Flag")
TONES = ("win", "watch", "info")


class BrainRequest(BaseModel):
    context: Dict[str, Any] = Field(default_factory=dict)
    force: bool = False


def _public(doc: Dict[str, Any], cached: bool) -> Dict[str, Any]:
    return {
        "sections": doc.get("sections") or [],
        "created_at": doc["created_at"].isoformat(),
        "cached": cached,
    }


def _fallback_sections() -> List[Dict[str, Any]]:
    return [
        {"type": "narrative", "title": "Your brain is warming up", "icon": "Sparkles", "tone": "info",
         "body": "Keep using the app — chat, documents, meetings, check-ins, and defense practice all feed this page. The more it knows, the sharper the feedback gets."},
        {"type": "chart", "series": "phase_progress", "title": "Where your plan stands", "comment": "Task completion by phase, straight from My Plan."},
    ]


def _clean_sections(raw: Any) -> List[Dict[str, Any]]:
    """Validate the LLM's dashboard layout down to render-safe sections."""
    out: List[Dict[str, Any]] = []
    for sec in (raw or []):
        if not isinstance(sec, dict):
            continue
        t = str(sec.get("type") or "")
        if t not in SECTION_TYPES:
            continue
        if t == "narrative":
            body = str(sec.get("body") or "").strip()
            if not body:
                continue
            out.append({
                "type": "narrative",
                "title": str(sec.get("title") or "")[:120],
                "icon": sec.get("icon") if sec.get("icon") in NARRATIVE_ICONS else "Sparkles",
                "tone": sec.get("tone") if sec.get("tone") in TONES else "info",
                "body": body[:1200],
            })
        elif t == "chart":
            if sec.get("series") not in CHART_SERIES:
                continue
            out.append({
                "type": "chart",
                "series": sec["series"],
                "title": str(sec.get("title") or "")[:120],
                "comment": str(sec.get("comment") or "")[:400],
            })
        elif t == "actions":
            items = [str(i)[:300] for i in (sec.get("items") or [])[:4] if str(i).strip()]
            if not items:
                continue
            out.append({"type": "actions", "title": str(sec.get("title") or "Do next")[:120], "items": items})
        elif t == "highlight":
            stat = str(sec.get("stat") or "").strip()
            if not stat:
                continue
            out.append({
                "type": "highlight",
                "stat": stat[:60],
                "label": str(sec.get("label") or "")[:120],
                "comment": str(sec.get("comment") or "")[:300],
            })
        if len(out) >= 9:
            break
    return out


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

    # Data availability — the model may only request charts that have data.
    mood_days = len([c for c in (wellness.get("recent") or []) if c.get("mood") is not None])
    work_days = len([c for c in (wellness.get("recent") or []) if c.get("work_hours") is not None])
    phases_with_tasks = len([p for p in (plan.get("phases") or []) if (p or {}).get("tasksTotal")])

    system_prompt = (
        "You are the living brain of a PhD coaching app: a markdown memory file "
        "that watches everything the student does and composes their personal "
        "Insights dashboard. You decide the layout: which charts to show, what "
        "feedback to give, what to celebrate, what to warn about. Cover three "
        "themes across your sections: quality of work (is it what they want it "
        "to be?), mental wellbeing (are they doing OK?), and timeline progress "
        "(faster, or smarter?).\n"
        "Respond ONLY with JSON: {\"sections\": [4-8 section objects]} where each is one of:\n"
        '{\"type\":\"narrative\",\"title\":str,\"icon\":one of PenTool|Heart|TrendingUp|Lightbulb|AlertTriangle|Sparkles|BookOpen|Users|Flag,\"tone\":\"win\"|\"watch\"|\"info\",\"body\":str 2-4 personal sentences}\n'
        '{\"type\":\"chart\",\"series\":\"mood_stress\"|\"work_hours\"|\"phase_progress\"|\"library\",\"title\":str,\"comment\":str one-line personal takeaway about what THEIR data shows}\n'
        '{\"type\":\"actions\",\"title\":str,\"items\":[2-4 concrete actions]}\n'
        '{\"type\":\"highlight\",\"stat\":short stat like \"6-day streak\",\"label\":str,\"comment\":str}\n'
        "Rules: reference their actual data — names, numbers, deadlines, quotes "
        "from notes; never invent. Include a chart section ONLY if its data "
        "exists per the availability flags. Celebrate at least one real win "
        "(tone \"win\") when any exists. Be honest about thin data. Lead with "
        "what matters most for THIS student right now."
    )
    user_prompt = (
        f"PLAN CONTEXT (from the student's live plan):\n{json.dumps(plan)[:2500]}\n\n"
        f"WELLBEING — burnout signal: {json.dumps(wellness.get('burnout') or {})}; "
        f"streak {wellness.get('streak', 0)} days; 7-day averages {json.dumps(wellness.get('averages') or {})}\n"
        f"Recent check-ins:\n{chr(10).join(checkin_lines) or '(none)'}\n\n"
        f"DOCUMENT LIBRARY:\n{chr(10).join(doc_lines) or '(empty)'}\n\n"
        f"EVERYTHING THE COACH KNOWS (accumulated notes from chat, documents, "
        f"meetings, defense practice, wellbeing):\n{knowledge_md or '(nothing yet)'}\n\n"
        f"CHART DATA AVAILABILITY: mood_stress={mood_days} days; work_hours={work_days} days; "
        f"phase_progress={phases_with_tasks} phases with tasks; library={len(docs)} documents."
    )

    sections = None
    try:
        from app.llm.clients.provider_manager import create_llm_client

        llm = create_llm_client()
        raw = await llm.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": user_prompt}],
            temperature=0.5,
            max_tokens=1800,
            response_mime_type="application/json",
        )
        cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(cleaned)
        sections = _clean_sections(parsed.get("sections"))
        if not sections:
            sections = None
    except Exception as exc:
        logger.warning("Insights brain generation failed for %s: %s", user_id, exc)

    if sections is None:
        sections = _fallback_sections()

    record = {"user_id": user_id, "sections": sections, "created_at": _now()}
    await db[BRAIN_COLLECTION].insert_one(record)
    return _public(record, cached=False)
