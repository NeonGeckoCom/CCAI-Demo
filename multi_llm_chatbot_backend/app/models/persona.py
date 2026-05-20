from app.llm.llm_client import LLMClient
from typing import List, Dict

SENTINEL = "</END>"

# Shared compact formatting contract applied to all personas.
COMPACT_MARKDOWN_V1 = (
    "You must format your answer using GitHub-Flavored Markdown and exactly these three sections in this order:\n"
    "### Thought\n"
    "- One sentence only.\n"
    "\n"
    "### What to do\n"
    "- Exactly 3 bullet points, one line each. Use '-' as the bullet. Do not use unicode bullets.\n"
    "- If you would use an ordered list, keep text on the same line as the number (e.g., '1. Do X').\n"
    "\n"
    "### Next step\n"
    "- One imperative sentence only.\n"
    "\n"
    "Rules: Use '###' for headings (never bold-as-heading). Insert a blank line between blocks. "
    "Do not include tables or code blocks unless explicitly requested. "
    "Do not include preambles or conclusions outside the three sections. "
    f"Finish your response with the sentinel token {SENTINEL}."
)

# Soft structure guidance per response_length
STRUCTURE_HINTS = {
    "short": "Keep it very concise: Thought as one short sentence; bullets ≤ 12 words; next step one short sentence.",
    "medium": "Be concise but clear: Thought one sentence; bullets ≤ 18 words; next step one sentence.",
    "long": "Provide slightly more detail while staying compact: Thought one sentence; bullets ≤ 24 words; next step one sentence.",
}

# Conservative token ceilings (kept close to prior behavior to avoid breaking changes)
MAX_TOKENS_MAP = {
    "short": 300,
    "medium": 500,
    "long": 800,
}

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
    return " ".join(words[:limit]) + "…"

def _first_sentence(text: str, max_words: int) -> str:
    import re
    # Split by sentence terminators conservatively
    parts = re.split(r"(?<=[\.!?])\s+", text.strip())
    first = parts[0] if parts else text.strip()
    return _truncate_words(first, max_words)

def _extract_heading_blocks(lines: List[str]) -> Dict[str, List[str]]:
    # Return mapping of 'ThoughtR', 'What to do', 'Next step' -> list of content lines
    sections = {"Thought": [], "What to do": [], "Next step": []}
    current = None
    for l in lines:
        if l.strip().lower().startswith("### thought"):
            current = "Thought"
            continue
        if l.strip().lower().startswith("### what to do"):
            current = "What to do"
            continue
        if l.strip().lower().startswith("### next step"):
            current = "Next step"
            continue
        if current:
            sections[current].append(l)
    return sections

def _extract_bullets(lines: List[str]) -> List[str]:
    bullets = []
    import re
    for l in lines:
        s = l.strip()
        if s.startswith("- "):
            bullets.append(s[2:].strip())
        elif s.startswith("* "):
            bullets.append(s[2:].strip())
        else:
            m = re.match(r"^(\d+)\.\s+(.*)$", s)
            if m and m.group(2).strip():
                bullets.append(m.group(2).strip())
    return bullets

def _synthesize_bullets_from_text(text: str, max_items: int, per_bullet_words: int) -> List[str]:
    # Fallback: split by sentences, make short bullet-like items
    import re
    sentences = re.split(r"(?<=[\.!?])\s+", text.strip())
    items = []
    for s in sentences:
        s_clean = s.strip("-•* ").strip()
        if not s_clean:
            continue
        items.append(_truncate_words(s_clean, per_bullet_words))
        if len(items) >= max_items:
            break
    if not items:
        return []
    return items[:max_items]

def _ensure_compact_shape(text: str, response_length: str) -> str:
    # Normalize and coerce into the 3-section compact shape.
    per_bullet_words = 12 if response_length == "short" else 18 if response_length == "medium" else 24
    sentence_words = 18 if response_length == "short" else 26 if response_length == "medium" else 34

    t = _cut_at_sentinel(_rstrip_lines(_normalize_eols(text)))
    lines = t.split("\n")
    lines = _convert_bold_headers_to_atx(lines)
    lines = _convert_unicode_bullets(lines)
    lines = _merge_orphan_numbered_items(lines)
    t = _collapse_blank_runs("\n".join(lines))
    lines = t.split("\n")

    sections = _extract_heading_blocks(lines)
    have_all = all(sections[k] for k in sections.keys())

    if not have_all:
        # Build compact output from scratch using best-effort extraction
        raw_plain = " ".join([l for l in lines if not l.strip().startswith("#")]).strip()
        tldr = _first_sentence(raw_plain, sentence_words) if raw_plain else ""
        # Try to pick bullets from any list-like lines first
        bullets = _extract_bullets(lines)
        if not bullets:
            bullets = _synthesize_bullets_from_text(raw_plain, 3, per_bullet_words)
        bullets = [ _truncate_words(b, per_bullet_words) for b in bullets[:3] ]
        # Next step heuristic: use next short imperative-like sentence, else reuse first bullet/action
        next_step = ""
        for cand in bullets:
            if cand:
                next_step = cand
                break
        if not next_step:
            next_step = tldr or "Proceed with the most actionable item."
        next_step = _truncate_words(next_step, sentence_words)

        parts = []
        parts.append("### Thought")
        parts.append(tldr or "Concise summary unavailable.")
        parts.append("")
        parts.append("### What to do")
        if bullets:
            for b in bullets:
                parts.append(f"- {b}")
        else:
            parts.append("- Identify the key task.")
            parts.append("- Decide the immediate next action.")
            parts.append("- Verify prerequisites and proceed.")
        parts.append("")
        parts.append("### Next step")
        parts.append(next_step)
        return "\n".join(parts).strip()

    # If sections exist, normalize their content and enforce caps
    tldr_body = " ".join([l.strip() for l in sections["Thought"] if l.strip()])
    tldr_final = _first_sentence(tldr_body, sentence_words) if tldr_body else "Concise summary unavailable."

    bullets = _extract_bullets(sections["What to do"])
    bullets = [ _truncate_words(b, per_bullet_words) for b in bullets[:3] ]
    if len(bullets) < 3:
        # try to synthesize remaining bullets from Thought or other content
        raw_plain = " ".join([l for l in lines if not l.strip().startswith("#")]).strip()
        filler = _synthesize_bullets_from_text(raw_plain, 3 - len(bullets), per_bullet_words)
        bullets.extend(filler)
    bullets = bullets[:3]

    next_body = " ".join([l.strip() for l in sections["Next step"] if l.strip()])
    if not next_body:
        next_body = bullets[0] if bullets else tldr_final
    next_final = _truncate_words(_first_sentence(next_body, sentence_words), sentence_words)

    parts = []
    parts.append("### Thought")
    parts.append(tldr_final)
    parts.append("")
    parts.append("### What to do")
    for b in bullets[:3]:
        parts.append(f"- {b}")
    parts.append("")
    parts.append("### Next step")
    parts.append(next_final)

    return "\n".join(parts).strip()

class Persona:
    def __init__(self, id: str, name: str, system_prompt: str, llm: LLMClient, temperature: int = 5):
        self.id = id
        self.name = name
        self.system_prompt = system_prompt
        self.llm = llm
        self.temperature = temperature

    async def respond(self, context: List[Dict], response_length: str = "medium") -> str:
        """Generate a compact, well-formed Markdown response suitable for the UI.
        Returns the compact Markdown string (backward compatible with previous callers).
        """
        max_tokens = MAX_TOKENS_MAP.get(response_length, 500)
        structure_hint = STRUCTURE_HINTS.get(response_length, STRUCTURE_HINTS["medium"])
        temp_scaled = round(self.temperature / 10, 2)

        full_prompt = (
            f"{self.system_prompt}\n\n"
            f"{COMPACT_MARKDOWN_V1}\n\n"
            f"{structure_hint}"
        )

        raw_text = await self.llm.generate(
            system_prompt=full_prompt,
            context=context,
            temperature=temp_scaled,
            max_tokens=max_tokens,
        )

        compact = _ensure_compact_shape(raw_text or "", response_length)

        # Final safety: cap extreme length by trimming bullet lines further if necessary
        # (We keep this conservative to avoid changing behavior unnecessarily)
        if len(compact) > 4000:  # very generous; UI should stay well below this
            # Trim bullets to even fewer words
            compact = _ensure_compact_shape(compact, "short")

        return compact


"""from app.llm.llm_client import LLMClient

class Persona:
    def __init__(self, id, name, system_prompt, llm, temperature=5):
        self.id = id
        self.name = name
        self.system_prompt = system_prompt
        self.llm = llm
        self.temperature = temperature
    
    async def respond(self, context: list[dict], response_length: str = "medium") -> str:
        max_tokens_map = {
            "short": 300,
            "medium": 500,
            "long": 800
        }

        response_style_map = {
            "short": "Respond in 20-30 words.",
            "medium": "Respond in 40-50 words.",
            "long": "Respond in 50-60 words."
        }

        max_tokens = max_tokens_map.get(response_length, 500)
        response_instruction = response_style_map.get(response_length, "medium")
        temp_scaled = round(self.temperature / 10, 2)

        full_prompt = f"{self.system_prompt}\n\n{response_instruction}"

        return await self.llm.generate(
            system_prompt=full_prompt,
            context=context,
            temperature=temp_scaled,
            max_tokens=max_tokens
        )
"""
