"""Insights brain — the analytical layer over everything the app knows.

The page composes itself. Every visit, this endpoint builds a *candidate
library* — every metric and every block it could possibly show — scores all of
them, and returns only the ones that earned a slot, plus the bench that didn't.

Two rules keep it honest:

  1. Every number is computed here, in Python, from the user's real records
     (check-ins, documents, chat sessions, plan, and the local tool state the
     client sends). The model never emits a figure.
  2. The model only *chooses and narrates*: it ranks the candidates, writes the
     headline, and authors the prose/callout/quote text — grounded in quotes it
     must lift from the knowledge markdown.

The whole composition is also emitted as `markdown` — insights.md — which is
what the page's X-ray mode and source panel display. The markdown is the real
artifact; the dashboard is a rendering of it.
"""

import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_active_user
from app.core.database import get_database
from app.core.library import get_knowledge, list_documents
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

BRAIN_COLLECTION = "insights_brain"

KEEP_KPIS = 4
KEEP_BLOCKS = 4

TINTS = ("primary", "sage", "amber", "rose", "muted", "off")
EV_TAGS = ("DOC", "CHAT", "PLAN", "DATA", "SKILL", "MEET")


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Any) -> Optional[datetime]:
    """Mongo hands back naive UTC datetimes; ISO strings come from the client."""
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    if isinstance(dt, str) and dt:
        try:
            return _aware(datetime.fromisoformat(dt.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _avg(values: List[Any]) -> Optional[float]:
    vals = [v for v in values if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 2) if vals else None


def _pct(part: float, whole: float) -> int:
    return int(round(100 * part / whole)) if whole else 0


def _plural(n: int, one: str, many: str = "") -> str:
    return one if n == 1 else (many or one + "s")


def _ev(tag: str, label: str, when: str, tint: str = "sage") -> Dict[str, str]:
    return {
        "tag": tag if tag in EV_TAGS else "DATA",
        "label": str(label)[:160],
        "when": str(when)[:80],
        "tint": tint if tint in TINTS else "sage",
    }


# ---------------------------------------------------------------------------
# candidate constructors
# ---------------------------------------------------------------------------

def _kpi(
    cid: str, base: float, label: str, value: str, sub: str, *,
    suffix: str = "", tone: str = "", viz: str = "none",
    pct: str = "", tint: str = "primary", pips: Optional[List[str]] = None,
    spark: Optional[List[float]] = None, delta: str = "", good: bool = True,
    why: str = "", note: str = "", evidence: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    return {
        "id": cid, "base": round(base, 1), "label": label, "value": value,
        "suffix": suffix, "sub": sub, "tone": tone, "viz": viz,
        "pct": pct, "tint": tint, "pips": pips or [], "spark": spark or [],
        "delta": delta, "good": good, "why": why, "note": note,
        "evidence": evidence or [],
    }


def _block(
    cid: str, base: float, btype: str, kicker: str, *, span: int = 7,
    tone: str = "", title: str = "", why: str = "", note2: str = "",
    evidence: Optional[List[Dict[str, str]]] = None, md: Optional[List[str]] = None,
    **payload: Any,
) -> Dict[str, Any]:
    out = {
        "id": cid, "base": round(base, 1), "type": btype, "kicker": kicker,
        "span": span, "tone": tone, "title": title, "why": why, "note2": note2,
        "evidence": evidence or [], "md": md or [],
    }
    out.update(payload)
    return out


# ---------------------------------------------------------------------------
# METRIC CANDIDATES — every one is a real number or it is not offered
# ---------------------------------------------------------------------------

def _kpi_candidates(d: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan = d["plan"]
    well = d["wellness"]
    docs = d["docs"]
    out: List[Dict[str, Any]] = []

    steps_total = plan.get("total_steps") or 0
    steps_done = plan.get("done_steps") or 0
    phases = plan.get("phases") or []
    tasks_done = sum((p or {}).get("tasksDone") or 0 for p in phases)
    tasks_total = sum((p or {}).get("tasksTotal") or 0 for p in phases)
    recent = well.get("recent") or []
    averages = well.get("averages") or {}
    burnout = well.get("burnout") or {}

    # --- plan ---------------------------------------------------------------
    if steps_total:
        share = _pct(steps_done, steps_total)
        out.append(_kpi(
            "milestones", 66 + share * 0.08, "Milestones done", str(steps_done),
            (plan.get("current") and f"Now: {plan['current']}") or "Your plan is complete.",
            suffix=f"/ {steps_total}", viz="progress", pct=f"{share}%", tint="primary",
            why=("Milestones marked done in My Plan, against the "
                 f"{steps_total}-step roadmap built for {plan.get('program') or 'your program'}."),
            note="The number your committee asks for first, so it is always in contention.",
            evidence=[_ev("PLAN", f"{steps_total}-step roadmap, {steps_done} complete", "My Plan", "sage")],
        ))
    if tasks_total:
        share = _pct(tasks_done, tasks_total)
        pips = ["sage" if i < round(share / 20) else "off" for i in range(5)]
        out.append(_kpi(
            "tasks", 58 + share * 0.06, "Tasks done", str(tasks_done),
            f"{share}% of everything on your plan.", suffix=f"/ {tasks_total}",
            viz="pips", pips=pips,
            why="Sub-tasks checked off across every milestone in My Plan.",
            note="Steady progress metric — ranks low unless it moved this week.",
            evidence=[_ev("PLAN", f"{tasks_total} tasks across {len(phases)} phases", "My Plan", "sage")],
        ))
    if phases:
        stalled = [p for p in phases if (p or {}).get("tasksTotal") and not (p or {}).get("tasksDone")]
        if stalled:
            out.append(_kpi(
                "stalled", 79, "Phases not started", str(len(stalled)),
                f"{stalled[0].get('phase')} has no tasks checked off.", tone="warn",
                viz="delta", delta=f"{len(stalled)} of {len(phases)}", good=False,
                why="Phases that have tasks on the plan but none of them checked off yet.",
                note="Promoted whenever a phase with work in it is sitting at zero.",
                evidence=[_ev("PLAN", f"{p.get('phase')}: 0 of {p.get('tasksTotal')} tasks", "My Plan", "amber")
                          for p in stalled[:3]],
            ))

    # --- deadlines the student actually entered ------------------------------
    deadlines = d["deadlines"]
    if deadlines:
        soon = deadlines[0]
        days = soon["days"]
        overdue = [x for x in deadlines if x["days"] < 0]
        if days >= 0:
            urgency = max(0.0, 60.0 - days) * 0.6
            out.append(_kpi(
                "next_deadline", 74 + urgency, f"Days to {soon['label'][:26]}", str(days),
                "Next dated thing on your list." if days > 7 else "This week.",
                tone="warn" if days <= 7 else "", viz="progress",
                pct=f"{max(4, 100 - min(100, days * 2))}%", tint="amber" if days <= 14 else "primary",
                why=(f"Counted from today to {soon['date']}, the nearest deadline in your "
                     "Deadlines tool. A dated, blocking date outranks anything soft."),
                note="A real date always beats a trend.",
                evidence=[_ev("PLAN", f"{x['label']} — {x['date']}", f"in {x['days']} days" if x["days"] >= 0
                              else f"{abs(x['days'])} days ago", "amber" if x["days"] <= 14 else "sage")
                          for x in deadlines[:3]],
            ))
        if overdue:
            out.append(_kpi(
                "overdue", 88, "Overdue items", str(len(overdue)),
                f"Oldest is {abs(overdue[-1]['days'])} days past.", tone="warn",
                viz="delta", delta=f"{abs(overdue[-1]['days'])} days late", good=False,
                why="Deadlines you set whose date has passed with nothing marked done.",
                note="Ranked high whenever the count is above zero.",
                evidence=[_ev("PLAN", x["label"], f"{abs(x['days'])} days overdue", "rose") for x in overdue[:3]],
            ))

    # --- meetings -----------------------------------------------------------
    meetings = d["meetings"]
    if meetings:
        gap = meetings[0]["days_ago"]
        median = d["meeting_median"]
        over = gap - median if median else 0
        out.append(_kpi(
            "advisor_gap", 62 + max(0, over) * 2.2, "Days since a meeting", str(gap),
            (f"Your usual cadence is {median}." if median else "Last one on record."),
            tone="warn" if median and gap > median + 3 else "",
            viz="delta", delta=(f"{over} days over" if over > 0 else "on cadence"), good=over <= 0,
            why=("Time since the most recent entry in your meeting log, measured against your own "
                 f"median gap of {median} days." if median else
                 "Time since the most recent entry in your meeting log."),
            note="Rises as the gap widens; inside your normal cadence it drops out entirely.",
            evidence=[_ev("MEET", m["label"], m["date"], "amber" if i == 0 else "sage")
                      for i, m in enumerate(meetings[:3])],
        ))

    # --- writing ------------------------------------------------------------
    if docs:
        words_total = sum(x.get("word_count") or 0 for x in docs)
        wk = d["words_this_week"]
        prev = d["words_baseline"]
        out.append(_kpi(
            "library_words", 52, "Words in your library",
            (f"{round(words_total / 1000, 1)}k" if words_total >= 1000 else str(words_total)),
            f"Across {len(docs)} {_plural(len(docs), 'document')}.", viz="delta",
            delta=f"+{wk:,} this week" if wk else "no change this week", good=bool(wk),
            why="Every word in every document on your shelf, counted at upload and on every save.",
            note="Inventory, not insight — kept only when nothing sharper is available.",
            evidence=[_ev("DOC", f"{len(docs)} documents on the shelf", f"{words_total:,} words", "sage")],
        ))
        if wk:
            ratio = (wk / prev) if prev else 0
            spike = abs(ratio - 1) * 40 if ratio else 0
            out.append(_kpi(
                "words_week", 70 + min(24, spike), "Words written", f"{wk:,}",
                ("Best week on record." if ratio and ratio >= 1.5 else "Words added this week."),
                viz="delta",
                delta=(f"{round(ratio, 1)}× your average" if ratio else "first week on record"),
                good=(ratio >= 1 if ratio else True),
                why=("Counted across every document that changed in the last seven days, "
                     f"against your {round(prev):,}-word weekly average."),
                note="A large swing off baseline is the biggest anomaly in your numbers.",
                evidence=[_ev("DOC", x["name"], f"+{x['delta']:,} words", "sage") for x in d["doc_deltas"][:3]],
            ))
        analyzed = [x for x in docs if (x.get("analysis") or {}).get("topics")]
        if analyzed:
            out.append(_kpi(
                "analyzed", 47, "Documents analyzed", str(len(analyzed)),
                f"{len(docs) - len(analyzed)} still unread by the coach." if len(analyzed) < len(docs)
                else "Everything on your shelf has been read.",
                suffix=f"/ {len(docs)}", viz="progress", pct=f"{_pct(len(analyzed), len(docs))}%", tint="sage",
                why="Documents the coach has read and pulled topics out of.",
                note="Housekeeping — surfaces only when a lot is still unread.",
                evidence=[_ev("DOC", f"{len(analyzed)} analyzed of {len(docs)}", "Documents shelf", "sage")],
            ))

    # --- wellbeing ----------------------------------------------------------
    mood_series = [c.get("mood") for c in reversed(recent) if c.get("mood") is not None]
    if len(mood_series) >= 3:
        cur = _avg(mood_series[-7:]) or 0
        old = _avg(mood_series[:-7]) or cur
        drop = old - cur
        out.append(_kpi(
            "mood", 63 + max(0.0, drop) * 12, "Mood, 7-day average", f"{cur}",
            (f"Down {round(drop, 1)} from earlier." if drop > 0.3 else
             f"Up {round(-drop, 1)}." if drop < -0.3 else "Holding steady."),
            suffix="/ 5", tone="warn" if drop > 0.5 else "", viz="spark", spark=mood_series[-12:],
            why=("Averaged from your Wellbeing check-ins over the last seven days, against the "
                 "days before them. This is the softest number here — a nudge, not a diagnosis."),
            note="A falling trend is promoted over a flat one, even at low confidence.",
            evidence=[_ev("DATA", f"{len(mood_series)} check-ins logged", "Wellbeing page",
                          "amber" if drop > 0.5 else "sage")],
        ))
    stress_series = [c.get("stress") for c in reversed(recent) if c.get("stress") is not None]
    if len(stress_series) >= 3:
        cur = _avg(stress_series[-7:]) or 0
        out.append(_kpi(
            "stress", 55 + max(0.0, cur - 3) * 10, "Stress, 7-day average", f"{cur}",
            "Higher than you usually log." if cur >= 3.6 else "Inside your normal range.",
            suffix="/ 5", tone="warn" if cur >= 3.6 else "", viz="spark", spark=stress_series[-12:],
            why="Averaged from the stress slider on your check-ins over the last seven days.",
            note="Rises with the number; a calm week keeps it off the page.",
            evidence=[_ev("DATA", f"{len(stress_series)} stress ratings", "Wellbeing page", "sage")],
        ))
    if averages.get("work_hours") is not None:
        hrs = averages["work_hours"]
        out.append(_kpi(
            "work_hours", 50 + max(0.0, hrs - 9) * 7, "Hours worked / day", f"{hrs}",
            "Above a sustainable week." if hrs >= 10 else "Averaged over your last seven check-ins.",
            tone="warn" if hrs >= 10 else "", viz="delta",
            delta=f"{round(hrs * 7)} hrs / wk", good=hrs < 10,
            why="Self-reported hours on your check-ins, averaged over the last seven days.",
            note="Only interesting when it is high enough to cost you something.",
            evidence=[_ev("DATA", "Work hours from check-ins", "Last 7 days", "amber" if hrs >= 10 else "sage")],
        ))
    if averages.get("sleep_hours") is not None:
        slp = averages["sleep_hours"]
        out.append(_kpi(
            "sleep", 48 + max(0.0, 7 - slp) * 9, "Sleep, nightly average", f"{slp}",
            "Short nights are stacking up." if slp < 6.5 else "Roughly where you want it.",
            suffix="hrs", tone="warn" if slp < 6.5 else "", viz="progress",
            pct=f"{min(100, _pct(slp, 8))}%", tint="rose" if slp < 6.5 else "sage",
            why="Self-reported sleep on your check-ins, averaged over the last seven days.",
            note="Climbs sharply below seven hours — it front-runs every other wellbeing signal.",
            evidence=[_ev("DATA", "Sleep from check-ins", "Last 7 days", "rose" if slp < 6.5 else "sage")],
        ))
    level = burnout.get("level")
    if level in ("low", "moderate", "high"):
        idx = {"low": 1, "moderate": 3, "high": 5}[level]
        tint = {"low": "sage", "moderate": "amber", "high": "rose"}[level]
        out.append(_kpi(
            "burnout", {"low": 44, "moderate": 72, "high": 92}[level], "Burnout signal", level.title(),
            (burnout.get("drivers") or ["Nothing pulling on it right now."])[0],
            tone="warn" if level != "low" else "", viz="pips",
            pips=[tint if i < idx else "off" for i in range(5)],
            why=("A rule-based read of your last seven check-ins — mood, stress, sleep and hours "
                 "together. It never leaves this app and it is not a clinical measure."),
            note="A high signal outranks everything except a dated deadline.",
            evidence=[_ev("DATA", drv, "Last 7 days", tint) for drv in (burnout.get("drivers") or [])[:3]]
                     or [_ev("DATA", f"Signal: {level}", "Last 7 days", tint)],
        ))
    streak = well.get("streak") or 0
    if streak:
        out.append(_kpi(
            "streak", 40 + min(24, streak * 2), "Check-in streak", str(streak),
            "Longest run you've logged." if streak >= 7 else "Keep it going.",
            suffix="days", viz="progress", pct=f"{min(100, streak * 10)}%", tint="sage",
            why="Consecutive days with a Wellbeing check-in logged.",
            note="A good-news metric — kept only when nothing urgent needs the slot.",
            evidence=[_ev("DATA", f"{streak}-day streak", "Wellbeing page", "sage")],
        ))

    if averages.get("energy") is not None:
        en = averages["energy"]
        out.append(_kpi(
            "energy", 46 + max(0.0, 3 - en) * 11, "Energy, 7-day average", f"{en}",
            "Running low most days." if en <= 2.6 else "Roughly where you usually sit.",
            suffix="/ 5", tone="warn" if en <= 2.6 else "", viz="spark",
            spark=[c.get("energy") for c in reversed(recent) if c.get("energy") is not None][-12:],
            why="The energy slider on your check-ins, averaged over the last seven days.",
            note="Reads earlier than mood does — energy usually drops first.",
            evidence=[_ev("DATA", "Energy from check-ins", "Last 7 days", "amber" if en <= 2.6 else "sage")],
        ))
    logged = well.get("count_14d") or 0
    if logged:
        out.append(_kpi(
            "checkin_rate", 34 + min(20, logged), "Check-ins logged", str(logged),
            "Enough to see a pattern." if logged >= 7 else "A few more and the trends sharpen.",
            suffix="/ 14 days", viz="progress", pct=f"{_pct(logged, 14)}%",
            tint="sage" if logged >= 7 else "amber",
            why="Days in the last fortnight with a Wellbeing check-in on record.",
            note="How much of everything else here you can trust.",
            evidence=[_ev("DATA", f"{logged} check-ins in 14 days", "Wellbeing page", "sage")],
        ))

    # --- conversations ------------------------------------------------------
    if d["chat_count"]:
        out.append(_kpi(
            "chats", 43, "Conversations", str(d["chat_count"]),
            f"{d['chat_week']} this week." if d["chat_week"] else "None started this week.",
            viz="delta", delta=f"+{d['chat_week']}" if d["chat_week"] else "quiet week",
            good=bool(d["chat_week"]),
            why="Advisor conversations on record, and how many of them you opened this week.",
            note="Inventory, not insight.",
            evidence=[_ev("CHAT", f"{d['chat_count']} conversations", "Chat history", "sage")],
        ))
    if d["docs"]:
        out.append(_kpi(
            "docs_count", 38, "Documents on the shelf", str(len(d["docs"])),
            f"{len(d['doc_deltas'])} touched this week." if d["doc_deltas"] else "None touched this week.",
            viz="delta", delta=f"+{len(d['doc_deltas'])} this week" if d["doc_deltas"] else "nothing moved",
            good=bool(d["doc_deltas"]),
            why="Everything stored in your Documents shelf, and how much of it you opened this week.",
            note="Inventory, not insight.",
            evidence=[_ev("DOC", f"{len(d['docs'])} documents", "Documents shelf", "sage")],
        ))
    if d["meetings"]:
        out.append(_kpi(
            "meetings_total", 36, "Meetings on record", str(len(d["meetings"])),
            (f"Median gap {d['meeting_median']} days." if d["meeting_median"] else "Logged in your meeting log."),
            viz="delta", delta=f"{len(d['meetings'])} logged", good=True,
            why="Every meeting you've logged, with the median gap between them.",
            note="Context for the cadence metric, not a story on its own.",
            evidence=[_ev("MEET", f"{len(d['meetings'])} meetings logged", "Meetings page", "sage")],
        ))
    upcoming_dates = [x for x in d["deadlines"] if x["days"] >= 0]
    if len(upcoming_dates) > 1:
        out.append(_kpi(
            "deadlines_open", 42, "Dated items ahead", str(len(upcoming_dates)),
            f"Next one in {upcoming_dates[0]['days']} days.",
            viz="pips", pips=["amber" if i < min(5, len(upcoming_dates)) else "off" for i in range(5)],
            why="Everything with a date in your Deadlines tool that hasn't passed yet.",
            note="The shape of the term ahead — the nearest one ranks higher on its own.",
            evidence=[_ev("PLAN", x["label"], x["date"], "amber") for x in upcoming_dates[:3]],
        ))
    gates = [s for s in (plan.get("steps") or []) if isinstance(s, dict) and s.get("gate")]
    if gates:
        passed = len([s for s in gates if s.get("status") == "done"])
        out.append(_kpi(
            "gates", 57, "Gates passed", str(passed), "Formal checkpoints on your roadmap.",
            suffix=f"/ {len(gates)}", viz="progress",
            pct=f"{_pct(passed, len(gates))}%", tint="primary",
            why="The formal checkpoints your program gates progress on — comps, candidacy, defense.",
            note="Slower-moving than the milestone count, and the one your program actually tracks.",
            evidence=[_ev("PLAN", f"{len(gates)} gates on the roadmap", f"{passed} passed", "sage")],
        ))
    return out


# ---------------------------------------------------------------------------
# BLOCK CANDIDATES — numeric blocks are built from records; the model may only
# author the prose ones, and only from quotes it lifts out of the notes.
# ---------------------------------------------------------------------------

def _block_candidates(d: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan = d["plan"]
    well = d["wellness"]
    docs = d["docs"]
    recent = well.get("recent") or []
    out: List[Dict[str, Any]] = []

    # --- mood / stress over time -------------------------------------------
    mood = [c.get("mood") for c in reversed(recent) if c.get("mood") is not None]
    if len(mood) >= 4:
        labels = [c.get("date", "")[5:] for c in reversed(recent) if c.get("mood") is not None]
        out.append(_block(
            "mood_chart", 74, "area", "How the weeks have felt", span=7,
            series=mood[-14:], max=5, pace=3.5, paceLabel="Your average",
            xLabels=labels[-14:], body="Mood per check-in · last 14 days",
            note=("Trending down over the window." if (_avg(mood[-4:]) or 0) < (_avg(mood[:4]) or 0)
                  else "Holding or climbing across the window."),
            title="Your mood line, plotted",
            why=("Every mood rating you logged, in order. The dashed line is your own average "
                 "across the window — not a target anyone set for you."),
            note2="Charts rank on how strong the trend is, not on how the numbers look.",
            md=["## How the weeks have felt", "::chart{type=area src=wellbeing-checkins field=mood}"],
            evidence=[_ev("DATA", f"{len(mood)} mood ratings", "Wellbeing check-ins", "sage")],
        ))
    work = [c.get("work_hours") for c in reversed(recent) if c.get("work_hours") is not None]
    if len(work) >= 4:
        out.append(_block(
            "work_chart", 66, "area", "Hours, day by day", span=7,
            series=work[-14:], max=max(10, max(work)), pace=round(_avg(work) or 8, 1),
            paceLabel="Your average", body="Hours worked per day · last 14 days",
            xLabels=[c.get("date", "")[5:] for c in reversed(recent) if c.get("work_hours") is not None][-14:],
            note=f"Averaging {round(_avg(work) or 0, 1)} hours a day across the window.",
            title="Where the hours actually went",
            why="Self-reported hours from each check-in, in order, against your own average.",
            md=["## Hours", "::chart{type=area src=wellbeing-checkins field=work_hours}"],
            evidence=[_ev("DATA", f"{len(work)} days logged", "Wellbeing check-ins", "sage")],
        ))

    # --- plan progress ------------------------------------------------------
    phases = [p for p in (plan.get("phases") or []) if (p or {}).get("tasksTotal")]
    if phases:
        out.append(_block(
            "phase_bars", 72, "bars", "Progress by phase", span=5,
            body="Tasks completed in each phase of your plan",
            rows=[{"name": p.get("phase") or "Phase", "n": f"{p.get('tasksDone', 0)}/{p.get('tasksTotal', 0)}",
                   "value": p.get("tasksDone") or 0, "of": p.get("tasksTotal") or 1,
                   "tint": ("sage" if (p.get("tasksDone") or 0) >= (p.get("tasksTotal") or 1)
                            else "primary" if p.get("tasksDone") else "muted")}
                  for p in phases],
            note=(f"{plan.get('current')} is where the plan says you are now."
                  if plan.get("current") else "Straight from My Plan."),
            title="Which phase is carrying the work",
            why="Task completion per phase, read directly off My Plan as you check things off.",
            md=["## Progress", "::chart{type=bar src=plan group=phase}"],
            evidence=[_ev("PLAN", f"{len(phases)} phases with tasks", "My Plan", "sage")],
        ))
        upcoming = d["plan_rows"]
        if upcoming:
            out.append(_block(
                "milestone_table", 70, "table", "Milestones on the clock", span=7,
                cols=["Milestone", "Phase", "Status"], trows=upcoming,
                title="Where each milestone stands",
                why=("Every step on your roadmap with its current state. Anything marked redo or "
                     "paused is what the rest of the plan is waiting on."),
                md=["## Milestones", "::table{src=plan cols=name,phase,status}"],
                evidence=[_ev("PLAN", f"{plan.get('total_steps')}-step roadmap", "My Plan", "sage")],
            ))

    # --- document library ---------------------------------------------------
    if docs:
        by_source = Counter((x.get("source") or "documents") for x in docs)
        if len(by_source) > 1:
            total = sum(by_source.values())
            palette = ["primary", "sage", "amber", "muted"]
            out.append(_block(
                "library_donut", 56, "donut", "What's on your shelf", span=5,
                slices=[{"label": k.replace("-", " ").title(), "pct": _pct(v, total), "tint": palette[i % 4]}
                        for i, (k, v) in enumerate(by_source.most_common(4))],
                note=f"{total} {_plural(total, 'document')} in total, grouped by where each one came from.",
                title="Your library, by origin",
                why="Every document on your shelf, grouped by whether you uploaded it or a Skill produced it.",
                md=["::chart{type=donut src=documents group=source}"],
                evidence=[_ev("DOC", f"{total} documents", "Documents shelf", "sage")],
            ))
        topics = Counter()
        for x in docs:
            for t in ((x.get("analysis") or {}).get("topics") or [])[:6]:
                topics[str(t).strip().lower()] += 1
        if len(topics) >= 3:
            top = topics.most_common(5)
            thin = [t for t, n in top if n == 1]
            out.append(_block(
                "topic_bars", 64, "bars", "What your work is about", span=5,
                body="Topics the coach pulled out of your documents",
                rows=[{"name": t.title(), "n": str(n), "value": n, "of": top[0][1],
                       "tint": "primary" if n >= top[0][1] * 0.6 else "amber" if n > 1 else "rose"}
                      for t, n in top],
                note=(f"{', '.join(x.title() for x in thin[:2])} appears in only one document — "
                      "that is where a skeptical reader would push."
                      if thin else "Your documents cluster tightly around one line of work."),
                title="Two thin areas a committee would find",
                why="Topics extracted from each analyzed document, counted across your whole shelf.",
                md=["::chart{type=bar src=documents group=topic}"],
                evidence=[_ev("DOC", f"{len([x for x in docs if (x.get('analysis') or {}).get('topics')])} "
                              "documents analyzed", "Documents shelf", "sage")],
            ))
        big = sorted(docs, key=lambda x: x.get("word_count") or 0, reverse=True)[:6]
        if len(big) >= 3:
            out.append(_block(
                "doc_table", 50, "table", "Your longest documents", span=7,
                cols=["Document", "Words", "Source"],
                trows=[{"name": x["name"], "c2": f"{x.get('word_count') or 0:,}",
                        "c3": (x.get("source") or "documents").replace("-", " "),
                        "tint": "sage" if (x.get("word_count") or 0) > 2000 else "muted"} for x in big],
                title="Where the words are",
                why="Documents on your shelf ranked by length, with where each one came from.",
                md=["::table{src=documents cols=name,words,source}"],
                evidence=[_ev("DOC", f"{len(docs)} documents", "Documents shelf", "sage")],
            ))

    sleep = [c.get("sleep_hours") for c in reversed(recent) if c.get("sleep_hours") is not None]
    if len(sleep) >= 4:
        out.append(_block(
            "sleep_chart", 68, "area", "How you've been sleeping", span=7,
            series=sleep[-14:], max=max(9, max(sleep)), pace=7, paceLabel="7 hours",
            body="Hours slept per night · last 14 days",
            xLabels=[c.get("date", "")[5:] for c in reversed(recent) if c.get("sleep_hours") is not None][-14:],
            note=(f"Averaging {round(_avg(sleep) or 0, 1)} hours — under the seven-hour line."
                  if (_avg(sleep) or 9) < 7 else f"Averaging {round(_avg(sleep) or 0, 1)} hours a night."),
            title="Your sleep, night by night",
            why=("Self-reported hours from each check-in. The dashed line is seven hours — not a "
                 "target we set, just where cognitive performance stops degrading in the research."),
            md=["## Sleep", "::chart{type=area src=wellbeing-checkins field=sleep_hours}"],
            evidence=[_ev("DATA", f"{len(sleep)} nights logged", "Wellbeing check-ins",
                          "rose" if (_avg(sleep) or 9) < 6.5 else "sage")],
        ))
    stress = [c.get("stress") for c in reversed(recent) if c.get("stress") is not None]
    if len(stress) >= 4:
        out.append(_block(
            "stress_chart", 58, "area", "Where the pressure sat", span=7,
            series=stress[-14:], max=5, pace=round(_avg(stress) or 3, 1), paceLabel="Your average",
            body="Stress per check-in · last 14 days",
            xLabels=[c.get("date", "")[5:] for c in reversed(recent) if c.get("stress") is not None][-14:],
            note=f"Averaging {round(_avg(stress) or 0, 1)} out of 5 across the window.",
            title="Your stress line, plotted",
            why="Every stress rating you logged, in order, against your own average.",
            md=["::chart{type=area src=wellbeing-checkins field=stress}"],
            evidence=[_ev("DATA", f"{len(stress)} stress ratings", "Wellbeing check-ins", "sage")],
        ))
    if len([c for c in recent if c.get("mood") is not None]) >= 5:
        buckets = Counter()
        for c in recent:
            if c.get("mood") is not None:
                buckets[["Rough", "Low", "Okay", "Good", "Great"][max(0, min(4, int(c["mood"]) - 1))]] += 1
        total = sum(buckets.values())
        palette = {"Great": "sage", "Good": "sage", "Okay": "amber", "Low": "rose", "Rough": "rose"}
        out.append(_block(
            "mood_mix", 46, "donut", "How the days broke down", span=5,
            slices=[{"label": k, "pct": _pct(v, total), "tint": palette.get(k, "muted")}
                    for k, v in buckets.most_common(5)],
            note=f"{total} check-ins, grouped by the mood you picked.",
            title="Your fortnight, by kind of day",
            why="Every mood rating in the last fortnight, counted by which face you picked.",
            md=["::chart{type=donut src=wellbeing-checkins group=mood}"],
            evidence=[_ev("DATA", f"{total} check-ins", "Last 14 days", "sage")],
        ))

    # --- dated things -------------------------------------------------------
    if len(d["deadlines"]) >= 2:
        today = _now().date()
        out.append(_block(
            "deadline_table", 76, "table", "What's dated", span=7,
            cols=["Item", "Date", "When"],
            trows=[{"name": x["label"], "c2": x["date"],
                    "c3": (f"in {x['days']}d" if x["days"] > 0 else "today" if x["days"] == 0
                           else f"{abs(x['days'])}d late"),
                    "tint": "rose" if x["days"] < 0 else "amber" if x["days"] <= 14 else "sage"}
                   for x in d["deadlines"][:6]],
            title="Everything with a date on it",
            why=("The deadlines you entered, nearest first, with anything overdue at the bottom. "
                 f"Measured against {today.isoformat()}."),
            md=["## Dated", "::table{src=deadlines cols=name,date,when}"],
            evidence=[_ev("PLAN", f"{len(d['deadlines'])} dated items", "Deadlines tool", "amber")],
        ))
    if len(d["meetings"]) >= 3:
        out.append(_block(
            "meeting_table", 54, "table", "Meeting rhythm", span=7,
            cols=["Meeting", "Date", "Gap"],
            trows=[{"name": m["label"], "c2": m["date"],
                    "c3": (f"{m['days_ago']}d ago"),
                    "tint": "amber" if i == 0 and m["days_ago"] > (d["meeting_median"] or 99) else "sage"}
                   for i, m in enumerate(d["meetings"][:6])],
            title=(f"You meet about every {d['meeting_median']} days"
                   if d["meeting_median"] else "Your meetings on record"),
            why="Every meeting you've logged, most recent first, with how long ago each one was.",
            md=["::table{src=meetings cols=name,date,gap}"],
            evidence=[_ev("MEET", f"{len(d['meetings'])} meetings", "Meetings page", "sage")],
        ))

    # --- activity heatmap ---------------------------------------------------
    if d["heat_total"] >= 8:
        out.append(_block(
            "activity", 60, "heatmap", "Everything you've done here", span=12,
            body=f"Every document, check-in, meeting and conversation · last {d['heat_weeks']} weeks",
            cells=d["heat_cells"], stats=d["heat_stats"],
            title="Your working rhythm, laid out",
            why=("Every event this app has a timestamp for — documents saved, check-ins logged, "
                 "meetings recorded, conversations opened — placed on the day it happened."),
            md=[f"::heatmap{{src=canvas-activity days={d['heat_weeks'] * 7}}}"],
            evidence=[_ev("DATA", f"{d['heat_total']} events", f"Last {d['heat_weeks'] * 7} days", "sage")],
        ))
        heat = d["heat"]
        if heat.get("by_weekday"):
            names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            peak = max(heat["by_weekday"]) or 1
            out.append(_block(
                "weekday_bars", 52, "bars", "Which days you actually work", span=5,
                body="Everything you did here, by day of the week",
                rows=[{"name": names[i], "n": str(n), "value": n, "of": peak,
                       "tint": "primary" if n >= peak * 0.6 else "amber" if n else "muted"}
                      for i, n in enumerate(heat["by_weekday"])],
                note=(f"{heat['best_day']} carries the most, {heat['quiet_day']} the least — "
                      "worth knowing before you schedule your hardest work."
                      if heat.get("best_day") else "Straight from your event log."),
                title=f"{heat.get('best_day') or 'One day'} is doing the heavy lifting",
                why="Every timestamped event this app has, bucketed by the weekday it fell on.",
                md=["::chart{type=bar src=canvas-activity group=weekday}"],
                evidence=[_ev("DATA", f"{d['heat_total']} events", f"Last {d['heat_weeks'] * 7} days", "sage")],
            ))
    return out


# ---------------------------------------------------------------------------
# activity heatmap + derived stats
# ---------------------------------------------------------------------------

def _build_activity(events: List[Tuple[datetime, str]], weeks: int = 18) -> Dict[str, Any]:
    today = _now().date()
    # end the grid on the Sunday of this week so the columns are whole weeks
    end = today + timedelta(days=(6 - today.weekday()))
    start = end - timedelta(days=weeks * 7 - 1)
    counts: Counter = Counter()
    for when, _kind in events:
        dt = _aware(when)
        if not dt:
            continue
        day = dt.date()
        if start <= day <= end:
            counts[day.isoformat()] += 1

    cells: List[int] = []
    peak = max(counts.values()) if counts else 0
    for w in range(weeks):
        for wd in range(7):
            day = start + timedelta(days=w * 7 + wd)
            n = counts.get(day.isoformat(), 0)
            if not peak or not n:
                cells.append(0)
            else:
                share = n / peak
                cells.append(1 if share <= 0.25 else 2 if share <= 0.5 else 3 if share <= 0.75 else 4)

    # longest streak of consecutive active days
    streak = best = 0
    cursor = start
    while cursor <= end:
        if counts.get(cursor.isoformat()):
            streak += 1
            best = max(best, streak)
        else:
            streak = 0
        cursor += timedelta(days=1)

    by_weekday: Counter = Counter()
    for key, n in counts.items():
        by_weekday[datetime.fromisoformat(key).weekday()] += n
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    active_weeks = len({datetime.fromisoformat(k).isocalendar()[:2] for k in counts})

    stats = [{"k": "Longest streak", "v": f"{best} {_plural(best, 'day')}"}]
    if by_weekday:
        stats.append({"k": "Best day", "v": names[by_weekday.most_common(1)[0][0]]})
        quiet = min(range(7), key=lambda i: by_weekday.get(i, 0))
        stats.append({"k": "Quietest", "v": names[quiet]})
    stats.append({"k": "Weeks active", "v": f"{active_weeks} / {weeks}"})

    quiet = min(range(7), key=lambda i: by_weekday.get(i, 0)) if by_weekday else 0
    return {"cells": cells, "stats": stats, "total": sum(counts.values()), "weeks": weeks,
            "best_day": names[by_weekday.most_common(1)[0][0]] if by_weekday else "",
            "quiet_day": names[quiet] if by_weekday else "",
            "by_weekday": [by_weekday.get(i, 0) for i in range(7)] if by_weekday else [],
            "streak": best}


# ---------------------------------------------------------------------------
# gather everything the composer needs
# ---------------------------------------------------------------------------

async def _gather(user_id: str, raw_user_id: Any, context: Dict[str, Any]) -> Dict[str, Any]:
    from app.api.routes.wellness import _build_summary

    db = get_database()
    plan = context.get("plan") or {}

    try:
        knowledge = (await get_knowledge(user_id)).get("markdown") or ""
    except Exception:
        knowledge = ""
    try:
        wellness = await _build_summary(user_id)
    except Exception:
        wellness = {}
    try:
        docs = await list_documents(user_id)
    except Exception:
        docs = []

    chat_count = 0
    chat_week = 0
    chat_events: List[Tuple[datetime, str]] = []
    try:
        cursor = db.chat_sessions.find(
            {"user_id": raw_user_id, "is_active": True}, {"created_at": 1, "updated_at": 1, "title": 1}
        ).sort("updated_at", -1).limit(400)
        week_ago = _now() - timedelta(days=7)
        async for s in cursor:
            chat_count += 1
            touched = _aware(s.get("updated_at")) or _aware(s.get("created_at"))
            if touched:
                chat_events.append((touched, "chat"))
                if touched >= week_ago:
                    chat_week += 1
    except Exception:
        pass

    # ---- documents: what moved this week, and the weekly baseline ----------
    week_ago = _now() - timedelta(days=7)
    doc_deltas: List[Dict[str, Any]] = []
    words_this_week = 0
    for x in docs:
        touched = _aware(x.get("updated_at")) or _aware(x.get("created_at"))
        if touched and touched >= week_ago:
            words = x.get("word_count") or 0
            words_this_week += words
            doc_deltas.append({"name": x.get("name") or "Untitled", "delta": words})
    doc_deltas.sort(key=lambda x: x["delta"], reverse=True)
    oldest = min((_aware(x.get("created_at")) for x in docs if _aware(x.get("created_at"))), default=None)
    span_weeks = max(1.0, ((_now() - oldest).days / 7) if oldest else 1.0)
    words_baseline = sum(x.get("word_count") or 0 for x in docs) / span_weeks

    # ---- local tool state the client sends (deadlines, meetings) -----------
    today = _now().date()
    deadlines: List[Dict[str, Any]] = []
    for item in (context.get("deadlines") or [])[:40]:
        if not isinstance(item, dict):
            continue
        when = _aware(item.get("date"))
        label = str(item.get("label") or item.get("title") or "").strip()
        if not when or not label or item.get("done"):
            continue
        deadlines.append({"label": label[:80], "date": when.date().isoformat(),
                          "days": (when.date() - today).days})
    deadlines.sort(key=lambda x: x["days"])
    upcoming = [x for x in deadlines if x["days"] >= 0]
    overdue = [x for x in deadlines if x["days"] < 0]
    deadlines = upcoming + overdue  # nearest first, then the late ones

    meetings: List[Dict[str, Any]] = []
    for item in (context.get("meetings") or [])[:60]:
        if not isinstance(item, dict):
            continue
        when = _aware(item.get("date"))
        if not when:
            continue
        meetings.append({
            "label": str(item.get("title") or item.get("with") or "Meeting")[:80],
            "date": when.date().isoformat(),
            "days_ago": (today - when.date()).days,
            "when": when,
        })
    meetings.sort(key=lambda x: x["days_ago"])
    past = [m for m in meetings if m["days_ago"] >= 0]
    gaps = [past[i]["days_ago"] - past[i + 1]["days_ago"] for i in range(len(past) - 1)]
    gaps = sorted(g for g in gaps if g > 0)
    meeting_median = gaps[len(gaps) // 2] if gaps else 0

    # ---- plan rows ---------------------------------------------------------
    status_tint = {"done": "sage", "current": "primary", "redo": "rose", "paused": "amber"}
    plan_rows = [
        {"name": str(s.get("title") or "")[:70], "c2": str(s.get("phase") or "")[:24],
         "c3": str(s.get("status") or "upcoming").title(),
         "tint": status_tint.get(s.get("status"), "muted")}
        for s in (plan.get("steps") or [])[:8] if isinstance(s, dict) and s.get("title")
    ]

    # ---- activity heatmap --------------------------------------------------
    events: List[Tuple[datetime, str]] = list(chat_events)
    for x in docs:
        for key in ("created_at", "updated_at"):
            dt = _aware(x.get(key))
            if dt:
                events.append((dt, "doc"))
    for c in (wellness.get("recent") or []):
        dt = _aware(c.get("created_at")) or _aware(c.get("date"))
        if dt:
            events.append((dt, "checkin"))
    for m in meetings:
        events.append((m["when"], "meeting"))
    heat = _build_activity(events)

    return {
        "plan": plan, "wellness": wellness, "docs": docs, "knowledge": knowledge,
        "chat_count": chat_count, "chat_week": chat_week,
        "words_this_week": words_this_week, "words_baseline": words_baseline,
        "doc_deltas": doc_deltas, "deadlines": deadlines, "meetings": past,
        "meeting_median": meeting_median, "plan_rows": plan_rows,
        "heat_cells": heat["cells"], "heat_stats": heat["stats"],
        "heat_total": heat["total"], "heat_weeks": heat["weeks"], "heat": heat,
    }


# ---------------------------------------------------------------------------
# the model's turn: rank the candidates, write the headline, author the prose
# ---------------------------------------------------------------------------

def _compose_prompt(d: Dict[str, Any], kpis: List[Dict[str, Any]], blocks: List[Dict[str, Any]]) -> Tuple[str, str]:
    plan = d["plan"]
    system = (
        "You are the composing layer of a PhD coaching app's Insights page. Every visit, the app "
        "builds a library of candidate metrics and candidate blocks from the student's real records "
        "and asks you to compose the page from them.\n\n"
        "YOU DO NOT PRODUCE NUMBERS. Every figure in the candidate list was computed from the "
        f"database. Your job is to (1) rank, (2) title, and (3) write the prose.\n\n"
        f"Respond ONLY with JSON:\n"
        "{\n"
        f'  "headline": one sentence, second person, naming something specific from their data,\n'
        f'  "keep_metrics": [{KEEP_KPIS} candidate metric ids, most important first],\n'
        f'  "keep_blocks": [{KEEP_BLOCKS} candidate block ids OR authored block ids, most important first],\n'
        '  "notes": {"<candidate id>": "one sentence on why this earned its slot"},\n'
        '  "authored": [ up to 3 blocks you write yourself, each one of: \n'
        '     {"id":"narrative","type":"prose","kicker":"What I\'m seeing","title":str,'
        '"lead":one strong sentence,"paras":[1-2 paragraphs],"why":how you arrived at it},\n'
        '     {"id":"wellbeing","type":"callout","tone":"watch","kicker":"Worth watching","title":str,'
        '"lead":str,"body":str,"cta":short button label,"why":str},\n'
        '     {"id":"win","type":"callout","tone":"win","kicker":"Worth noticing","title":str,'
        '"lead":str,"body":str,"cta":str,"why":str},\n'
        '     {"id":"quote","type":"quote","kicker":"From your notes","title":str,'
        '"lead":a sentence quoted VERBATIM from their notes,"cite":where it came from,'
        '"body":why it matters,"cta":str,"why":str},\n'
        '     {"id":"tasks","type":"tasks","kicker":"What to do next","title":str,"body":str,'
        '"items":[{"title":str,"due":str,"source":where you found it,"urgent":bool}],"why":str}\n'
        "  ]\n}\n\n"
        "Rules. Rank on: a dated deadline beats everything; a signal that moved beats one that "
        "sat still; a wellbeing risk beats a vanity number; inventory counts rank last. Prefer a "
        "mix — do not keep four charts. Quote their actual words when you have them. If the notes "
        "are thin, say so plainly instead of inventing a pattern; author fewer blocks rather than "
        "hollow ones. Never state a number that is not in the candidate list. Second person, warm, "
        "specific, no praise you cannot justify from the records."
    )
    lines_k = [f"- {k['id']} | {k['label']}: {k['value']}{k['suffix']} — {k['sub']} (base {k['base']})"
               for k in kpis]
    lines_b = [f"- {b['id']} | {b['type']} · {b['kicker']} — {b.get('title') or ''} (base {b['base']})"
               for b in blocks]
    user = (
        f"STUDENT: {plan.get('program') or 'PhD student'}"
        + (f" · currently: {plan.get('current')}" if plan.get("current") else "") + "\n\n"
        f"CANDIDATE METRICS ({len(kpis)} computed from records):\n" + ("\n".join(lines_k) or "(none)") + "\n\n"
        f"CANDIDATE BLOCKS ({len(blocks)} computed from records):\n" + ("\n".join(lines_b) or "(none)") + "\n\n"
        f"DEADLINES THEY SET: {json.dumps(d['deadlines'][:6])}\n"
        f"MEETINGS ON RECORD: {json.dumps([{k: m[k] for k in ('label', 'date', 'days_ago')} for m in d['meetings'][:6]])}\n"
        f"WELLBEING: burnout {json.dumps(d['wellness'].get('burnout') or {})}; "
        f"7-day averages {json.dumps(d['wellness'].get('averages') or {})}; "
        f"streak {d['wellness'].get('streak', 0)} days\n"
        "RECENT CHECK-IN NOTES:\n"
        + ("\n".join(f"- {c.get('date')}: \"{str(c.get('note'))[:200]}\""
                     for c in (d["wellness"].get("recent") or [])[:10] if c.get("note")) or "(none)") + "\n\n"
        "DOCUMENTS:\n"
        + ("\n".join(f"- {x['name']} ({x.get('source')}; {x.get('word_count') or 0} words"
                     + (f"; topics: {', '.join(((x.get('analysis') or {}).get('topics') or [])[:5])}"
                        if (x.get("analysis") or {}).get("topics") else "") + ")"
                     for x in d["docs"][:14]) or "(empty)") + "\n\n"
        "EVERYTHING THE COACH HAS WRITTEN DOWN (chat, documents, meetings, defense practice, wellbeing):\n"
        + (d["knowledge"][:7000] or "(nothing yet)")
    )
    return system, user


def _clean_authored(raw: Any, allowed_ids: set) -> List[Dict[str, Any]]:
    """Turn the model's authored blocks into render-safe candidates."""
    out: List[Dict[str, Any]] = []
    skins = {
        "narrative": ("prose", "", 7, "Sparkles", 96),
        "wellbeing": ("callout", "watch", 5, "HeartPulse", 90),
        "win": ("callout", "win", 5, "Star", 68),
        "decision": ("prose", "", 7, "GitBranch", 75),
        "quote": ("quote", "", 5, "Quote", 78),
        "tasks": ("tasks", "", 5, "ListChecks", 88),
    }
    for item in (raw or [])[:4]:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip()
        if cid not in skins or cid in allowed_ids:
            continue
        btype, tone, span, icon, base = skins[cid]
        lead = str(item.get("lead") or "").strip()
        if not lead and btype != "tasks":
            continue
        payload: Dict[str, Any] = {
            "lead": lead[:400],
            "body": str(item.get("body") or "")[:700],
            "cta": str(item.get("cta") or "")[:40],
            "cite": str(item.get("cite") or "")[:80],
            "icon": icon,
        }
        if btype == "prose":
            paras = [str(p)[:900] for p in (item.get("paras") or [])[:2] if str(p).strip()]
            if not paras:
                continue
            payload["paras"] = paras
        if btype == "tasks":
            items = []
            for j, t in enumerate((item.get("items") or [])[:4]):
                if not isinstance(t, dict) or not str(t.get("title") or "").strip():
                    continue
                items.append({
                    "id": f"{cid}-{j}",
                    "title": str(t["title"])[:200],
                    "due": str(t.get("due") or "")[:40],
                    "source": str(t.get("source") or "")[:60],
                    "urgent": bool(t.get("urgent")),
                })
            if not items:
                continue
            payload["items"] = items
            payload["body"] = str(item.get("body") or "Pulled from your notes — you never typed these.")[:200]
        allowed_ids.add(cid)
        out.append(_block(
            cid, base, btype, str(item.get("kicker") or "")[:40] or "From your notes",
            span=span, tone=tone, title=str(item.get("title") or "")[:140],
            why=str(item.get("why") or "")[:600],
            note2="Written from your notes, then ranked against every computed block.",
            md=[f"::{ 'prose' if btype == 'prose' else btype }{{id={cid} authored=true}}"],
            evidence=[_ev("DATA", "Composed from your accumulated notes", "This visit", "sage")],
            **payload,
        ))
    return out


async def _ask_model(d: Dict[str, Any], kpis: List[Dict[str, Any]], blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    system, user = _compose_prompt(d, kpis, blocks)
    from app.llm.clients.provider_manager import create_llm_client

    llm = create_llm_client()
    raw = await llm.generate(
        system_prompt=system,
        context=[{"role": "user", "content": user}],
        temperature=0.5,
        max_tokens=2600,
        response_mime_type="application/json",
    )
    cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
    return json.loads(cleaned)


# ---------------------------------------------------------------------------
# ranking + markdown emission
# ---------------------------------------------------------------------------

def _rank(candidates: List[Dict[str, Any]], keep_ids: List[str], notes: Dict[str, str]) -> List[Dict[str, Any]]:
    """The model's picks lead; everything else falls back to the base score.

    Scores are then rewritten so they descend with the final order — the
    ::select block in insights.md is the ranking, so it has to read as one.
    """
    by_id = {c["id"]: c for c in candidates}
    picked, seen = [], set()
    for raw in (keep_ids or []):
        cid = str(raw)
        if cid in by_id and cid not in seen:
            picked.append(cid)
            seen.add(cid)
    rest = sorted((c for c in candidates if c["id"] not in seen), key=lambda c: (-c["base"], c["id"]))
    ordered = [by_id[cid] for cid in picked] + rest

    ceiling = 0.99
    for c in ordered:
        # never claim more confidence than the deterministic base supports, and
        # never rank above the candidate in front of it
        c["score"] = round(min(ceiling, max(0.05, c["base"] / 100 + (0.28 if c["id"] in seen else 0.0))), 2)
        ceiling = max(0.05, c["score"] - 0.01)
        note = notes.get(c["id"])
        if note:
            c["note"] = str(note)[:300]
    return ordered


def _render_markdown(
    d: Dict[str, Any], kpis: List[Dict[str, Any]], blocks: List[Dict[str, Any]],
    headline: str, considered: Dict[str, int],
) -> str:
    plan = d["plan"]
    lines: List[str] = [
        "# Insights",
        f"meta: {{ program: \"{plan.get('program') or 'PhD'}\",",
        f"         current: \"{plan.get('current') or '—'}\",",
        f"         documents: {len(d['docs'])}, conversations: {d['chat_count']},",
        f"         check-ins: {len(d['wellness'].get('recent') or [])} }}",
        "",
        f"::select{{keep={KEEP_KPIS}+{KEEP_BLOCKS} of={considered['kpis'] + considered['blocks']}}}",
    ]
    pad = lambda cid: (str(cid) + " " * 18)[:18]
    for i, k in enumerate(kpis[:8]):
        lines.append(f"  metric {pad(k['id'])}{k['score']:.2f}  " + ("✓" if i < KEEP_KPIS else "—"))
    if considered["kpis"] > 8:
        lines.append(f"  … {considered['kpis'] - 8} more metrics scored below the cut")
    lines.append("")
    for i, b in enumerate(blocks[:8]):
        lines.append(f"  block  {pad(b['id'])}{b['score']:.2f}  " + ("✓" if i < KEEP_BLOCKS else "—"))
    if considered["blocks"] > 8:
        lines.append(f"  … {considered['blocks'] - 8} more blocks scored below the cut")
    lines += ["", f"## {headline}", ""]
    for k in kpis[:KEEP_KPIS]:
        lines.append(f"::kpi{{id={k['id']} value=\"{k['value']}{k['suffix']}\" score={k['score']:.2f}}}")
        lines.append(f"  {k['sub']}")
    lines.append("")
    for b in blocks[:KEEP_BLOCKS]:
        lines.extend(b.get("md") or [f"::{b['type']}{{id={b['id']}}}"])
        if b.get("title"):
            lines.append(f"  {b['title']}")
        if b.get("lead"):
            lines.append(f"  {b['lead'][:120]}")
        lines.append("")
    lines.append(f"<!-- {considered['kpis'] + considered['blocks'] - KEEP_KPIS - KEEP_BLOCKS} candidates "
                 "were scored and set aside on this visit. -->")
    return "\n".join(lines)


def _public(doc: Dict[str, Any], cached: bool) -> Dict[str, Any]:
    return {
        "headline": doc.get("headline") or "",
        "kpis": doc.get("kpis") or [],
        "blocks": doc.get("blocks") or [],
        "considered": doc.get("considered") or {"kpis": 0, "blocks": 0},
        "stats": doc.get("stats") or {},
        "markdown": doc.get("markdown") or "",
        "created_at": _aware(doc.get("created_at")).isoformat() if doc.get("created_at") else _now().isoformat(),
        "cached": cached,
        # kept so an older frontend still renders something
        "sections": doc.get("sections") or [],
    }


# ---------------------------------------------------------------------------
# route
# ---------------------------------------------------------------------------

class BrainRequest(BaseModel):
    context: Dict[str, Any] = Field(default_factory=dict)
    force: bool = False


@router.post("/insights/brain")
async def insights_brain(
    body: BrainRequest, current_user: User = Depends(get_current_active_user)
):
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")
    user_id = str(current_user.id)

    cached = await db[BRAIN_COLLECTION].find_one({"user_id": user_id}, sort=[("created_at", -1)])
    if (
        cached and not body.force
        and cached.get("schema") == 2
        and (_aware(cached.get("created_at")) or _now()) >= _now() - timedelta(hours=20)
    ):
        return _public(cached, cached=True)

    d = await _gather(user_id, current_user.id, body.context or {})
    kpis = _kpi_candidates(d)
    blocks = _block_candidates(d)

    headline = ""
    notes: Dict[str, str] = {}
    keep_k: List[str] = []
    keep_b: List[str] = []
    try:
        parsed = await _ask_model(d, kpis, blocks)
        headline = str(parsed.get("headline") or "")[:200]
        notes = {str(k): str(v) for k, v in (parsed.get("notes") or {}).items() if isinstance(v, str)}
        keep_k = [str(x) for x in (parsed.get("keep_metrics") or [])][:KEEP_KPIS]
        keep_b = [str(x) for x in (parsed.get("keep_blocks") or [])][:KEEP_BLOCKS + 2]
        blocks.extend(_clean_authored(parsed.get("authored"), {b["id"] for b in blocks}))
    except Exception as exc:
        logger.warning("Insights composition failed for %s: %s", user_id, exc)

    kpis = _rank(kpis, keep_k, notes)
    blocks = _rank(blocks, keep_b, notes)

    if not headline:
        headline = (
            f"Here's where {d['plan'].get('program') or 'your PhD'} stands this week."
            if (kpis or blocks) else "Nothing to read yet — the page fills in as you use the app."
        )

    considered = {"kpis": len(kpis), "blocks": len(blocks)}
    markdown = _render_markdown(d, kpis, blocks, headline, considered)

    # Span layout: full-width blocks own their row, the rest alternate 7 / 5.
    flip = True
    for b in blocks[:KEEP_BLOCKS]:
        if b.get("span") != 12:
            b["span"] = 7 if flip else 5
            flip = not flip

    record = {
        "user_id": user_id,
        "schema": 2,
        "headline": headline,
        "kpis": kpis,
        "blocks": blocks,
        "considered": considered,
        "stats": {
            "documents": len(d["docs"]),
            "conversations": d["chat_count"],
            "checkins": len(d["wellness"].get("recent") or []),
            "events": d["heat_total"],
        },
        "markdown": markdown,
        "created_at": _now(),
    }
    await db[BRAIN_COLLECTION].insert_one(record)
    return _public(record, cached=False)
