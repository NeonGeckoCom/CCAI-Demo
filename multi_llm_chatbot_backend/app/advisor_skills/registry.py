"""Markdown-backed registry of advisor response skills."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_SKILL_ID = "quick_advice"
GENERATED_SKILL_ID_PREFIX = "custom_"
MAX_GENERATED_SKILL_ID_LENGTH = 64
MAX_GENERATED_TEXT_LENGTH = 1800
SKILLS_DIR = Path(__file__).with_name("definitions")
ALLOWED_RAG_POLICIES = {"optional", "required_when_available"}


@dataclass(frozen=True)
class AdvisorSkill:
    id: str
    name: str
    markdown: str
    metadata: Dict[str, Any]
    source_path: Optional[Path] = None

    @property
    def description(self) -> str:
        value = self.metadata.get("description")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return _first_paragraph(self.markdown)

    @property
    def use_when(self) -> str:
        return _section_text(self.markdown, "Use when") or self.description

    @property
    def headings(self) -> List[str]:
        """Return compatibility labels for optional response moves."""
        return [detail["heading"] for detail in self.heading_details]

    @property
    def heading_details(self) -> List[Dict[str, str]]:
        """Return optional response moves, with legacy heading fallback."""
        return _response_move_details(self.markdown) or _legacy_heading_details(self.markdown)

    @property
    def response_moves(self) -> List[Dict[str, str]]:
        return self.heading_details

    @property
    def how_to_work(self) -> List[str]:
        return _section_bullets(self.markdown, "How to work")

    @property
    def format_guidance(self) -> str:
        return _section_text(self.markdown, "Format guidance")

    @property
    def guardrails(self) -> List[str]:
        return _section_bullets(self.markdown, "Guardrails") or _section_bullets(
            self.markdown,
            "Evidence discipline",
        )

    @property
    def preferred_advisors(self) -> List[str]:
        advisors = self.metadata.get("preferred_advisors", [])
        return advisors if isinstance(advisors, list) else []

    @property
    def rag_policy(self) -> str:
        value = self.metadata.get("rag_policy", "optional")
        return str(value) if value else "optional"

    def max_tokens(self, response_length: str) -> int:
        budgets = self.metadata.get("token_budgets", {})
        if not isinstance(budgets, dict):
            budgets = {}
        return int(budgets.get(response_length, budgets.get("medium", 900)))

    def prompt_contract(self, response_length: str, sentinel: str) -> str:
        """Return the Markdown skill instructions injected into the persona prompt."""
        length_hint = {
            "short": "Keep the response tight and easy to scan.",
            "medium": "Give enough detail to be useful without becoming exhaustive.",
            "long": "Provide richer detail, but keep every section purposeful.",
        }.get(response_length, "Give enough detail to be useful without becoming exhaustive.")

        return f"""
You are using the advisor skill: {self.name} (`{self.id}`).

The skill definition below is an advising brief, not a fill-in template. Follow
its intent, routing criteria, response moves, and guardrails. Choose the answer
shape that best fits the user's actual request.

--- BEGIN ADVISOR SKILL ---
{self.markdown}
--- END ADVISOR SKILL ---

Response rules:
- Use GitHub-Flavored Markdown.
- Start directly with useful advice; do not announce the skill or explain the format.
- Use natural paragraphs, bullets, numbered steps, or short `###` sections as helpful.
- When the user asks to summarize or explain what a document says, answer
  descriptively first. Do not turn the answer into a critique, revision plan,
  or probing-question sequence unless the user asks for evaluation; if you add
  advisor interpretation, label it clearly.
- Treat response moves as optional ingredients: combine, rename, skip, or reorder them when the request calls for it.
- Do not march through every move like a worksheet unless the user asks for a comprehensive review.
- Use `-` for unordered bullets when bullets improve scanability.
- Do not use tables unless the user explicitly requests one.
- {length_hint}
- Prioritize a complete answer over extra detail; shorten sections if needed so the response ends cleanly.
- Finish your response with the sentinel token {sentinel}.
""".strip()


def _parse_markdown_skill(path: Path) -> AdvisorSkill:
    raw = path.read_text(encoding="utf-8")
    metadata, markdown = _split_frontmatter(raw)
    skill_id = str(metadata.get("id") or path.stem)
    name = str(metadata.get("name") or _first_heading(markdown) or skill_id.replace("_", " ").title())

    return AdvisorSkill(
        id=skill_id,
        name=name,
        markdown=markdown.strip(),
        metadata=metadata,
        source_path=path,
    )


def _split_frontmatter(raw: str) -> Tuple[Dict[str, Any], str]:
    if not raw.startswith("---"):
        return {}, raw

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", raw, flags=re.DOTALL)
    if not match:
        return {}, raw

    return _parse_frontmatter(match.group(1)), match.group(2)


def _parse_frontmatter(text: str) -> Dict[str, Any]:
    """Parse the small YAML subset used by advisor skill markdown files."""
    data: Dict[str, Any] = {}
    active_map_key = ""

    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue

        if raw_line.startswith("  ") and active_map_key:
            child_key, child_value = _split_key_value(raw_line.strip())
            if child_key:
                parent = data.setdefault(active_map_key, {})
                if isinstance(parent, dict):
                    parent[child_key] = _parse_frontmatter_value(child_value)
            continue

        key, value = _split_key_value(raw_line.strip())
        if not key:
            active_map_key = ""
            continue
        if value == "":
            data[key] = {}
            active_map_key = key
        else:
            data[key] = _parse_frontmatter_value(value)
            active_map_key = ""

    return data


def _split_key_value(line: str) -> Tuple[str, str]:
    if ":" not in line:
        return "", ""
    key, value = line.split(":", 1)
    return key.strip(), value.strip()


def _parse_frontmatter_value(value: str) -> Any:
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [
            item.strip().strip("\"'")
            for item in inner.split(",")
            if item.strip()
        ]
    if value.isdigit():
        return int(value)
    return value.strip().strip("\"'")


def _first_heading(markdown: str) -> str:
    match = re.search(r"^#\s+(.+?)\s*$", markdown, flags=re.MULTILINE)
    return match.group(1).strip() if match else ""


def _first_paragraph(markdown: str) -> str:
    for block in re.split(r"\n\s*\n", markdown.strip()):
        block = block.strip()
        if not block or block.startswith("#") or block.startswith("- "):
            continue
        return re.sub(r"\s+", " ", block)
    return ""


def _section_text(markdown: str, heading: str) -> str:
    section = _section_markdown(markdown, heading)
    return re.sub(r"\s+", " ", section).strip()


def _section_markdown(markdown: str, heading: str) -> str:
    pattern = rf"^##\s+{re.escape(heading)}\s*$"
    match = re.search(pattern, markdown, flags=re.IGNORECASE | re.MULTILINE)
    if not match:
        return ""

    rest = markdown[match.end():]
    next_heading = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    return (rest[: next_heading.start()] if next_heading else rest).strip()


def _section_bullets(markdown: str, heading: str) -> List[str]:
    section = _section_markdown(markdown, heading)
    bullets: List[str] = []
    current: List[str] = []

    for line in section.splitlines():
        bullet = re.match(r"^\s*-\s+(.*)$", line)
        if bullet:
            if current:
                bullets.append(_flatten_markdown(" ".join(current)))
            current = [bullet.group(1).strip()]
        elif current and line.strip():
            current.append(line.strip())
        elif current:
            bullets.append(_flatten_markdown(" ".join(current)))
            current = []

    if current:
        bullets.append(_flatten_markdown(" ".join(current)))

    return [item for item in bullets if item]


def _flatten_markdown(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text or "")
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def _response_move_details(markdown: str) -> List[Dict[str, str]]:
    section = _section_markdown(markdown, "Response moves")
    if not section:
        return []

    details: List[Dict[str, str]] = []
    for item in _section_bullets(markdown, "Response moves"):
        match = re.match(r"^(?:\*\*)?(.+?)(?:\*\*)?\s*:\s*(.+)$", item)
        if match:
            heading = _flatten_markdown(match.group(1)).strip(" :")
            instruction = _flatten_markdown(match.group(2))
        else:
            heading = _flatten_markdown(item)
            instruction = ""
        if heading:
            details.append({"heading": heading, "instruction": instruction})
    return details


def _legacy_heading_details(markdown: str) -> List[Dict[str, str]]:
    details: List[Dict[str, str]] = []
    matches = list(re.finditer(r"^###\s+(.+?)\s*$", markdown, flags=re.MULTILINE))
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown)
        instruction = re.sub(r"\s+", " ", markdown[start:end]).strip()
        details.append({
            "heading": match.group(1).strip(),
            "instruction": instruction,
        })
    return details


def _load_advisor_skills() -> Dict[str, AdvisorSkill]:
    skills: Dict[str, AdvisorSkill] = {}
    for path in sorted(SKILLS_DIR.glob("*.md")):
        skill = _parse_markdown_skill(path)
        if skill.id in skills:
            raise ValueError(f"Duplicate advisor skill id {skill.id!r} in {path}")
        skills[skill.id] = skill

    if DEFAULT_SKILL_ID not in skills:
        raise ValueError(f"Default advisor skill {DEFAULT_SKILL_ID!r} is not defined")

    return skills


ADVISOR_SKILLS: Dict[str, AdvisorSkill] = _load_advisor_skills()


def reload_advisor_skills() -> Dict[str, AdvisorSkill]:
    """Reload skill markdown files while preserving the exported dict object."""
    skills = _load_advisor_skills()
    ADVISOR_SKILLS.clear()
    ADVISOR_SKILLS.update(skills)
    return ADVISOR_SKILLS


def get_advisor_skill(skill_id: str) -> AdvisorSkill:
    return ADVISOR_SKILLS.get(skill_id, ADVISOR_SKILLS[DEFAULT_SKILL_ID])


def get_skill_ids() -> List[str]:
    return list(ADVISOR_SKILLS.keys())


def build_generated_advisor_skill(
    spec: Dict[str, Any],
    *,
    existing_skill_ids: Optional[List[str]] = None,
) -> AdvisorSkill:
    """Build a validated generated skill object without writing it to disk."""
    skill_id = _generated_skill_id(spec.get("id") or spec.get("name") or "")
    existing_ids = set(existing_skill_ids or ADVISOR_SKILLS)
    if skill_id in existing_ids:
        skill_id = _unique_generated_skill_id(skill_id, existing_ids=existing_ids)

    markdown = _generated_skill_markdown(spec, skill_id)
    metadata, body = _split_frontmatter(markdown)
    return AdvisorSkill(
        id=skill_id,
        name=str(metadata.get("name") or skill_id.replace("_", " ").title()),
        markdown=body.strip(),
        metadata=metadata,
        source_path=None,
    )


def install_generated_advisor_skill(spec: Dict[str, Any]) -> AdvisorSkill:
    """Create a validated generated skill markdown file and load it."""
    skill = build_generated_advisor_skill(spec)
    skill_id = skill.id
    markdown = _generated_skill_markdown(spec, skill_id)
    path = (SKILLS_DIR / f"{skill_id}.md").resolve()
    if path.parent != SKILLS_DIR.resolve():
        raise ValueError(f"Generated skill path escaped skills directory: {path}")
    if path.exists():
        skill_id = _unique_generated_skill_id(skill_id)
        markdown = _generated_skill_markdown(spec, skill_id)
        path = (SKILLS_DIR / f"{skill_id}.md").resolve()

    path.write_text(markdown, encoding="utf-8")
    reload_advisor_skills()
    return ADVISOR_SKILLS[skill_id]


def _generated_skill_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9_]+", "_", str(value).lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    if slug.startswith(GENERATED_SKILL_ID_PREFIX):
        base = slug
    else:
        base = f"{GENERATED_SKILL_ID_PREFIX}{slug}" if slug else f"{GENERATED_SKILL_ID_PREFIX}skill"
    return base[:MAX_GENERATED_SKILL_ID_LENGTH].strip("_") or f"{GENERATED_SKILL_ID_PREFIX}skill"


def _unique_generated_skill_id(base: str, *, existing_ids: Optional[set] = None) -> str:
    existing_ids = existing_ids or set(ADVISOR_SKILLS)
    stem = base[: MAX_GENERATED_SKILL_ID_LENGTH - 4].rstrip("_")
    for suffix in range(2, 1000):
        candidate = f"{stem}_{suffix}"
        if candidate not in existing_ids and not (SKILLS_DIR / f"{candidate}.md").exists():
            return candidate
    raise ValueError(f"Could not allocate unique generated skill id for {base!r}")


def _clean_generated_text(value: Any, fallback: str, *, max_len: int = MAX_GENERATED_TEXT_LENGTH) -> str:
    text = str(value or fallback)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"\n-{3,}\n", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = text.strip()
    if not text:
        text = fallback
    return text[:max_len].strip()


def _frontmatter_scalar(value: Any, fallback: str) -> str:
    text = _clean_generated_text(value, fallback, max_len=240)
    return text.replace("\n", " ").strip().strip("\"'")


def _frontmatter_list(values: Any) -> str:
    if not isinstance(values, list):
        values = []
    clean = []
    for value in values[:5]:
        item = re.sub(r"[^a-z0-9_]+", "_", str(value).lower()).strip("_")
        if item:
            clean.append(item)
    return "[" + ", ".join(dict.fromkeys(clean)) + "]"


def _token_budget(value: Any, fallback: int, *, lower: int, upper: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(lower, min(parsed, upper))


def _clean_generated_list(values: Any, fallback: List[str], *, max_items: int = 6) -> List[str]:
    if not isinstance(values, list):
        values = fallback
    clean = []
    for value in values[:max_items]:
        item = _clean_generated_text(value, "", max_len=280)
        if item:
            clean.append(item)
    return clean or fallback


def _clean_generated_headings(values: Any) -> List[Dict[str, str]]:
    fallback = [
        {"heading": "Best fit", "instruction": "Explain how to approach this request."},
        {"heading": "How to proceed", "instruction": "Give concrete next moves."},
        {"heading": "Watch out for", "instruction": "Name risks or judgment calls."},
    ]
    if not isinstance(values, list):
        values = fallback

    headings: List[Dict[str, str]] = []
    for value in values[:6]:
        if isinstance(value, dict):
            heading = value.get("heading") or value.get("name")
            instruction = value.get("instruction") or value.get("description")
        else:
            heading = value
            instruction = "Address this part of the response."
        heading_text = _clean_generated_text(heading, "", max_len=80)
        heading_text = re.sub(r"^#+\s*", "", heading_text).strip(" :")
        instruction_text = _clean_generated_text(
            instruction,
            "Address this part of the response.",
            max_len=260,
        )
        if heading_text:
            headings.append({"heading": heading_text, "instruction": instruction_text})

    return headings or fallback


def _generated_skill_markdown(spec: Dict[str, Any], skill_id: str) -> str:
    name = _frontmatter_scalar(spec.get("name"), skill_id.replace("_", " ").title())
    description = _frontmatter_scalar(
        spec.get("description"),
        "A generated advisor skill for a recurring request pattern.",
    )
    rag_policy = str(spec.get("rag_policy") or "optional")
    if rag_policy not in ALLOWED_RAG_POLICIES:
        rag_policy = "optional"

    budgets = spec.get("token_budgets") if isinstance(spec.get("token_budgets"), dict) else {}
    short_budget = _token_budget(budgets.get("short"), 650, lower=350, upper=1200)
    medium_budget = _token_budget(budgets.get("medium"), 1000, lower=550, upper=2000)
    long_budget = _token_budget(budgets.get("long"), 1500, lower=750, upper=2800)

    use_when = _clean_generated_text(
        spec.get("use_when"),
        "Use when the student's request does not fit the built-in advisor skills.",
    )
    how_to_work = _clean_generated_list(
        spec.get("how_to_work"),
        [
            "Identify the student's concrete need.",
            "Use the most relevant advisor expertise without overgeneralizing.",
            "Give a complete response that can be reused for similar requests.",
        ],
    )
    response_moves = _clean_generated_headings(spec.get("response_moves") or spec.get("headings"))
    format_guidance = _clean_generated_text(
        spec.get("format_guidance"),
        (
            "Choose the response shape that best fits the request. Use headings "
            "only when they make the answer easier to scan."
        ),
        max_len=500,
    )

    lines = [
        "---",
        f"id: {skill_id}",
        f"name: {name}",
        f"description: {description}",
        f"preferred_advisors: {_frontmatter_list(spec.get('preferred_advisors'))}",
        f"rag_policy: {rag_policy}",
        "token_budgets:",
        f"  short: {short_budget}",
        f"  medium: {medium_budget}",
        f"  long: {long_budget}",
        "---",
        "",
        f"# {name}",
        "",
        description,
        "",
        "## Use when",
        "",
        use_when,
        "",
        "## How to work",
        "",
    ]
    lines.extend(f"- {item}" for item in how_to_work)
    lines.extend(["", "## Response moves", ""])
    for move in response_moves:
        lines.append(f"- **{move['heading']}:** {move['instruction']}")
    lines.extend([
        "",
        "## Format guidance",
        "",
        format_guidance,
        "",
        "## Guardrails",
        "",
        "- Do not force every response move into the answer.",
        "- Keep the advisor persona visible, but let the skill shape the work.",
    ])

    return "\n".join(lines).strip() + "\n"
