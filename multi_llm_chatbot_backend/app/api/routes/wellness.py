"""PhD wellness routes — daily check-ins, streaks, and a burnout signal.

Check-ins live in the ``wellness_checkins`` collection (one document per
check-in). A rolling summary of recent signals is folded into the user's
knowledge markdown so chat advisors respond with awareness of how the
student is actually doing.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_active_user
from app.core.database import get_database
from app.core.library import get_knowledge, upsert_knowledge_section
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

CHECKINS_COLLECTION = "wellness_checkins"
INSIGHTS_COLLECTION = "wellness_insights"

# Evidence-backed practices the insight generator may suggest (each maps to a
# meta-analysis / trial surfaced in the wellness research pass).
PRACTICES = [
    ("Move most days", "3-5 exercise sessions/week, ~150 min total, calendar-blocked like lab meetings"),
    ("Schedule things that aren't the thesis", "book 3-5 pleasurable/social activities into specific slots; do them regardless of mood"),
    ("Guided online CBT course", "one module a week of a structured program (campus TAO/SilverCloud, or moodgym)"),
    ("Protect your wake time", "fixed wake time within 30 min daily, bright light on waking; digital CBT-I if insomnia persists"),
    ("Ten minutes of mindfulness", "10-20 min guided practice daily, attached to a fixed cue like morning coffee"),
    ("Self-compassion break", "5 minutes: name the struggle, normalize it, say what you'd tell a friend"),
    ("Real breaks and a shutdown ritual", "micro-break every 60-90 min; 5-min end-of-day shutdown note, then actually stop"),
    ("Put people on the calendar", "one standing social block weekly plus a small daily touchpoint like lunch with a labmate"),
    ("Write it out", "15-20 min of private expressive writing on 3-4 days after a hard event"),
    ("Engineer the advisor relationship", "standing 30-60 min meeting with a sent agenda; negotiate expectations explicitly"),
]

# The app is a resource CONNECTOR: it routes students to external help rather
# than administering clinical instruments itself. SAFETY copy backs that UI.
SAFETY: Dict[str, str] = {
    "disclaimer": (
        "These check-ins and questionnaires are wellbeing tools, not a diagnosis "
        "or a substitute for professional care. If you're struggling, talking to "
        "a counselor or doctor is a sign of strength, not failure."
    ),
    "low_score_message": (
        "Your answers suggest things have been genuinely hard lately. That's "
        "common in a PhD and it's treatable — consider reaching out to your "
        "campus counseling center or a clinician. If you're in crisis, call or "
        "text 988 (US) or find your local line at findahelpline.com."
    ),
}


class InsightRequest(BaseModel):
    context: Dict[str, Any] = Field(default_factory=dict)
    force: bool = False


class CheckinRequest(BaseModel):
    mood: int = Field(..., ge=1, le=5, description="1 = rough, 5 = great")
    energy: int = Field(3, ge=1, le=5)
    stress: int = Field(3, ge=1, le=5, description="1 = calm, 5 = overwhelmed")
    sleep_hours: Optional[float] = Field(None, ge=0, le=24)
    work_hours: Optional[float] = Field(None, ge=0, le=24)
    note: str = Field("", max_length=2000)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day_key(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _checkin_public(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "date": doc.get("date"),
        "mood": doc.get("mood"),
        "energy": doc.get("energy"),
        "stress": doc.get("stress"),
        "sleep_hours": doc.get("sleep_hours"),
        "work_hours": doc.get("work_hours"),
        "note": doc.get("note") or "",
        "created_at": (doc.get("created_at") or _now()).isoformat(),
    }


def _avg(values: List[float]) -> Optional[float]:
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 2) if values else None


def _compute_burnout(checkins: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rule-based burnout signal from the last 7 days of check-ins."""
    if not checkins:
        return {"level": "unknown", "score": None, "drivers": []}

    stress = _avg([c.get("stress") for c in checkins]) or 3
    energy = _avg([c.get("energy") for c in checkins]) or 3
    mood = _avg([c.get("mood") for c in checkins]) or 3
    sleep = _avg([c.get("sleep_hours") for c in checkins])
    work = _avg([c.get("work_hours") for c in checkins])

    # 0-100: higher = more at risk.
    score = (stress - 1) / 4 * 40 + (5 - energy) / 4 * 30 + (5 - mood) / 4 * 30
    drivers = []
    if stress >= 3.8:
        drivers.append("sustained high stress")
    if energy <= 2.2:
        drivers.append("consistently low energy")
    if mood <= 2.2:
        drivers.append("low mood")
    if sleep is not None and sleep < 6:
        drivers.append(f"short sleep (~{sleep}h/night)")
        score += 8
    if work is not None and work > 10:
        drivers.append(f"long work days (~{work}h)")
        score += 8

    score = round(min(100, max(0, score)))
    level = "low" if score < 35 else "moderate" if score < 65 else "high"
    return {"level": level, "score": score, "drivers": drivers}


def _compute_streak(day_keys: List[str]) -> int:
    """Consecutive days with a check-in, counting back from today/yesterday."""
    days = set(day_keys)
    today = _now()
    streak = 0
    cursor = today
    if _day_key(cursor) not in days:
        cursor = today - timedelta(days=1)  # today not logged yet still keeps streak
    while _day_key(cursor) in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


_LEVEL_NOTES = {
    "low": "Signals look steady — protect what's working.",
    "moderate": "Some strain is showing. Worth planning real recovery time this week.",
    "high": "Strong burnout signals. Consider scaling back this week and talking to your advisor or campus support.",
    "unknown": "Check in for a few days to see trends.",
}


async def _update_wellness_knowledge(user_id: str, summary: Dict[str, Any]) -> None:
    burnout = summary["burnout"]
    lines = [
        f"- Check-ins in the last 14 days: {summary['count_14d']} (current streak: {summary['streak']} days)",
    ]
    if summary["averages"]["mood"] is not None:
        avgs = summary["averages"]
        lines.append(
            f"- 7-day averages — mood {avgs['mood']}/5, energy {avgs['energy']}/5, stress {avgs['stress']}/5"
            + (f", sleep {avgs['sleep_hours']}h" if avgs.get("sleep_hours") is not None else "")
            + (f", work {avgs['work_hours']}h/day" if avgs.get("work_hours") is not None else "")
        )
    lines.append(f"- Burnout signal: {burnout['level']}" + (f" ({burnout['score']}/100)" if burnout["score"] is not None else ""))
    if burnout["drivers"]:
        lines.append(f"- Drivers: {', '.join(burnout['drivers'])}")
    if summary.get("latest_note"):
        lines.append(f"- Latest check-in note: {summary['latest_note'][:280]}")
    lines.append(
        "- Guidance: be encouraging and realistic about workload; if burnout signal is "
        "moderate/high, gently acknowledge it before pushing new tasks."
    )
    await upsert_knowledge_section(user_id, "Wellbeing signals", "\n".join(lines))


async def _build_summary(user_id: str) -> Dict[str, Any]:
    db = get_database()
    since = _now() - timedelta(days=14)
    cursor = (
        db[CHECKINS_COLLECTION]
        .find({"user_id": user_id, "created_at": {"$gte": since}})
        .sort("created_at", -1)
    )
    recent = [c async for c in cursor]
    last7 = [c for c in recent if c["created_at"] >= _now() - timedelta(days=7)]

    all_days_cursor = db[CHECKINS_COLLECTION].find(
        {"user_id": user_id}, {"date": 1}
    ).sort("created_at", -1).limit(120)
    day_keys = [c.get("date") async for c in all_days_cursor if c.get("date")]

    burnout = _compute_burnout(last7)
    latest_note = next((c.get("note") for c in recent if c.get("note")), "")
    summary = {
        "count_14d": len(recent),
        "streak": _compute_streak(day_keys),
        "today_logged": bool(recent and recent[0].get("date") == _day_key(_now())),
        "averages": {
            "mood": _avg([c.get("mood") for c in last7]),
            "energy": _avg([c.get("energy") for c in last7]),
            "stress": _avg([c.get("stress") for c in last7]),
            "sleep_hours": _avg([c.get("sleep_hours") for c in last7]),
            "work_hours": _avg([c.get("work_hours") for c in last7]),
        },
        "burnout": burnout,
        "insight": _LEVEL_NOTES[burnout["level"]],
        "latest_note": latest_note or "",
        "recent": [_checkin_public(c) for c in recent],
    }
    return summary


# ---------------------------------------------------------------------------
# Personal insight — connects check-in trends to the student's actual PhD life
# ---------------------------------------------------------------------------

def _insight_public(doc: Dict[str, Any], cached: bool) -> Dict[str, Any]:
    return {
        "insight": doc.get("insight") or "",
        "suggestion_label": doc.get("suggestion_label") or "",
        "suggestion_detail": doc.get("suggestion_detail") or "",
        "action": doc.get("action") or "none",
        "practice": doc.get("practice") or "",
        "created_at": (doc.get("created_at") or _now()).isoformat(),
        "cached": cached,
    }


def _fallback_insight(summary: Dict[str, Any]) -> Dict[str, Any]:
    burnout = summary.get("burnout") or {}
    return {
        "insight": summary.get("insight") or "Log a few check-ins and I'll start connecting the dots.",
        "suggestion_label": "Keep the streak going",
        "suggestion_detail": "A 10-second check-in each day is enough for real patterns to show.",
        "action": "support" if burnout.get("level") == "high" else "none",
        "practice": "",
        "created_at": _now(),
    }


@router.post("/wellness/insight")
async def wellness_insight(
    body: InsightRequest, current_user: User = Depends(get_current_active_user)
):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    user_id = str(current_user.id)

    latest_checkin = await db[CHECKINS_COLLECTION].find_one(
        {"user_id": user_id}, sort=[("created_at", -1)]
    )
    cached = await db[INSIGHTS_COLLECTION].find_one(
        {"user_id": user_id}, sort=[("created_at", -1)]
    )
    if (
        cached and not body.force
        and cached["created_at"].date() == _now().date()
        and (not latest_checkin or cached["created_at"] >= latest_checkin["created_at"])
    ):
        return _insight_public(cached, cached=True)

    summary = await _build_summary(user_id)

    checkin_lines = [
        f"- {c['date']}: mood {c['mood']}/5, energy {c['energy']}/5, stress {c['stress']}/5"
        + (f", sleep {c['sleep_hours']}h" if c.get("sleep_hours") is not None else "")
        + (f", worked {c['work_hours']}h" if c.get("work_hours") is not None else "")
        + (f" — note: \"{c['note'][:200]}\"" if c.get("note") else "")
        for c in summary["recent"][:14]
    ]
    context = body.context or {}
    upcoming = context.get("upcoming") or []
    upcoming_lines = [
        f"- {str(u.get('title'))[:120]}" + (f" ({str(u.get('when'))[:60]})" if u.get("when") else "")
        for u in upcoming[:6] if isinstance(u, dict)
    ]
    try:
        knowledge_md = (await get_knowledge(user_id))["markdown"][:2000]
    except Exception:
        knowledge_md = ""
    practices_text = "\n".join(f"- {name}: {gist}" for name, gist in PRACTICES)
    burnout = summary["burnout"]

    system_prompt = (
        "You are the wellbeing companion inside a PhD coaching app. From the "
        "student's check-in history and their real PhD context, write ONE short "
        "personal insight (2-3 sentences) that connects their wellbeing pattern "
        "to something concrete in their life — a deadline, workload trend, sleep, "
        "or something they wrote in a note — and ONE concrete suggested action. "
        "Rules: be warm, specific, and honest; reference actual data (names, "
        "numbers, days), never generic filler; never diagnose or use clinical "
        "labels; if the burnout signal is high, the suggestion must gently "
        "include talking to campus counseling or another professional. Stay "
        "anchored on the student's WELLBEING and their PhD plan: background "
        "knowledge about side projects, jobs, or uploaded business documents is "
        "context for workload only — mention it in at most a clause, never "
        "recite its details (figures, deal terms, client names). Respond "
        'ONLY with JSON: {"insight": string, "suggestion_label": string (max 8 '
        'words), "suggestion_detail": string (1-2 sentences), "action": '
        '"plan"|"chat"|"support"|"none", "practice": string (a practice name '
        "from the list, or empty)}. Use action 'plan' when the fix is adjusting "
        "their schedule, 'chat' when talking it through with the coach would "
        "help, 'support' when professional/human support is the right next step."
    )
    user_prompt = (
        f"Check-ins (newest first):\n{chr(10).join(checkin_lines) or '(none yet)'}\n\n"
        f"Burnout signal: {burnout['level']}"
        + (f" ({burnout['score']}/100; drivers: {', '.join(burnout['drivers'])})" if burnout.get("drivers") else "")
        + f"\nCurrent streak: {summary['streak']} days\n\n"
        f"Current milestone: {str(context.get('current_step') or '')[:160]}\n"
        f"Upcoming in their plan:\n{chr(10).join(upcoming_lines) or '(unknown)'}\n\n"
        f"What the coach knows about this student:\n{knowledge_md or '(nothing yet)'}\n\n"
        f"Practices you may suggest (pick at most one, only if it fits):\n{practices_text}"
    )

    record = None
    try:
        from app.llm.clients.provider_manager import create_llm_client
        import json as _json
        import re as _re

        llm = create_llm_client()
        raw = await llm.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": user_prompt}],
            temperature=0.4,
            max_tokens=500,
            response_mime_type="application/json",
        )
        cleaned = _re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=_re.MULTILINE).strip()
        parsed = _json.loads(cleaned)
        action = str(parsed.get("action") or "none")
        record = {
            "insight": str(parsed.get("insight") or "")[:600],
            "suggestion_label": str(parsed.get("suggestion_label") or "")[:80],
            "suggestion_detail": str(parsed.get("suggestion_detail") or "")[:400],
            "action": action if action in ("plan", "chat", "support", "none") else "none",
            "practice": str(parsed.get("practice") or "")[:80],
            "created_at": _now(),
        }
        if not record["insight"]:
            record = None
    except Exception as exc:
        logger.warning("Insight generation failed for %s: %s", user_id, exc)

    if record is None:
        record = _fallback_insight(summary)

    await db[INSIGHTS_COLLECTION].insert_one({"user_id": user_id, **record})
    return _insight_public(record, cached=False)


@router.post("/wellness/checkin")
async def create_checkin(
    body: CheckinRequest, current_user: User = Depends(get_current_active_user)
):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    user_id = str(current_user.id)
    now = _now()
    record = {
        "user_id": user_id,
        "date": _day_key(now),
        "mood": body.mood,
        "energy": body.energy,
        "stress": body.stress,
        "sleep_hours": body.sleep_hours,
        "work_hours": body.work_hours,
        "note": body.note.strip(),
        "created_at": now,
    }
    # One check-in per day — a later check-in replaces today's earlier one.
    await db[CHECKINS_COLLECTION].update_one(
        {"user_id": user_id, "date": record["date"]},
        {"$set": record},
        upsert=True,
    )
    summary = await _build_summary(user_id)
    try:
        await _update_wellness_knowledge(user_id, summary)
    except Exception as exc:
        logger.warning("Could not update wellness knowledge for %s: %s", user_id, exc)
    return {"saved": True, "summary": summary}


@router.get("/wellness/summary")
async def wellness_summary(current_user: User = Depends(get_current_active_user)):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    return await _build_summary(str(current_user.id))


@router.get("/wellness/checkins")
async def wellness_history(
    days: int = 30, current_user: User = Depends(get_current_active_user)
):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    days = max(1, min(days, 180))
    since = _now() - timedelta(days=days)
    cursor = (
        db[CHECKINS_COLLECTION]
        .find({"user_id": str(current_user.id), "created_at": {"$gte": since}})
        .sort("created_at", -1)
    )
    return {"checkins": [_checkin_public(c) async for c in cursor]}
