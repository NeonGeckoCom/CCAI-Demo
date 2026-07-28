"""Template-grounded PhD plan building and retrofitting.

The base template (app/data/phd_base_template.json) encodes what ~5 years of a
PhD looks like: main sections 1..20, one per 3-month quarter, each with ~week
sized subs (1a, 1b...). Endpoints:

  GET  /plan/base-template          the raw template
  POST /plan/generate               handbook text + student profile → tailored plan
  POST /plan/retrofit               current plan + "what changed" → updated plan

Both LLM endpoints return the SAME shape the spreadsheet Plan page edits:
  { sections: [{code, title, phase, months, gate, objective,
                subs: [{id, title, days, notes, gate}]}],
    removed: [...], changes: [...], summary: "..." }
"""
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_active_user
from app.core.bootstrap import chat_orchestrator
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

_TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "data" / "phd_base_template.json"
_template_cache: Optional[Dict[str, Any]] = None

PROFILE_TOKENS = ("masters_entry", "coursework_done", "post_quals", "post_candidacy", "post_proposal")


def load_base_template() -> Dict[str, Any]:
    global _template_cache
    if _template_cache is None:
        try:
            _template_cache = json.loads(_TEMPLATE_PATH.read_text())
        except (OSError, json.JSONDecodeError) as e:
            logger.error("Could not load base template: %s", e)
            _template_cache = {"sections": [], "skip_profiles": {}, "field_notes": []}
    return _template_cache


def _llm_client():
    client = getattr(chat_orchestrator, "llm_client", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No AI provider is configured on this server.",
        )
    return client


def _parse_plan_json(raw: str) -> Dict[str, Any]:
    import re
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise HTTPException(status_code=502, detail="The AI returned an unreadable plan.")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="The AI returned an unreadable plan.")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("sections"), list):
        raise HTTPException(status_code=502, detail="The AI plan was missing its sections.")
    return _normalize_plan(parsed)


def _normalize_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    sections = []
    for i, sec in enumerate(plan.get("sections", [])):
        if not isinstance(sec, dict) or not (sec.get("title") or "").strip():
            continue
        code = sec.get("code") or (i + 1)
        subs = []
        for j, sub in enumerate(sec.get("subs", []) or []):
            if not isinstance(sub, dict) or not (sub.get("title") or "").strip():
                continue
            subs.append({
                "id": str(sub.get("id") or f"{code}{chr(97 + (j % 26))}"),
                "title": str(sub.get("title", "")).strip()[:300],
                "days": str(sub.get("days", "")).strip()[:20],
                "notes": str(sub.get("notes", "") or sub.get("description", "")).strip()[:500],
                "gate": bool(sub.get("gate")),
            })
        sections.append({
            "code": int(code) if str(code).isdigit() else (i + 1),
            "title": str(sec.get("title", "")).strip()[:200],
            "phase": str(sec.get("phase", "")).strip()[:60],
            "months": str(sec.get("months", "")).strip()[:20],
            "gate": bool(sec.get("gate")),
            "objective": str(sec.get("objective", "")).strip()[:400],
            "subs": subs,
        })
    return {
        "sections": sections,
        "removed": [str(x)[:200] for x in (plan.get("removed") or [])][:40],
        "changes": [str(x)[:300] for x in (plan.get("changes") or [])][:40],
        "summary": str(plan.get("summary", ""))[:1000],
    }


def _compact_template() -> str:
    """The template, compacted for prompt injection."""
    t = load_base_template()
    lines = []
    for sec in t.get("sections", []):
        gate = " [GATE]" if sec.get("gate") else ""
        lines.append(f"{sec['num']}. {sec['title']} (months {sec.get('months','?')}, phase {sec.get('phase','')}){gate}")
        for sub in sec.get("subs", []):
            skip = f" skip_if={','.join(sub['skip_if'])}" if sub.get("skip_if") else ""
            fv = f" variants: {sub['field_variants']}" if sub.get("field_variants") else ""
            g = " [GATE]" if sub.get("gate") else ""
            lines.append(f"  {sub['id']}. {sub['title']} (~{sub.get('days','1w')}){g}{skip}{fv}")
    notes = "; ".join(t.get("field_notes", [])[:15])
    return "\n".join(lines) + ("\nFIELD NOTES: " + notes if notes else "")


class PlanProfile(BaseModel):
    tokens: List[str] = Field(default_factory=list)   # PROFILE_TOKENS subset
    entry_note: str = ""                              # freeform ("2nd year, passed quals in May")
    field: str = ""                                   # e.g. "Information Science"


class GenerateRequest(BaseModel):
    handbook_text: str = ""
    program: str = ""
    institution: str = ""
    profile: PlanProfile = Field(default_factory=PlanProfile)


class RetrofitRequest(BaseModel):
    plan: Dict[str, Any] = Field(default_factory=dict)   # {sections: [...]} current plan
    change: str = ""                                     # what happened / what to change
    profile: PlanProfile = Field(default_factory=PlanProfile)


@router.get("/plan/base-template")
async def get_base_template(current_user: User = Depends(get_current_active_user)):
    return load_base_template()


GENERATE_SYSTEM_PROMPT = """You build a PhD student's full multi-year plan.

You are given (1) the BASE TEMPLATE of a typical 5-year US PhD — main sections are
~3-month quarters numbered 1,2,3...; subs are ~1-week units (2 days-3 weeks) with ids
like 1a, 1b — and (2) the student's OWN program handbook text plus their profile.

Produce THEIR plan:
- START from the base template's structure and pacing. Keep the numbering scheme.
- OVERRIDE with everything the handbook actually says: real milestone names, real
  timing, real forms/exams/credit requirements. Handbook beats template everywhere
  they conflict. Fold handbook-specific requirements in as extra subs where they belong.
- APPLY the profile: remove subs/sections covered by the student's skip tokens
  (masters_entry, coursework_done, post_quals, post_candidacy, post_proposal) and
  their entry note. Renumber cleanly (1,2,3... / 1a,1b...) after removal so the plan
  starts from where the student actually is.
- Respect field variants for their field.
- Every sub must stay a concrete ~2-day-to-3-week checkable action.
Return ONLY valid JSON:
{"sections":[{"code":1,"title":"...","phase":"...","months":"1-3","gate":false,
  "objective":"...","subs":[{"id":"1a","title":"...","days":"1w","notes":"...","gate":false}]}],
 "removed":["what was dropped and why (short)"],
 "summary":"2 sentences on how this plan was tailored"}"""


@router.post("/plan/generate")
async def generate_plan(body: GenerateRequest,
                        current_user: User = Depends(get_current_active_user)):
    client = _llm_client()
    tokens = [t for t in body.profile.tokens if t in PROFILE_TOKENS]
    user_prompt = (
        f"BASE TEMPLATE:\n{_compact_template()}\n\n"
        f"STUDENT: {body.program or 'PhD'} at {body.institution or 'their university'}; "
        f"field: {body.profile.field or 'unspecified'}\n"
        f"Skip tokens: {', '.join(tokens) or '(none — treat as fresh from undergrad)'}\n"
        f"Entry note: {body.profile.entry_note or '(none)'}\n\n"
        f"THEIR HANDBOOK TEXT:\n{(body.handbook_text or '(no handbook provided — use the template, tailored to the field)')[:80_000]}\n\n"
        "Build their plan. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=GENERATE_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=8192,
        response_mime_type="application/json",
    )
    plan = _parse_plan_json(raw)
    if not plan["sections"]:
        raise HTTPException(status_code=502, detail="The AI produced an empty plan — try again.")
    return plan


class ImportRequest(BaseModel):
    csv_text: str = ""
    profile: PlanProfile = Field(default_factory=PlanProfile)


IMPORT_SYSTEM_PROMPT = """A PhD student tracked their plan in their own spreadsheet (any
column layout, any naming). You get its raw CSV text. Restructure it into the canonical
plan format, using the BASE TEMPLATE as the standard for how PhD work is categorized:
- Main sections = ~3-month quarters (code 1,2,3...). Group their rows into the template's
  phases (coursework, quals, proposal, data, writing, defense...) in chronological order.
- Subs = their actual rows (ids 1a, 1b...), kept close to their original wording. Split
  anything bigger than ~3 weeks; merge trivial fragments.
- Map their status column onto todo/doing/done/skip (done/complete/x/✓ → done;
  in progress/wip → doing; n/a/skipped/cancelled → skip; else todo).
- Carry dates/durations into days, and any comment column into notes.
- Do NOT invent work they didn't list, except section titles/objectives to organize theirs.
Return ONLY valid JSON:
{"sections":[{"code":1,"title":"...","phase":"...","months":"","gate":false,"objective":"",
  "subs":[{"id":"1a","title":"...","days":"","notes":"","gate":false,"status":"todo"}]}],
 "summary":"1-2 sentences on how their spreadsheet was reorganized"}"""


@router.post("/plan/import")
async def import_plan(body: ImportRequest,
                      current_user: User = Depends(get_current_active_user)):
    if not (body.csv_text or "").strip():
        raise HTTPException(status_code=400, detail="The spreadsheet was empty.")
    client = _llm_client()
    user_prompt = (
        f"BASE TEMPLATE (the categorization standard):\n{_compact_template()[:12_000]}\n\n"
        f"Student profile tokens: {', '.join(body.profile.tokens) or '(none)'}\n\n"
        f"THEIR SPREADSHEET (raw CSV):\n{body.csv_text[:60_000]}\n\n"
        "Restructure it. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=IMPORT_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=8192,
        response_mime_type="application/json",
    )
    plan = _parse_plan_json(raw)
    if not plan["sections"]:
        raise HTTPException(status_code=502, detail="The AI couldn't find plan rows in that spreadsheet.")
    return plan


class WalkthroughRequest(BaseModel):
    title: str
    section: str = ""
    objective: str = ""
    notes: str = ""
    days: str = ""
    program: str = ""
    field: str = ""


WALKTHROUGH_SYSTEM_PROMPT = """You write a practical walkthrough for ONE step of a PhD
student's plan. The step is ~2 days to 3 weeks of work. Break it into 4-7 concrete
mini-actions (each 30 minutes to a day, starting with a verb, specific enough to start
immediately — name the artifact to produce, who to email, what to search). Assume the
student has never done this before.
If background knowledge from the student's uploaded documents (handbook, advisor
emails, notes) is provided, GROUND the walkthrough in it: use their program's actual
requirements, form names, deadlines, and people. When a mini-action draws on a specific
uploaded source or requirement, name it briefly in that step's "source" field (e.g.
"Handbook §4.2 — comps format"); leave "source" empty for general-knowledge steps.
Never invent sources.
Return ONLY valid JSON:
{"overview": "2 sentences: what this step really is and why it matters",
 "steps": [{"title": "short action", "detail": "1-2 sentences of concrete how", "source": "where in their materials this comes from, or empty"}],
 "done_when": ["observable completion criteria, 2-4 items"],
 "pitfalls": ["the 2-4 mistakes students actually make here"]}"""


@router.post("/plan/walkthrough")
async def plan_walkthrough(body: WalkthroughRequest,
                           current_user: User = Depends(get_current_active_user)):
    if not (body.title or "").strip():
        raise HTTPException(status_code=400, detail="A step title is required.")
    client = _llm_client()
    # Ground the walkthrough in what the student actually uploaded (handbook,
    # advisor emails, notes) so the steps reflect THEIR program, not a generic one.
    from app.core.library import get_knowledge_context_block
    knowledge = await get_knowledge_context_block(str(current_user.id))
    user_prompt = (
        f"Program: {body.program or 'PhD program'} ({body.field or 'field unspecified'})\n"
        f"Plan section: {body.section or 'unspecified'} — {body.objective or ''}\n"
        f"Step to walk through: {body.title}\n"
        f"Expected time: {body.days or '~1 week'}\n"
        f"Student's own notes on it: {body.notes or '(none)'}\n"
        + (f"\n{knowledge}\n" if knowledge else "")
        + "\nWrite the walkthrough. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=WALKTHROUGH_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.3,
        max_tokens=1536,
        response_mime_type="application/json",
    )
    import re
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="The AI returned an unreadable walkthrough.")
    steps = []
    for st in (parsed.get("steps") or [])[:8]:
        if isinstance(st, dict) and (st.get("title") or "").strip():
            steps.append({"title": str(st.get("title", "")).strip()[:200],
                          "detail": str(st.get("detail", "")).strip()[:500],
                          "source": str(st.get("source", "") or "").strip()[:200]})
    return {
        "overview": str(parsed.get("overview", ""))[:800],
        "steps": steps,
        "done_when": [str(x).strip()[:250] for x in (parsed.get("done_when") or []) if str(x).strip()][:5],
        "pitfalls": [str(x).strip()[:250] for x in (parsed.get("pitfalls") or []) if str(x).strip()][:5],
    }


RETROFIT_SYSTEM_PROMPT = """You retrofit a PhD student's existing plan after something changed.
You get their CURRENT plan (sections/subs, including per-sub status: done/skip markers in
notes or a status field) and a description of what changed (new advisor guidance, a setback,
a timeline shift, switching to a 3-paper format, a new requirement, "I already did X"...).

Rules:
- MINIMAL EDITS. Keep everything that still applies, byte-identical where possible —
  especially sub ids and titles the student may have marked done.
- Never delete work marked done; if it's now irrelevant, keep it but note it.
- Add/remove/re-order/re-time only what the change requires. Renumber cleanly afterwards.
- Keep subs ~2 days-3 weeks each; split anything the change makes bigger than that.
Return ONLY valid JSON:
{"sections":[...same shape as input...],
 "changes":["each concrete edit you made, one short line each"],
 "summary":"1-2 sentences: what changed and why the plan still gets them to done"}"""


@router.post("/plan/retrofit")
async def retrofit_plan(body: RetrofitRequest,
                        current_user: User = Depends(get_current_active_user)):
    if not (body.change or "").strip():
        raise HTTPException(status_code=400, detail="Describe what changed first.")
    if not (body.plan or {}).get("sections"):
        raise HTTPException(status_code=400, detail="No current plan was provided.")
    client = _llm_client()
    user_prompt = (
        f"CURRENT PLAN:\n{json.dumps(body.plan)[:80_000]}\n\n"
        f"Student profile tokens: {', '.join(body.profile.tokens) or '(none)'}; "
        f"note: {body.profile.entry_note or '(none)'}\n\n"
        f"WHAT CHANGED:\n{body.change[:4000]}\n\n"
        f"(For reference, the canonical base template:\n{_compact_template()[:8000]})\n\n"
        "Retrofit the plan. Return ONLY the JSON object."
    )
    raw = await client.generate(
        system_prompt=RETROFIT_SYSTEM_PROMPT,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=8192,
        response_mime_type="application/json",
    )
    plan = _parse_plan_json(raw)
    if not plan["sections"]:
        raise HTTPException(status_code=502, detail="The AI produced an empty retrofit — try again.")
    return plan
