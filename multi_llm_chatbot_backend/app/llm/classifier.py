"""LLM-backed intent classification for advisor skills."""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.advisor_skills.registry import (
    ADVISOR_SKILLS,
    DEFAULT_SKILL_ID,
    AdvisorSkill,
    get_advisor_skill,
)
from app.advisor_skills.user_skills import create_user_advisor_skill, get_effective_advisor_skills
from app.llm.clients.llm_client import LLMClient
from app.models.advisor_skills import AdvisorSkillSpecRequest

logger = logging.getLogger(__name__)
OTHER_SKILL_ID = "other"
MIN_OTHER_CONFIDENCE = 0.50
MAX_PROMPT_FIELD_CHARS = 420
MAX_DOCUMENT_CONTEXT_CHARS = 1800
DEFAULT_CLARIFICATION_QUESTION = "What specific part of your PhD work would you like help with?"
DEFAULT_CLARIFICATION_SUGGESTIONS = [
    "I need help choosing between two research methods.",
    "I want feedback on whether my research question is feasible.",
    "I am preparing for a committee or advisor conversation.",
    "I need a practical plan for my next research steps.",
]


@dataclass(frozen=True)
class SkillClassification:
    skill_id: str
    confidence: float
    reason: str
    secondary_skill_ids: List[str]
    recommended_advisors: List[str]
    requires_documents: bool
    rag_priority: str
    skill_obj: AdvisorSkill
    needs_clarification: bool = False
    clarification_reason: str = ""
    clarification_question: Optional[str] = None
    clarification_suggestions: List[str] = field(default_factory=list)

    @property
    def skill(self):
        return self.skill_obj


def _classification_for(
    skill_id: str,
    confidence: float,
    reason: str,
    skills: Optional[Dict[str, AdvisorSkill]] = None,
    secondary_skill_ids: Optional[List[str]] = None,
    needs_clarification: bool = False,
    clarification_reason: str = "",
    clarification_question: Optional[str] = None,
    clarification_suggestions: Optional[List[str]] = None,
) -> SkillClassification:
    skills = skills or ADVISOR_SKILLS
    skill = skills.get(skill_id, get_advisor_skill(DEFAULT_SKILL_ID))
    return SkillClassification(
        skill_id=skill.id,
        confidence=confidence,
        reason=reason,
        secondary_skill_ids=secondary_skill_ids or [],
        recommended_advisors=skill.preferred_advisors,
        requires_documents=skill.rag_policy.startswith("required"),
        rag_priority="high" if skill.id == "document_feedback" else "normal",
        skill_obj=skill,
        needs_clarification=needs_clarification,
        clarification_reason=clarification_reason,
        clarification_question=clarification_question,
        clarification_suggestions=clarification_suggestions or [],
    )


def _default_classification(reason: str, skills: Optional[Dict[str, AdvisorSkill]] = None) -> SkillClassification:
    return _classification_for(DEFAULT_SKILL_ID, 0.0, reason, skills)


def _log_classification_result(
    classification: SkillClassification,
    *,
    requested_skill_id: Optional[str],
    has_documents: bool,
) -> None:
    logger.info(
        "Advisor skill intent classification: skill_id=%s, skill_name=%s, "
        "confidence=%.2f, secondary_skill_ids=%s, requires_documents=%s, "
        "rag_priority=%s, needs_clarification=%s, requested_skill_id=%s, "
        "has_documents=%s, reason=%r",
        classification.skill_id,
        classification.skill.name,
        classification.confidence,
        classification.secondary_skill_ids,
        classification.requires_documents,
        classification.rag_priority,
        classification.needs_clarification,
        requested_skill_id,
        has_documents,
        classification.reason,
    )


def _clean_json(raw: str) -> str:
    cleaned = re.sub(r"```(?:json)?", "", (raw or "").strip()).strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned


def _known_advisor_ids(skills: Dict[str, AdvisorSkill]) -> List[str]:
    advisors = {
        advisor
        for skill in skills.values()
        for advisor in skill.preferred_advisors
    }
    return sorted(advisors)


def _prompt_text(value: object, *, limit: int = MAX_PROMPT_FIELD_CHARS) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _document_context_for_prompt(value: object) -> str:
    text = re.sub(r"[ \t]+", " ", str(value or "")).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) <= MAX_DOCUMENT_CONTEXT_CHARS:
        return text or "No uploaded-document details were provided to the classifier."
    return f"{text[:MAX_DOCUMENT_CONTEXT_CHARS].rstrip()}..."


def _as_bool(value: object, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "1"}:
            return True
        if normalized in {"false", "no", "0"}:
            return False
    return default


def _parse_clarification_fields(parsed: dict, *, allow_clarification: bool) -> dict:
    needs_clarification = allow_clarification and _as_bool(
        parsed.get("needs_clarification"),
        default=False,
    )
    if not needs_clarification:
        return {
            "needs_clarification": False,
            "clarification_reason": "",
            "clarification_question": None,
            "clarification_suggestions": [],
        }

    question = str(parsed.get("clarification_question") or "").strip()
    suggestions = parsed.get("clarification_suggestions") or []
    if not isinstance(suggestions, list):
        suggestions = []
    suggestions = [str(item).strip() for item in suggestions if str(item).strip()]

    return {
        "needs_clarification": True,
        "clarification_reason": str(
            parsed.get("clarification_reason")
            or parsed.get("reason")
            or "The user message needs more context before advisor routing."
        ),
        "clarification_question": question or DEFAULT_CLARIFICATION_QUESTION,
        "clarification_suggestions": (
            suggestions[:4]
            if len(suggestions) >= 2
            else DEFAULT_CLARIFICATION_SUGGESTIONS
        ),
    }


def _format_skill_for_classifier(skill: AdvisorSkill) -> str:
    """Describe what a skill actually does, not just what it is named."""
    lines = [
        f"- {skill.id} ({skill.name})",
        f"  Purpose: {_prompt_text(skill.description, limit=240)}",
        f"  Select when: {_prompt_text(skill.use_when)}",
    ]

    how_to_work = skill.how_to_work[:5]
    if how_to_work:
        lines.append(
            "  How it works: "
            + "; ".join(_prompt_text(item, limit=140) for item in how_to_work)
        )

    response_moves = skill.response_moves[:6]
    if response_moves:
        move_summaries = []
        for detail in response_moves:
            heading = _prompt_text(detail.get("heading"), limit=80)
            instruction = _prompt_text(detail.get("instruction"), limit=160)
            move_summaries.append(f"{heading}: {instruction}" if instruction else heading)
        lines.append("  Useful response moves: " + "; ".join(move_summaries))

    if skill.format_guidance:
        lines.append(f"  Format guidance: {_prompt_text(skill.format_guidance, limit=220)}")

    if skill.guardrails:
        lines.append(
            "  Guardrails: "
            + "; ".join(_prompt_text(item, limit=140) for item in skill.guardrails[:5])
        )

    if skill.rag_policy != "optional":
        lines.append(f"  Document policy: {skill.rag_policy}")

    if skill.preferred_advisors:
        lines.append(f"  Advisor fit: {', '.join(skill.preferred_advisors)}")

    return "\n".join(lines)


def _format_skills_for_classifier(skills: Dict[str, AdvisorSkill]) -> str:
    return "\n\n".join(_format_skill_for_classifier(skill) for skill in skills.values())


async def draft_advisor_skill_spec(
    llm_client: LLMClient,
    user_need: str,
    *,
    has_documents: bool = False,
    classification_reason: str = "",
    user_id: Optional[str] = None,
    skills: Optional[Dict[str, AdvisorSkill]] = None,
) -> Dict[str, object]:
    """Ask the LLM to turn a broad nontechnical need into a validated skill spec."""
    skills = skills or await get_effective_advisor_skills(user_id)
    existing_skills = _format_skills_for_classifier(skills)
    advisor_options = ", ".join(_known_advisor_ids(skills)) or "pragmatist, critic, methodologist"

    system_prompt = f"""
You design reusable Markdown-backed advisor skills for a PhD advisor panel.

The person creating this skill may not know how to write technical instructions.
Create ONE reusable advisor skill from their broad everyday-language need. The
app will turn your JSON into the actual skill document, so infer the skill name,
when to use it, and how advisors should help.

Existing skills:
{existing_skills}

Known advisor ids for preferred_advisors:
{advisor_options}

Return ONLY valid JSON with this shape:
{{
  "id": "short snake_case id without the custom_ prefix",
  "name": "Human readable skill name",
  "description": "Specific one-sentence description of what the skill produces or diagnoses.",
  "use_when": "Specific routing criteria, including how it differs from similar existing skills.",
  "how_to_work": ["3-6 concise operating rules"],
  "response_moves": [
    {{"heading": "Move label", "instruction": "Optional ingredient this skill may use"}}
  ],
  "format_guidance": "How to choose paragraphs, bullets, sections, scripts, or other forms without forcing a template.",
  "preferred_advisors": ["2-5 advisor ids from the known advisor ids"],
  "rag_policy": "optional or required_when_available",
  "token_budgets": {{"short": 650, "medium": 1000, "long": 1500}}
}}

Do not duplicate an existing skill. Make the new skill broad enough to be reused,
but narrow enough to route future similar questions reliably. Avoid generic names
and descriptions like "helps with feedback"; name the distinct work pattern.
Use response_moves as flexible ingredients, not a rigid template.
""".strip()

    context = [
        {
            "role": "user",
            "content": (
                f"User's broad need: {user_need}\n"
                f"Uploaded documents available: {has_documents}\n"
                f"Creation context: {classification_reason or 'User is manually teaching advisors a new skill.'}"
            ),
        }
    ]

    raw = await llm_client.generate(
        system_prompt=system_prompt,
        context=context,
        temperature=0.2,
        max_tokens=1400,
        response_mime_type="application/json",
    )
    parsed = json.loads(_clean_json(raw))
    return AdvisorSkillSpecRequest.model_validate(parsed).model_dump()


async def _generate_advisor_skill_for_other(
    llm_client: LLMClient,
    user_input: str,
    *,
    has_documents: bool,
    classification_reason: str,
    user_id: Optional[str],
    skills: Dict[str, AdvisorSkill],
) -> Optional[str]:
    """Ask the LLM for a structured new skill spec, install it, and return its id."""
    try:
        spec = await draft_advisor_skill_spec(
            llm_client,
            user_input,
            has_documents=has_documents,
            classification_reason=(
                "The existing skill library did not cover the latest user request well enough. "
                f"Classifier reason: {classification_reason}"
            ),
            user_id=user_id,
            skills=skills,
        )
        if user_id is None:
            logger.warning("Generated advisor skill skipped because no user_id was available")
            return None
        skill = await create_user_advisor_skill(user_id, spec)
        skills[skill.id] = skill
        logger.info(
            "Generated and installed user advisor skill: user_id=%s, skill_id=%s, name=%s",
            user_id,
            skill.id,
            skill.name,
        )
        return skill.id
    except Exception as exc:
        logger.warning("Generated advisor skill installation failed: %s", exc)
        return None


async def classify_advisor_skill(
    llm_client: Optional[LLMClient],
    user_input: str,
    *,
    has_documents: bool = False,
    document_context: str = "",
    requested_skill_id: Optional[str] = None,
    user_id: Optional[str] = None,
    allow_clarification: bool = True,
) -> SkillClassification:
    """Classify the user's message into an advisor skill using the LLM."""
    skills = await get_effective_advisor_skills(user_id)

    if requested_skill_id in skills:
        classification = _classification_for(
            requested_skill_id,
            1.0,
            "The request explicitly selected this advisor skill.",
            skills,
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification

    if llm_client is None:
        classification = _default_classification(
            "No LLM classifier is available, so the request defaulted to quick advice.",
            skills,
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification

    skill_descriptions = _format_skills_for_classifier(skills)
    skill_id_options = ", ".join(list(skills.keys()) + [OTHER_SKILL_ID])

    system_prompt = f"""
You are an intent classifier for a PhD advisor panel.

First decide whether the user's message needs clarification before any advisor
should answer. Clarification is enabled for this request: {allow_clarification}.
If clarification is not enabled, set needs_clarification to false.

A message needs clarification when it is the first user message and is too vague
for an advisor to answer usefully, such as only "help", "advice", "I am stuck",
or a broad request with no identifiable research problem, document, decision, or
academic situation. A message is clear enough when it names a concrete topic,
choice, document, method, committee issue, timeline, or research problem, even
if it is short.

If needs_clarification is true, still return valid JSON, but use quick_advice as
the skill_id and provide one concise clarification question plus 2-4 complete
sentence suggestions the user could send next.

Choose exactly one advisor skill for the user's message.
Choose "other" when the best existing skill would be an awkward or partial fit,
especially when the message reveals a reusable response pattern, specialized
workflow, genre, stance, advising mode, or evaluation frame that the current
library does not name directly.

Do not use quick_advice as a catch-all for specialized requests. Use
quick_advice only when the user's request is genuinely lightweight and generic.
Do not choose "other" for one-off facts, minor wording variations, or requests
that are already well covered by an existing skill.

Use "other" more readily when a broad existing skill matches only the surface
form of the request while missing the central recurring work pattern. In
particular, do not let committee_prep, socratic_coaching, action_plan, or
deep_review absorb specialized domains just because the user mentions a
conversation, uncertainty, a timeline, or feedback.

Available advisor skills:
{skill_descriptions}

- other: Placeholder for a new reusable advisor skill. Choose it when the
  current library lacks a named skill for the user's real work pattern.

Routing priority:
1. document_feedback when uploaded files or explicit document review are involved.
2. committee_prep for doctoral committee meetings, defenses, presentations, and advisor conversations.
3. research_design_review for research questions, methodology, theory/data fit, validity, scope, and feasibility.
4. action_plan for sequencing, prioritization, recovery, and timelines.
5. deep_review for critique, judgment, and feedback not primarily about method design.
6. socratic_coaching for uncertainty, blocked decisions, and reflective questions.
7. other for reusable specialized patterns not directly named above.
8. quick_advice for genuinely lightweight orientation and generic fallback.

Boundary rules:
- Choose other for publication workflows such as reviewer rebuttals,
  revise-and-resubmit strategy, editor-facing response letters, and peer-review
  diplomacy. These are not committee_prep.
- Choose other for authorship, credit, contribution, lab politics, escalation,
  or collaboration-negotiation questions. These are not merely
  socratic_coaching or committee_prep.
- Choose other for academic job-market materials, institutional tailoring,
  research/teaching/diversity statements, cover letters, and interview packets
  unless the user only asks for a simple schedule.
- Choose other for audience translation, funder pitches, public-facing impact
  framing, and adapting scholarly work for non-academic audiences.
- Choose other for navigating conflicting faculty advice, departmental politics,
  power dynamics, or triangulation between advisors unless the user only asks
  for a narrow meeting script.
- Keep existing skills when the named skill directly describes the work:
  document_feedback for uploaded or pasted drafts, research_design_review for
  method/design fit, committee_prep for defenses and committee meetings,
  action_plan for execution timelines, deep_review for critique of content, and
  quick_advice for small generic orientation questions.

Examples:
- "Reviewer 2 says my baseline comparison is unfair. How should I reply?"
  -> other, because peer-review rebuttal is a reusable publication workflow.
- "My co-author wants first authorship even though I did most experiments."
  -> other, because authorship-credit negotiation is a reusable domain.
- "How do I tailor my research statement for an R1 vs. a SLAC?"
  -> other, because job-market document tailoring is a reusable genre.
- "Pitch my dissertation to a private foundation without sounding academic."
  -> other, because audience translation/funder framing is a reusable pattern.
- "My advisor and committee chair disagree and I am caught in the middle."
  -> other, because faculty-politics navigation is a reusable advising mode.

Respond ONLY with valid JSON:
{{
  "needs_clarification": false,
  "clarification_reason": "one sentence when clarification is needed, otherwise empty",
  "clarification_question": "one short question when clarification is needed, otherwise empty",
  "clarification_suggestions": ["2-4 complete next-message suggestions when clarification is needed"],
  "skill_id": "one of: {skill_id_options}",
  "confidence": 0.0,
  "reason": "one sentence",
  "secondary_skill_ids": ["optional alternate skill ids"]
}}
""".strip()

    context = [
        {
            "role": "user",
            "content": (
                f"User message: {user_input}\n"
                f"Uploaded documents available: {has_documents}\n"
                "Uploaded-document context for routing:\n"
                f"{_document_context_for_prompt(document_context)}"
            ),
        }
    ]

    try:
        raw = await llm_client.generate(
            system_prompt=system_prompt,
            context=context,
            temperature=0.0,
            max_tokens=512,
            response_mime_type="application/json",
        )
        parsed = json.loads(_clean_json(raw))
        clarification = _parse_clarification_fields(
            parsed,
            allow_clarification=allow_clarification,
        )
        if clarification["needs_clarification"]:
            classification = _classification_for(
                DEFAULT_SKILL_ID,
                0.0,
                clarification["clarification_reason"],
                skills,
                needs_clarification=True,
                clarification_reason=clarification["clarification_reason"],
                clarification_question=clarification["clarification_question"],
                clarification_suggestions=clarification["clarification_suggestions"],
            )
            _log_classification_result(
                classification,
                requested_skill_id=requested_skill_id,
                has_documents=has_documents,
            )
            return classification

        skill_id = parsed.get("skill_id")
        confidence = max(0.0, min(float(parsed.get("confidence", 0.75)), 1.0))
        reason = str(parsed.get("reason", "Classified by LLM intent router."))

        if skill_id == OTHER_SKILL_ID:
            if confidence < MIN_OTHER_CONFIDENCE:
                classification = _default_classification(
                    "The classifier selected other with low confidence, so the request defaulted to quick advice.",
                    skills,
                )
                _log_classification_result(
                    classification,
                    requested_skill_id=requested_skill_id,
                    has_documents=has_documents,
                )
                return classification

            generated_skill_id = await _generate_advisor_skill_for_other(
                llm_client,
                user_input,
                has_documents=has_documents,
                classification_reason=reason,
                user_id=user_id,
                skills=skills,
            )
            if generated_skill_id in skills:
                classification = _classification_for(
                    generated_skill_id,
                    confidence,
                    f"{reason} Generated a new advisor skill for this recurring pattern.",
                    skills,
                )
                _log_classification_result(
                    classification,
                    requested_skill_id=requested_skill_id,
                    has_documents=has_documents,
                )
                return classification

            classification = _default_classification(
                "The classifier selected other, but generated skill installation failed.",
                skills,
            )
            _log_classification_result(
                classification,
                requested_skill_id=requested_skill_id,
                has_documents=has_documents,
            )
            return classification

        if skill_id not in skills:
            raise ValueError(f"Unknown skill_id: {skill_id!r}")

        secondary = [
            sid for sid in parsed.get("secondary_skill_ids", [])
            if sid in skills and sid != skill_id
        ]
        classification = _classification_for(
            skill_id,
            confidence,
            reason,
            skills,
            secondary,
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification
    except Exception as exc:
        logger.warning("Advisor skill classification failed, defaulting to quick_advice: %s", exc)
        classification = _default_classification(
            "The LLM classifier failed, so the request defaulted to quick advice.",
            skills,
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification
