"""LLM-backed intent classification for advisor skills."""

import json
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

from app.advisor_skills.registry import (
    ADVISOR_SKILLS,
    DEFAULT_SKILL_ID,
    get_advisor_skill,
    install_generated_advisor_skill,
)
from app.llm.clients.llm_client import LLMClient

logger = logging.getLogger(__name__)
OTHER_SKILL_ID = "other"
MIN_OTHER_CONFIDENCE = 0.50


@dataclass(frozen=True)
class SkillClassification:
    skill_id: str
    confidence: float
    reason: str
    secondary_skill_ids: List[str]
    recommended_advisors: List[str]
    requires_documents: bool
    rag_priority: str

    @property
    def skill(self):
        return get_advisor_skill(self.skill_id)


def _classification_for(
    skill_id: str,
    confidence: float,
    reason: str,
    secondary_skill_ids: Optional[List[str]] = None,
) -> SkillClassification:
    skill = get_advisor_skill(skill_id)
    return SkillClassification(
        skill_id=skill.id,
        confidence=confidence,
        reason=reason,
        secondary_skill_ids=secondary_skill_ids or [],
        recommended_advisors=skill.preferred_advisors,
        requires_documents=skill.rag_policy.startswith("required"),
        rag_priority="high" if skill.id == "document_feedback" else "normal",
    )


def _default_classification(reason: str) -> SkillClassification:
    return _classification_for(DEFAULT_SKILL_ID, 0.0, reason)


def _log_classification_result(
    classification: SkillClassification,
    *,
    requested_skill_id: Optional[str],
    has_documents: bool,
) -> None:
    logger.info(
        "Advisor skill intent classification: skill_id=%s, skill_name=%s, "
        "confidence=%.2f, secondary_skill_ids=%s, requires_documents=%s, "
        "rag_priority=%s, requested_skill_id=%s, has_documents=%s, reason=%r",
        classification.skill_id,
        classification.skill.name,
        classification.confidence,
        classification.secondary_skill_ids,
        classification.requires_documents,
        classification.rag_priority,
        requested_skill_id,
        has_documents,
        classification.reason,
    )


def _clean_json(raw: str) -> str:
    cleaned = re.sub(r"```(?:json)?", "", (raw or "").strip()).strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    return match.group(0) if match else cleaned


def _known_advisor_ids() -> List[str]:
    advisors = {
        advisor
        for skill in ADVISOR_SKILLS.values()
        for advisor in skill.preferred_advisors
    }
    return sorted(advisors)


async def _generate_advisor_skill_for_other(
    llm_client: LLMClient,
    user_input: str,
    *,
    has_documents: bool,
    classification_reason: str,
) -> Optional[str]:
    """Ask the LLM for a structured new skill spec, install it, and return its id."""
    existing_skills = "\n".join(
        f"- {skill.id}: {skill.description} Use when: {skill.use_when}"
        for skill in ADVISOR_SKILLS.values()
    )
    advisor_options = ", ".join(_known_advisor_ids()) or "pragmatist, critic, methodologist"

    system_prompt = f"""
You design reusable Markdown-backed advisor skills for a PhD advisor panel.

The existing skill library did not cover the latest user request well enough.
Create ONE reusable advisor skill for this recurring request pattern.

Existing skills:
{existing_skills}

Known advisor ids for preferred_advisors:
{advisor_options}

Return ONLY valid JSON with this shape:
{{
  "id": "short snake_case id without the custom_ prefix",
  "name": "Human readable skill name",
  "description": "One sentence describing the reusable response pattern.",
  "use_when": "When this skill should be selected instead of existing skills.",
  "how_to_work": ["3-6 concise operating rules"],
  "headings": [
    {{"heading": "Section heading", "instruction": "What this section should contain"}}
  ],
  "preferred_advisors": ["2-5 advisor ids from the known advisor ids"],
  "rag_policy": "optional or required_when_available",
  "token_budgets": {{"short": 650, "medium": 1000, "long": 1500}}
}}

Do not duplicate an existing skill. Make the new skill broad enough to be reused,
but narrow enough to route future similar questions reliably.
""".strip()

    context = [
        {
            "role": "user",
            "content": (
                f"User message that triggered Other: {user_input}\n"
                f"Uploaded documents available: {has_documents}\n"
                f"Classifier reason: {classification_reason}"
            ),
        }
    ]

    try:
        raw = await llm_client.generate(
            system_prompt=system_prompt,
            context=context,
            temperature=0.2,
            max_tokens=1400,
            response_mime_type="application/json",
        )
        spec = json.loads(_clean_json(raw))
        skill = install_generated_advisor_skill(spec)
        logger.info(
            "Generated and installed advisor skill: skill_id=%s, name=%s, source=%s",
            skill.id,
            skill.name,
            skill.source_path,
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
    requested_skill_id: Optional[str] = None,
) -> SkillClassification:
    """Classify the user's message into an advisor skill using the LLM."""
    if requested_skill_id in ADVISOR_SKILLS:
        classification = _classification_for(
            requested_skill_id,
            1.0,
            "The request explicitly selected this advisor skill.",
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification

    if llm_client is None:
        classification = _default_classification(
            "No LLM classifier is available, so the request defaulted to quick advice."
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification

    skill_descriptions = "\n".join(
        f"- {skill.id}: {skill.description} Use when: {skill.use_when}"
        for skill in ADVISOR_SKILLS.values()
    )
    skill_id_options = ", ".join(list(ADVISOR_SKILLS.keys()) + [OTHER_SKILL_ID])

    system_prompt = f"""
You are an intent classifier for a PhD advisor panel.

Choose exactly one advisor skill for the user's message.
Choose "other" when the best existing skill would be an awkward or partial fit,
especially when the message reveals a reusable response pattern, specialized
workflow, genre, stance, advising mode, or evaluation frame that the current
library does not name directly.

Do not use quick_advice as a catch-all for specialized requests. Use
quick_advice only when the user's request is genuinely lightweight and generic.
Do not choose "other" for one-off facts, minor wording variations, or requests
that are already well covered by an existing skill.

Available advisor skills:
{skill_descriptions}

- other: Placeholder for a new reusable advisor skill. Choose it when the
  current library lacks a named skill for the user's real work pattern.

Routing priority:
1. document_feedback when uploaded files or explicit document review are involved.
2. committee_prep for meetings, defenses, presentations, and advisor conversations.
3. research_design_review for research questions, methodology, theory/data fit, validity, scope, and feasibility.
4. action_plan for sequencing, prioritization, recovery, and timelines.
5. deep_review for critique, judgment, and feedback not primarily about method design.
6. socratic_coaching for uncertainty, blocked decisions, and reflective questions.
7. other for reusable specialized patterns not directly named above.
8. quick_advice for genuinely lightweight orientation and generic fallback.

Respond ONLY with valid JSON:
{{
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
                f"Uploaded documents available: {has_documents}"
            ),
        }
    ]

    try:
        raw = await llm_client.generate(
            system_prompt=system_prompt,
            context=context,
            temperature=0.0,
            max_tokens=256,
            response_mime_type="application/json",
        )
        parsed = json.loads(_clean_json(raw))
        skill_id = parsed.get("skill_id")
        confidence = max(0.0, min(float(parsed.get("confidence", 0.75)), 1.0))
        reason = str(parsed.get("reason", "Classified by LLM intent router."))

        if skill_id == OTHER_SKILL_ID:
            if confidence < MIN_OTHER_CONFIDENCE:
                classification = _default_classification(
                    "The classifier selected other with low confidence, so the request defaulted to quick advice."
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
            )
            if generated_skill_id in ADVISOR_SKILLS:
                classification = _classification_for(
                    generated_skill_id,
                    confidence,
                    f"{reason} Generated a new advisor skill for this recurring pattern.",
                )
                _log_classification_result(
                    classification,
                    requested_skill_id=requested_skill_id,
                    has_documents=has_documents,
                )
                return classification

            classification = _default_classification(
                "The classifier selected other, but generated skill installation failed."
            )
            _log_classification_result(
                classification,
                requested_skill_id=requested_skill_id,
                has_documents=has_documents,
            )
            return classification

        if skill_id not in ADVISOR_SKILLS:
            raise ValueError(f"Unknown skill_id: {skill_id!r}")

        secondary = [
            sid for sid in parsed.get("secondary_skill_ids", [])
            if sid in ADVISOR_SKILLS and sid != skill_id
        ]
        classification = _classification_for(
            skill_id,
            confidence,
            reason,
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
            "The LLM classifier failed, so the request defaulted to quick advice."
        )
        _log_classification_result(
            classification,
            requested_skill_id=requested_skill_id,
            has_documents=has_documents,
        )
        return classification
