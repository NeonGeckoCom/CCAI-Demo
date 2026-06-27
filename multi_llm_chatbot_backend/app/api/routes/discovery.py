import html
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import List, Optional
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

from fastapi import APIRouter, Request as FastAPIRequest
from pydantic import BaseModel, Field

from app.parsing.document_extractor import extract_text_from_file

logger = logging.getLogger(__name__)
router = APIRouter()
SEARCH_EXECUTOR = ThreadPoolExecutor(max_workers=2)


class DiscoveryMaterial(BaseModel):
    name: str = ""
    text: Optional[str] = None


class DiscoverDeliverablesRequest(BaseModel):
    program: str = ""
    institution: str = ""
    materials: List[DiscoveryMaterial] = Field(default_factory=list)


MILESTONE_PATTERNS = [
    ("Plan / program of study", "Year 1", re.compile(r"\b(program|plan) of study\b|\bdegree plan\b|\bstudy plan\b", re.I)),
    ("Coursework / credit requirements", "Years 1-2", re.compile(r"\b(coursework|course requirements|required credits|credit hours|core courses)\b", re.I)),
    ("Lab rotations", "Year 1", re.compile(r"\b(lab )?rotations?\b|\brotation reports?\b", re.I)),
    ("Advisor / committee selection", "Year 1-2", re.compile(r"\b(select|choose|appoint|form).{0,60}\b(advisor|supervisor|committee|chair)\b|\bdoctoral committee\b", re.I)),
    ("Annual review / progress report", "Yearly", re.compile(r"\bannual (review|progress|evaluation)\b|\bprogress report\b|\byearly committee\b", re.I)),
    ("Qualifying / comprehensive exam", "End of Year 2", re.compile(r"\b(qualifying|comprehensive|preliminary|prelim|candidacy) exam(?:ination)?\b|\bquals\b|\bcomps\b", re.I)),
    ("Dissertation proposal / prospectus", "Years 2-3", re.compile(r"\b(dissertation|thesis) (proposal|prospectus)\b|\bproposal defense\b|\bdefend.{0,40}(proposal|prospectus)\b", re.I)),
    ("Advance to candidacy", "After exam/proposal", re.compile(r"\badvance(d)? to candidacy\b|\badmission to candidacy\b|\bcandidacy form\b", re.I)),
    ("Ethics / IRB approval", "Before data collection", re.compile(r"\b(IRB|IACUC|human subjects|ethics approval|research ethics|institutional review)\b", re.I)),
    ("Teaching / TA requirement", "During enrollment", re.compile(r"\b(teaching|TA|teaching assistant|pedagogy) requirement\b", re.I)),
    ("Dissertation writing", "Final phase", re.compile(r"\bwrite .{0,40}(dissertation|thesis)\b|\bdissertation chapters?\b|\bthesis chapters?\b", re.I)),
    ("Dissertation defense / oral exam", "Final year", re.compile(r"\b(dissertation|thesis) defense\b|\boral defense\b|\bfinal oral\b|\bfinal examination\b", re.I)),
    ("Final dissertation submission", "After defense", re.compile(r"\b(final|submit|submission|deposit).{0,60}\b(dissertation|thesis)\b|\bProQuest\b|\brepository submission\b|\bgraduate school submission\b", re.I)),
]


GENERIC_DELIVERABLES = [
    {"name": "Plan / program of study", "when": "Year 1", "source": "Built-in milestone template"},
    {"name": "Qualifying / comprehensive exam", "when": "End of Year 2", "source": "Built-in milestone template"},
    {"name": "Dissertation proposal defense", "when": "Years 2-3", "source": "Built-in milestone template"},
    {"name": "Ethics / IRB approval", "when": "Before data collection", "source": "Built-in milestone template"},
    {"name": "Dissertation defense / oral exam", "when": "Final year", "source": "Built-in milestone template"},
    {"name": "Final dissertation submission", "when": "After defense", "source": "Built-in milestone template"},
]


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def evidence_fragments(text: str) -> List[str]:
    lines = [clean_text(line) for line in re.split(r"[\r\n]+", text or "")]
    sentences = [clean_text(part) for part in re.findall(r"[^.!?\n]+[.!?\n]+|[^.!?\n]+$", text or "")]
    return [item for item in lines + sentences if 12 <= len(item) <= 500][:700]


def format_when(value: str) -> str:
    cleaned = clean_text(value)
    return re.sub(r"^y", "Year ", cleaned, flags=re.I) if re.match(r"^y\s*\d", cleaned, re.I) else cleaned


def infer_when(evidence: str, fallback: str, anchor_pattern: Optional[re.Pattern] = None) -> str:
    text = clean_text(evidence)
    time_pattern = re.compile(
        r"\b(end of )?y(?:ear)?\s*[1-7](?:\s*[-–]\s*(?:y|year)?\s*[1-7])?\b"
        r"|\b(years?|semesters?)\s*[1-7](?:\s*[-–]\s*[1-7])?\b"
        r"|\b(final year|yearly|annually|before [a-z ]{3,36}|after [a-z ]{3,36}|prior to [a-z ]{3,36}|no later than [a-z ]{3,36})\b",
        re.I,
    )
    anchor = 0
    if anchor_pattern:
        anchor_match = anchor_pattern.search(text)
        if anchor_match:
            anchor = anchor_match.start() + len(anchor_match.group(0)) // 2
    matches = [
        (format_when(match.group(0)), match.start() + len(match.group(0)) // 2)
        for match in time_pattern.finditer(text)
    ]
    if not matches:
        return fallback
    return sorted(
        matches,
        key=lambda item: abs(item[1] - anchor) + (45 if item[1] < anchor else 0),
    )[0][0]


def dedupe(deliverables: List[dict]) -> List[dict]:
    seen = set()
    output = []
    for item in deliverables:
        key = re.sub(r"[^a-z0-9]+", " ", clean_text(item.get("name", "")).lower())
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output[:12]


def parse_deliverables_from_texts(texts: List[dict]) -> List[dict]:
    deliverables = []
    for item in texts:
        text = item.get("text", "")
        source = item.get("source", "Source text")
        fragments = evidence_fragments(text)
        for name, default_when, pattern in MILESTONE_PATTERNS:
            hit = next((fragment for fragment in fragments if pattern.search(fragment)), "")
            if not hit and not pattern.search(text):
                continue
            when = infer_when(hit or text, default_when, pattern)
            if name == "Dissertation defense / oral exam" and re.match(r"after\b", when, re.I):
                when = default_when
            deliverables.append(
                {
                    "name": name,
                    "when": when,
                    "source": source,
                }
            )
    return dedupe(deliverables)


def strip_html(raw_html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw_html)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return clean_text(html.unescape(text))


def fetch_raw_html(url: str, timeout: int = 8) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.3",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "")
        if "pdf" in content_type.lower():
            return ""
        data = response.read(500_000)
    return data.decode("utf-8", errors="ignore")


def fetch_text(url: str, timeout: int = 8) -> str:
    return strip_html(fetch_raw_html(url, timeout=timeout))


def search_public_pages(program: str, institution: str) -> List[dict]:
    query = quote_plus(
        f"{institution} {program} PhD handbook milestones qualifying exam dissertation proposal defense final submission"
    )
    search_urls = [
        f"https://www.bing.com/search?q={query}&setlang=en-US",
        f"https://duckduckgo.com/html/?q={query}",
    ]

    raw_search_page = ""
    search_html = ""
    for search_url in search_urls:
        try:
            raw_search_page = fetch_raw_html(search_url, timeout=4)
            search_html = strip_html(raw_search_page)
            if len(search_html) > 200:
                break
        except Exception as exc:
            logger.info("Discovery search failed for %s: %s", search_url, exc)
            continue

    if not search_html:
        return []

    # Keep this endpoint responsive for onboarding. The search result page
    # usually contains titles/snippets from official pages; deeper page fetching
    # can be added behind a background job or an explicit "deep search" action.
    return [{"source": "Public web search", "text": search_html}]


def make_result(
    *,
    program: str,
    institution: str,
    deliverables: List[dict],
    discovery_mode: str,
) -> dict:
    return {
        "degree": program or "PhD program",
        "institution": institution or "your institution",
        "discoveryMode": discovery_mode,
        "deliverables": deliverables,
    }


def search_public_pages_with_timeout(program: str, institution: str, timeout: int = 4) -> List[dict]:
    future = SEARCH_EXECUTOR.submit(search_public_pages, program, institution)
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        logger.info("Discovery search timed out after %s seconds", timeout)
        return []
    except Exception as exc:
        logger.info("Discovery search failed: %s", exc)
        return []


def material_texts_from_models(materials: List[DiscoveryMaterial]) -> List[dict]:
    return [
        {"source": material.name or "Uploaded material", "text": material.text or ""}
        for material in materials
        if clean_text(material.text or "")
    ]


def parse_materials_json(raw_value: object) -> List[DiscoveryMaterial]:
    if raw_value is None:
        return []
    try:
        data = json.loads(str(raw_value))
    except Exception:
        logger.info("Discovery materials JSON could not be parsed")
        return []
    if not isinstance(data, list):
        return []
    materials = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            materials.append(DiscoveryMaterial.model_validate(item))
        except Exception:
            logger.info("Discovery material item was ignored because it was invalid")
    return materials


async def collect_discovery_inputs(request: FastAPIRequest) -> tuple[str, str, List[dict]]:
    content_type = request.headers.get("content-type", "").lower()
    if "multipart/form-data" not in content_type:
        try:
            body = DiscoverDeliverablesRequest.model_validate(await request.json())
        except Exception:
            body = DiscoverDeliverablesRequest()
        return body.program, body.institution, material_texts_from_models(body.materials)

    form = await request.form()
    program = str(form.get("program") or "")
    institution = str(form.get("institution") or "")
    material_texts = material_texts_from_models(parse_materials_json(form.get("materials")))

    for uploaded in form.getlist("files"):
        filename = getattr(uploaded, "filename", "") or "Uploaded file"
        if not hasattr(uploaded, "read"):
            continue
        try:
            file_bytes = await uploaded.read()
            if not file_bytes:
                continue
            text = extract_text_from_file(
                file_bytes,
                getattr(uploaded, "content_type", None),
                filename,
            )
        except Exception as exc:
            logger.info("Discovery file parse failed for %s: %s", filename, exc)
            continue
        if clean_text(text):
            material_texts.append({"source": filename, "text": text})

    return program, institution, material_texts


@router.post("/discover-deliverables")
async def discover_deliverables(request: FastAPIRequest):
    """Extract PhD deliverables from uploaded text or public web pages."""
    program, institution, material_texts = await collect_discovery_inputs(request)
    if material_texts:
        parsed = parse_deliverables_from_texts(material_texts)
        if parsed:
            return make_result(
                program=program,
                institution=institution,
                deliverables=parsed,
                discovery_mode="documents",
            )

    web_sources = search_public_pages_with_timeout(program, institution)
    parsed_web = parse_deliverables_from_texts(web_sources)
    if parsed_web:
        return make_result(
            program=program,
            institution=institution,
            deliverables=parsed_web,
            discovery_mode="web",
        )

    return make_result(
        program=program,
        institution=institution,
        deliverables=GENERIC_DELIVERABLES,
        discovery_mode="fallback",
    )
