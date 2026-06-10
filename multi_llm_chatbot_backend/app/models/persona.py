import logging
from typing import Dict, List

from app.advisor_skills import DEFAULT_SKILL_ID, AdvisorSkill, get_advisor_skill
from app.llm.clients.llm_client import LLMClient

SENTINEL = "</END>"
logger = logging.getLogger(__name__)
MAX_RETRY_TOKENS = 3200

def _cut_at_sentinel(text: str) -> str:
    if not text:
        return ""
    idx = text.find(SENTINEL)
    return text[:idx] if idx != -1 else text

def _normalize_eols(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")

def _rstrip_lines(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.split("\n"))

def _convert_bold_headers_to_atx(lines: List[str]) -> List[str]:
    out = []
    for l in lines:
        # Full-line **Heading** or **Heading**: becomes '### Heading'
        # We keep only if the entire line is bold (plus optional colon) with no other text.
        import re
        m = re.match(r"^\s*\*\*(.+?)\*\*\s*:?\s*$", l)
        if m:
            out.append(f"### {m.group(1).strip()}")
        else:
            out.append(l)
    return out

def _convert_unicode_bullets(lines: List[str]) -> List[str]:
    out = []
    import re
    for l in lines:
        out.append(re.sub(r"^\s*[•●▪◦]\s+", "- ", l))
    return out

def _merge_orphan_numbered_items(lines: List[str]) -> List[str]:
    out = []
    i = 0
    import re
    while i < len(lines):
        cur = lines[i]
        m = re.match(r"^\s*(\d+)\.\s*$", cur)
        if m:
            # find next non-empty line and merge
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            if j < len(lines):
                out.append(f"{m.group(1)}. {lines[j].strip()}")
                i = j + 1
                continue
        out.append(cur)
        i += 1
    return out

def _collapse_blank_runs(text: str) -> str:
    import re
    return re.sub(r"\n{3,}", "\n\n", text).strip()

def _truncate_words(s: str, limit: int) -> str:
    words = s.strip().split()
    if len(words) <= limit:
        return s.strip()
    return " ".join(words[:limit]) + "..."

def _normalize_skill_markdown(text: str, advisor_skill: AdvisorSkill) -> str:
    """Normalize model Markdown without forcing every skill into one shape."""
    import re

    t = _cut_at_sentinel(_rstrip_lines(_normalize_eols(text)))
    lines = t.split("\n")
    lines = _convert_bold_headers_to_atx(lines)
    lines = _convert_unicode_bullets(lines)
    lines = _merge_orphan_numbered_items(lines)
    t = _collapse_blank_runs("\n".join(lines))

    # Backward-compatibility repair if an older prompt still leaks into a
    # quick-advice response.
    if advisor_skill.id == DEFAULT_SKILL_ID:
        replacements = {
            r"^###\s*Thought\s*$": "### Short answer",
            r"^###\s*What to do\s*$": "### Do next",
            r"^###\s*Next step\s*$": "### Do next",
        }
        repaired = []
        for line in t.split("\n"):
            fixed = line
            for pattern, replacement in replacements.items():
                fixed = re.sub(pattern, replacement, fixed, flags=re.IGNORECASE)
            repaired.append(fixed)
        t = _collapse_blank_runs("\n".join(repaired))

    skill_headings = advisor_skill.headings
    expected = {heading.lower() for heading in skill_headings}
    present = set()
    for line in t.split("\n"):
        match = re.match(r"^\s*###\s+(.+?)\s*$", line)
        if match:
            present.add(match.group(1).strip().lower())

    # If the model ignored all headings, preserve its content but frame it
    # under the first expected skill heading so the UI remains readable.
    if t and expected and not (present & expected):
        t = f"### {skill_headings[0]}\n{t}"

    return t.strip()

def _has_sentinel(text: str) -> bool:
    return bool(text and SENTINEL in text)

def _retry_max_tokens(max_tokens: int) -> int:
    return min(MAX_RETRY_TOKENS, max(max_tokens + 700, int(max_tokens * 1.75)))

def _compact_retry_instruction(sentinel: str) -> str:
    return f"""
The previous answer did not finish with {sentinel}, so regenerate the full answer from scratch.

Recovery rules:
- Do not mention the previous attempt or the retry.
- Preserve the advisor skill's requested headings.
- Keep prose sections to one short paragraph.
- Keep list sections to no more than three items.
- Prioritize a complete answer over nuance or detail.
- Finish your response with the sentinel token {sentinel}.
""".strip()

class Persona:
    def __init__(self, id: str, name: str, system_prompt: str, llm: LLMClient, temperature: int = 5):
        self.id = id
        self.name = name
        self.system_prompt = system_prompt
        self.llm = llm
        self.temperature = temperature

    async def respond(
        self,
        context: List[Dict],
        response_length: str = "medium",
        advisor_skill=None,
    ) -> str:
        """Generate a skill-shaped Markdown response suitable for the UI."""
        if isinstance(advisor_skill, AdvisorSkill):
            skill = advisor_skill
        else:
            skill = get_advisor_skill(advisor_skill or DEFAULT_SKILL_ID)

        max_tokens = skill.max_tokens(response_length)
        temp_scaled = round(self.temperature / 10, 2)

        full_prompt = (
            f"{self.system_prompt}\n\n"
            f"{skill.prompt_contract(response_length, SENTINEL)}"
        )

        raw_text = await self.llm.generate(
            system_prompt=full_prompt,
            context=context,
            temperature=temp_scaled,
            max_tokens=max_tokens,
        )

        if raw_text and not _has_sentinel(raw_text):
            logger.warning(
                "Advisor response missing sentinel; it may be incomplete "
                "(persona=%s, skill=%s, response_length=%s, max_tokens=%s, chars=%s)",
                self.id,
                skill.id,
                response_length,
                max_tokens,
                len(raw_text),
            )
            retry_tokens = _retry_max_tokens(max_tokens)
            retry_text = await self.llm.generate(
                system_prompt=f"{full_prompt}\n\n{_compact_retry_instruction(SENTINEL)}",
                context=context,
                temperature=temp_scaled,
                max_tokens=retry_tokens,
            )
            if _has_sentinel(retry_text):
                logger.info(
                    "Recovered incomplete advisor response with compact retry "
                    "(persona=%s, skill=%s, retry_tokens=%s)",
                    self.id,
                    skill.id,
                    retry_tokens,
                )
                raw_text = retry_text
            else:
                logger.warning(
                    "Advisor compact retry still missing sentinel "
                    "(persona=%s, skill=%s, retry_tokens=%s, chars=%s)",
                    self.id,
                    skill.id,
                    retry_tokens,
                    len(retry_text or ""),
                )
                if retry_text and len(retry_text) > len(raw_text):
                    raw_text = retry_text

        compact = _normalize_skill_markdown(raw_text or "", skill)

        # Final safety: cap extreme length by trimming bullet lines further if necessary
        # (We keep this conservative to avoid changing behavior unnecessarily)
        if len(compact) > 6000:
            compact = _truncate_words(compact, 900)

        return compact
