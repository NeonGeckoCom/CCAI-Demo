"""Per-user document library + accumulated knowledge markdown.

Every document uploaded anywhere in the app (Documents page, chat, defense
room, onboarding/plan builder, workspace) is captured here as a persistent
record in the ``user_documents`` collection with its extracted text, so the
Documents page can list and edit all of them.

On save, a background task asks the LLM to analyze the document, follows
http(s) links found inside it, and appends what it learned to the user's
knowledge markdown (``user_knowledge`` collection). That markdown is injected
into every chat prompt so advisors know the student's materials.
"""

import asyncio
import hashlib
import ipaddress
import json
import logging
import re
import socket
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from bson import ObjectId

from app.core.database import get_database

logger = logging.getLogger(__name__)

DOCUMENTS_COLLECTION = "user_documents"
KNOWLEDGE_COLLECTION = "user_knowledge"

MAX_DOC_TEXT_CHARS = 400_000          # stored extracted text cap
MAX_ANALYSIS_INPUT_CHARS = 16_000     # doc text sent to the LLM
MAX_LINKS_PER_DOC = 5
MAX_LINK_FETCH_BYTES = 400_000
MAX_LINK_TEXT_CHARS = 4_000
LINK_FETCH_TIMEOUT_S = 10
MAX_KNOWLEDGE_CHARS = 32_000          # stored knowledge markdown cap
MAX_KNOWLEDGE_PROMPT_CHARS = 7_000    # knowledge slice injected into chat

URL_RE = re.compile(r"https?://[^\s<>()\[\]{}\"']+", re.IGNORECASE)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="ignore")).hexdigest()


def _doc_public(doc: Dict[str, Any], include_content: bool = True) -> Dict[str, Any]:
    out = {
        "id": str(doc["_id"]),
        "name": doc.get("name") or doc.get("filename") or "Untitled",
        "filename": doc.get("filename") or "",
        "file_type": doc.get("file_type") or "",
        "source": doc.get("source") or "documents",
        "size": doc.get("size") or 0,
        "word_count": doc.get("word_count") or 0,
        "analysis_status": doc.get("analysis_status") or "none",
        "analysis": doc.get("analysis") or None,
        "comparison": doc.get("comparison") or None,
        "created_at": (doc.get("created_at") or _now()).isoformat(),
        "updated_at": (doc.get("updated_at") or _now()).isoformat(),
    }
    if include_content:
        out["content"] = doc.get("content") or ""
    return out


# ---------------------------------------------------------------------------
# Document records
# ---------------------------------------------------------------------------

async def save_document_record(
    user_id: str,
    filename: str,
    content: str,
    source: str = "documents",
    file_type: str = "",
    size: int = 0,
    name: str = "",
    run_analysis: bool = True,
) -> Optional[Dict[str, Any]]:
    """Upsert a document by (user_id, filename) and schedule AI analysis.

    Re-uploads of unchanged content (e.g. chat re-syncing the same files on
    every message) are detected via content hash and skip re-analysis.
    """
    db = get_database()
    if db is None or not user_id or not filename:
        return None

    content = (content or "")[:MAX_DOC_TEXT_CHARS]
    digest = _content_hash(content)
    word_count = len(re.findall(r"\S+", content))
    now = _now()

    existing = await db[DOCUMENTS_COLLECTION].find_one(
        {"user_id": user_id, "filename": filename}
    )

    if existing and existing.get("content_hash") == digest:
        # Same file re-synced — refresh timestamp only.
        await db[DOCUMENTS_COLLECTION].update_one(
            {"_id": existing["_id"]}, {"$set": {"updated_at": now}}
        )
        existing["updated_at"] = now
        return _doc_public(existing, include_content=False)

    fields = {
        "user_id": user_id,
        "filename": filename,
        "name": name or re.sub(r"\.[^.]+$", "", filename),
        "content": content,
        "content_hash": digest,
        "file_type": file_type,
        "source": source,
        "size": size or len(content),
        "word_count": word_count,
        "analysis_status": "pending" if run_analysis else "none",
        "updated_at": now,
    }
    if existing:
        await db[DOCUMENTS_COLLECTION].update_one(
            {"_id": existing["_id"]}, {"$set": fields}
        )
        doc_id = existing["_id"]
    else:
        fields["created_at"] = now
        result = await db[DOCUMENTS_COLLECTION].insert_one(fields)
        doc_id = result.inserted_id

    if run_analysis and content.strip():
        schedule_document_analysis(user_id, str(doc_id))

    saved = await db[DOCUMENTS_COLLECTION].find_one({"_id": doc_id})
    return _doc_public(saved, include_content=False) if saved else None


async def list_documents(user_id: str) -> List[Dict[str, Any]]:
    db = get_database()
    if db is None:
        return []
    cursor = db[DOCUMENTS_COLLECTION].find({"user_id": user_id}).sort("updated_at", -1)
    return [_doc_public(d, include_content=False) async for d in cursor]


async def get_document(user_id: str, doc_id: str) -> Optional[Dict[str, Any]]:
    db = get_database()
    if db is None or not ObjectId.is_valid(doc_id):
        return None
    doc = await db[DOCUMENTS_COLLECTION].find_one(
        {"_id": ObjectId(doc_id), "user_id": user_id}
    )
    return _doc_public(doc) if doc else None


async def update_document(
    user_id: str,
    doc_id: str,
    name: Optional[str] = None,
    content: Optional[str] = None,
    reanalyze: bool = False,
) -> Optional[Dict[str, Any]]:
    db = get_database()
    if db is None or not ObjectId.is_valid(doc_id):
        return None
    fields: Dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        fields["name"] = str(name)[:300]
    if content is not None:
        content = content[:MAX_DOC_TEXT_CHARS]
        fields["content"] = content
        fields["content_hash"] = _content_hash(content)
        fields["word_count"] = len(re.findall(r"\S+", content))
    if reanalyze:
        fields["analysis_status"] = "pending"
    result = await db[DOCUMENTS_COLLECTION].update_one(
        {"_id": ObjectId(doc_id), "user_id": user_id}, {"$set": fields}
    )
    if not result.matched_count:
        return None
    if reanalyze:
        schedule_document_analysis(user_id, doc_id)
    doc = await db[DOCUMENTS_COLLECTION].find_one({"_id": ObjectId(doc_id)})
    return _doc_public(doc) if doc else None


async def delete_document(user_id: str, doc_id: str) -> bool:
    db = get_database()
    if db is None or not ObjectId.is_valid(doc_id):
        return False
    doc = await db[DOCUMENTS_COLLECTION].find_one_and_delete(
        {"_id": ObjectId(doc_id), "user_id": user_id}
    )
    if doc:
        try:
            await remove_knowledge_section(user_id, f"Document: {doc.get('filename')}")
        except Exception:
            logger.warning("Could not remove knowledge section for deleted doc")
        return True
    return False


# ---------------------------------------------------------------------------
# AI analysis (background)
# ---------------------------------------------------------------------------

def schedule_document_analysis(user_id: str, doc_id: str) -> None:
    """Fire-and-forget analysis so uploads stay fast."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop; skipping analysis scheduling for %s", doc_id)
        return

    async def _run():
        try:
            await analyze_document(user_id, doc_id)
        except Exception as exc:
            logger.error("Document analysis failed for %s: %s", doc_id, exc)
            db = get_database()
            if db is not None and ObjectId.is_valid(doc_id):
                await db[DOCUMENTS_COLLECTION].update_one(
                    {"_id": ObjectId(doc_id)},
                    {"$set": {"analysis_status": "failed"}},
                )

    loop.create_task(_run())


def _is_public_http_url(url: str) -> bool:
    """SSRF guard: only http(s) URLs that resolve to public addresses."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        host = parsed.hostname
        if host.lower() in ("localhost",) or host.endswith(".local"):
            return False
        infos = socket.getaddrinfo(host, None)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (
                ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified
            ):
                return False
        return bool(infos)
    except Exception:
        return False


async def _fetch_link_text(url: str) -> str:
    """Fetch a public link and return readable text (best-effort)."""
    import httpx

    try:
        async with httpx.AsyncClient(
            timeout=LINK_FETCH_TIMEOUT_S,
            follow_redirects=True,
            headers={"User-Agent": "PhD-Navigator-DocBot/1.0"},
        ) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    return ""
                ctype = resp.headers.get("content-type", "")
                if not any(t in ctype for t in ("text/html", "text/plain", "application/xhtml")):
                    return ""
                raw = b""
                async for chunk in resp.aiter_bytes():
                    raw += chunk
                    if len(raw) > MAX_LINK_FETCH_BYTES:
                        break
    except Exception as exc:
        logger.info("Link fetch failed for %s: %s", url, exc)
        return ""

    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = re.sub(r"\s+", " ", soup.get_text(" ")).strip()
        return text[:MAX_LINK_TEXT_CHARS]
    except Exception:
        try:
            return re.sub(r"\s+", " ", raw.decode("utf-8", errors="ignore")).strip()[:MAX_LINK_TEXT_CHARS]
        except Exception:
            return ""


def _extract_urls(text: str) -> List[str]:
    seen, urls = set(), []
    for match in URL_RE.findall(text or ""):
        url = match.rstrip(".,;:!?)\"'>")
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


async def analyze_document(user_id: str, doc_id: str) -> None:
    """Summarize a document, follow its links, and record learnings."""
    db = get_database()
    if db is None or not ObjectId.is_valid(doc_id):
        return
    doc = await db[DOCUMENTS_COLLECTION].find_one(
        {"_id": ObjectId(doc_id), "user_id": user_id}
    )
    if not doc or not (doc.get("content") or "").strip():
        return

    await db[DOCUMENTS_COLLECTION].update_one(
        {"_id": doc["_id"]}, {"$set": {"analysis_status": "analyzing"}}
    )

    content = doc["content"][:MAX_ANALYSIS_INPUT_CHARS]
    urls = _extract_urls(doc["content"])[:MAX_LINKS_PER_DOC]

    fetched: List[Dict[str, str]] = []
    for url in urls:
        if not _is_public_http_url(url):
            continue
        text = await _fetch_link_text(url)
        if text:
            fetched.append({"url": url, "text": text})

    link_blocks = "\n\n".join(
        f"[Linked page {i + 1}] {item['url']}\n{item['text']}"
        for i, item in enumerate(fetched)
    )

    system_prompt = (
        "You analyze documents uploaded by a PhD student to their academic coaching "
        "app. Extract what an academic advisor should remember about the student "
        "and their program from this material. Respond ONLY with JSON matching: "
        '{"summary": string (2-3 sentences), '
        '"key_points": [string, ...] (3-7 concise facts worth remembering), '
        '"topics": [string, ...] (2-5 short topic tags), '
        '"link_insights": [{"url": string, "takeaway": string}, ...] '
        "(one concise takeaway per linked page provided, [] if none)}"
    )
    user_prompt = f"Document filename: {doc.get('filename')}\n\nDocument text:\n{content}"
    if link_blocks:
        user_prompt += f"\n\nContent fetched from links inside the document:\n{link_blocks}"

    from app.llm.clients.provider_manager import create_llm_client

    llm = create_llm_client()
    raw = await llm.generate(
        system_prompt=system_prompt,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=1200,
        response_mime_type="application/json",
    )

    try:
        cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        analysis = json.loads(cleaned)
    except Exception:
        analysis = {"summary": (raw or "").strip()[:600], "key_points": [], "topics": [], "link_insights": []}

    analysis = {
        "summary": str(analysis.get("summary") or "")[:1200],
        "key_points": [str(p)[:300] for p in (analysis.get("key_points") or [])[:8]],
        "topics": [str(t)[:60] for t in (analysis.get("topics") or [])[:6]],
        "link_insights": [
            {"url": str(li.get("url") or "")[:400], "takeaway": str(li.get("takeaway") or "")[:400]}
            for li in (analysis.get("link_insights") or [])[:MAX_LINKS_PER_DOC]
            if isinstance(li, dict)
        ],
        "links_found": urls,
        "links_fetched": [item["url"] for item in fetched],
        "analyzed_at": _now().isoformat(),
    }

    await db[DOCUMENTS_COLLECTION].update_one(
        {"_id": doc["_id"]},
        {"$set": {"analysis": analysis, "analysis_status": "done"}},
    )

    # Fold learnings into the user's knowledge markdown for chat context.
    lines: List[str] = []
    if analysis["summary"]:
        lines.append(analysis["summary"])
    for point in analysis["key_points"]:
        lines.append(f"- {point}")
    for li in analysis["link_insights"]:
        if li["takeaway"]:
            lines.append(f"- From linked page {li['url']}: {li['takeaway']}")
    if analysis["topics"]:
        lines.append(f"- Topics: {', '.join(analysis['topics'])}")
    if lines:
        await upsert_knowledge_section(
            user_id,
            f"Document: {doc.get('filename')}",
            "\n".join(lines),
        )
    logger.info(
        "Analyzed document %s for user %s (%d links fetched)",
        doc.get("filename"), user_id, len(fetched),
    )

    # If this looks like a newer version of an earlier upload (e.g. two
    # handbooks), auto-compare them and remember what changed.
    try:
        await compare_documents(user_id, str(doc["_id"]))
    except Exception as exc:
        logger.warning("Auto-compare failed for %s: %s", doc.get("filename"), exc)


# ---------------------------------------------------------------------------
# Knowledge markdown
# ---------------------------------------------------------------------------

async def get_knowledge(user_id: str) -> Dict[str, Any]:
    db = get_database()
    if db is None:
        return {"markdown": "", "updated_at": None}
    doc = await db[KNOWLEDGE_COLLECTION].find_one({"user_id": user_id})
    if not doc:
        return {"markdown": "", "updated_at": None}
    return {
        "markdown": doc.get("markdown") or "",
        "updated_at": (doc.get("updated_at") or _now()).isoformat(),
    }


async def set_knowledge(user_id: str, markdown: str) -> Dict[str, Any]:
    db = get_database()
    if db is None:
        return {"markdown": "", "updated_at": None}
    markdown = (markdown or "")[:MAX_KNOWLEDGE_CHARS]
    now = _now()
    await db[KNOWLEDGE_COLLECTION].update_one(
        {"user_id": user_id},
        {"$set": {"markdown": markdown, "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"markdown": markdown, "updated_at": now.isoformat()}


def _split_sections(markdown: str) -> List[Dict[str, str]]:
    """Split knowledge markdown into '### '-headed sections (plus a preamble)."""
    parts = re.split(r"(?m)^###\s+", markdown or "")
    sections = []
    if parts and parts[0].strip():
        sections.append({"heading": "", "body": parts[0].strip()})
    for part in parts[1:]:
        lines = part.split("\n", 1)
        sections.append({
            "heading": lines[0].strip(),
            "body": (lines[1] if len(lines) > 1 else "").strip(),
        })
    return sections


def _join_sections(sections: List[Dict[str, str]]) -> str:
    chunks = []
    for sec in sections:
        if sec["heading"]:
            chunks.append(f"### {sec['heading']}\n{sec['body']}".rstrip())
        elif sec["body"]:
            chunks.append(sec["body"])
    return "\n\n".join(chunks).strip()


async def upsert_knowledge_section(user_id: str, heading: str, body: str) -> None:
    """Replace or append one '### heading' section of the knowledge markdown."""
    current = (await get_knowledge(user_id))["markdown"]
    sections = _split_sections(current)
    if not any(s["heading"] for s in sections) and not current:
        sections = [{"heading": "", "body": "# What we know about this student"}]

    stamp = _now().strftime("%Y-%m-%d")
    body = f"_Updated {stamp}_\n{body.strip()}"

    for sec in sections:
        if sec["heading"].lower() == heading.lower():
            sec["body"] = body
            break
    else:
        sections.append({"heading": heading, "body": body})

    merged = _join_sections(sections)
    # Trim oldest document sections when over budget (keep preamble + newest).
    while len(merged) > MAX_KNOWLEDGE_CHARS:
        doc_indexes = [i for i, s in enumerate(sections) if s["heading"].startswith("Document:")]
        if not doc_indexes:
            merged = merged[:MAX_KNOWLEDGE_CHARS]
            break
        sections.pop(doc_indexes[0])
        merged = _join_sections(sections)

    await set_knowledge(user_id, merged)


async def remove_knowledge_section(user_id: str, heading: str) -> None:
    current = (await get_knowledge(user_id))["markdown"]
    if not current:
        return
    sections = [s for s in _split_sections(current) if s["heading"].lower() != heading.lower()]
    await set_knowledge(user_id, _join_sections(sections))


async def get_knowledge_section(user_id: str, heading: str) -> str:
    """Return one section's body (without the '_Updated …_' stamp line)."""
    markdown = (await get_knowledge(user_id))["markdown"]
    for sec in _split_sections(markdown):
        if sec["heading"].lower() == heading.lower():
            return re.sub(r"^_Updated [^_\n]+_\n?", "", sec["body"]).strip()
    return ""


# ---------------------------------------------------------------------------
# Personal memory — chat exchanges + app events
# ---------------------------------------------------------------------------

CHAT_MEMORY_HEADING = "Chat memory"
MAX_MEMORY_BULLETS = 30


def _fire_and_forget(coro_factory, label: str) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop; skipping %s", label)
        return

    async def _run():
        try:
            await coro_factory()
        except Exception as exc:
            logger.warning("%s failed: %s", label, exc)

    loop.create_task(_run())


async def record_event_memory(
    user_id: str, heading: str, lines: List[str], max_lines: int = 24
) -> None:
    """Prepend dated bullets to a rolling knowledge section (no LLM)."""
    if not lines:
        return
    stamp = _now().strftime("%Y-%m-%d")
    fresh = [f"- [{stamp}] {str(line).strip()[:400]}" for line in lines if str(line).strip()]
    current = await get_knowledge_section(user_id, heading)
    kept = [l for l in current.split("\n") if l.strip().startswith("-")]
    merged = (fresh + kept)[:max_lines]
    await upsert_knowledge_section(user_id, heading, "\n".join(merged))


def schedule_event_memory(user_id: str, heading: str, lines: List[str]) -> None:
    _fire_and_forget(
        lambda: record_event_memory(user_id, heading, lines),
        f"event memory ({heading})",
    )


async def record_chat_memory(
    user_id: str, user_input: str, advisor_responses: List[Dict[str, str]]
) -> None:
    """Distill a chat exchange into the durable 'Chat memory' notes via LLM."""
    if not (user_input or "").strip():
        return
    current = await get_knowledge_section(user_id, CHAT_MEMORY_HEADING)
    responses_text = "\n\n".join(
        f"{r.get('name', 'Advisor')}: {str(r.get('response') or '')[:1500]}"
        for r in advisor_responses[:3]
    )[:5000]

    system_prompt = (
        "You maintain long-term memory notes about a PhD student for their AI "
        "coaching assistant. You receive the current notes and one new chat "
        "exchange. Return the UPDATED notes as markdown bullets only ('- ' "
        "prefix, no headings, no commentary). Keep only durable facts worth "
        "remembering across sessions: their research topic and methods, program "
        "milestones and deadlines, struggles and blockers, recurring questions, "
        "preferences, advisor/committee dynamics, decisions made, and goals. "
        "Merge new information into existing bullets, deduplicate, drop trivia "
        f"and small talk. At most {MAX_MEMORY_BULLETS} bullets, most important "
        "first. If the exchange adds nothing durable, return the existing notes "
        "unchanged."
    )
    user_prompt = (
        f"Current notes:\n{current or '(none yet)'}\n\n"
        f"New exchange —\nStudent asked: {user_input[:1500]}\n\n"
        f"Advisors answered:\n{responses_text or '(no response)'}"
    )

    from app.llm.clients.provider_manager import create_llm_client

    llm = create_llm_client()
    raw = await llm.generate(
        system_prompt=system_prompt,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=1000,
    )
    bullets = [
        line.strip() for line in (raw or "").split("\n")
        if line.strip().startswith("-")
    ][:MAX_MEMORY_BULLETS + 5]
    if bullets:
        await upsert_knowledge_section(user_id, CHAT_MEMORY_HEADING, "\n".join(bullets))


def schedule_chat_memory(
    user_id: str, user_input: str, advisor_responses: List[Dict[str, str]]
) -> None:
    _fire_and_forget(
        lambda: record_chat_memory(user_id, user_input, advisor_responses),
        "chat memory",
    )


# ---------------------------------------------------------------------------
# Document version comparison ("what changed in my handbook?")
# ---------------------------------------------------------------------------

_VERSION_NOISE_RE = re.compile(
    r"\b(v|ver|version|rev|draft|final|copy|new|old|updated?|latest)\b|\d+|[_\-.()\[\]]+",
    re.IGNORECASE,
)
MAX_COMPARE_HEAD_CHARS = 9_000
MAX_COMPARE_TAIL_CHARS = 3_000


def _normalize_version_key(filename: str) -> str:
    base = re.sub(r"\.[^.]+$", "", filename or "")
    return re.sub(r"\s+", " ", _VERSION_NOISE_RE.sub(" ", base)).strip().lower()


async def find_previous_version(user_id: str, doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Best older sibling that looks like an earlier version of *doc*."""
    from difflib import SequenceMatcher

    db = get_database()
    if db is None:
        return None
    key = _normalize_version_key(doc.get("filename") or "")
    if not key:
        return None
    best, best_score = None, 0.0
    cursor = db[DOCUMENTS_COLLECTION].find(
        {"user_id": user_id, "_id": {"$ne": doc["_id"]}}
    )
    async for cand in cursor:
        if cand.get("content_hash") == doc.get("content_hash"):
            continue
        cand_key = _normalize_version_key(cand.get("filename") or "")
        if not cand_key:
            continue
        score = SequenceMatcher(None, key, cand_key).ratio()
        if score > best_score:
            best, best_score = cand, score
    return best if best_score >= 0.6 else None


def _compare_slice(text: str) -> str:
    text = text or ""
    if len(text) <= MAX_COMPARE_HEAD_CHARS + MAX_COMPARE_TAIL_CHARS:
        return text
    return (
        text[:MAX_COMPARE_HEAD_CHARS]
        + "\n…[middle omitted]…\n"
        + text[-MAX_COMPARE_TAIL_CHARS:]
    )


async def compare_documents(
    user_id: str, doc_id: str, against_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """LLM-diff a document against its previous version and remember the changes.

    The comparison is stored on the NEWER document's record and the change list
    is written to the knowledge markdown so chat can answer "what changed?".
    """
    db = get_database()
    if db is None or not ObjectId.is_valid(doc_id):
        return None
    doc = await db[DOCUMENTS_COLLECTION].find_one(
        {"_id": ObjectId(doc_id), "user_id": user_id}
    )
    if not doc:
        return None

    if against_id and ObjectId.is_valid(against_id):
        other = await db[DOCUMENTS_COLLECTION].find_one(
            {"_id": ObjectId(against_id), "user_id": user_id}
        )
    else:
        other = await find_previous_version(user_id, doc)
    if not other or not (other.get("content") or "").strip():
        return None

    # Compare newest against oldest regardless of which id triggered this.
    doc_ts = doc.get("created_at") or _now()
    other_ts = other.get("created_at") or _now()
    newer, older = (doc, other) if doc_ts >= other_ts else (other, doc)

    system_prompt = (
        "You compare two versions of a document a PhD student uploaded (for "
        "example an older and newer program handbook). Determine whether they "
        "are versions of the same document, and if so what changed in the newer "
        "one. Focus on changes that affect the student: requirements, deadlines, "
        "milestones, forms, committee rules, funding, policies. Respond ONLY "
        'with JSON matching: {"is_same_document": boolean, '
        '"summary": string (1-2 sentences), '
        '"changes": [{"area": string, "change": string, "impact": string}, ...] '
        "(up to 10, most important first; [] if effectively identical)}"
    )
    user_prompt = (
        f"OLDER version — {older.get('filename')}:\n{_compare_slice(older.get('content'))}\n\n"
        f"NEWER version — {newer.get('filename')}:\n{_compare_slice(newer.get('content'))}"
    )

    from app.llm.clients.provider_manager import create_llm_client

    llm = create_llm_client()
    raw = await llm.generate(
        system_prompt=system_prompt,
        context=[{"role": "user", "content": user_prompt}],
        temperature=0.2,
        max_tokens=1500,
        response_mime_type="application/json",
    )
    try:
        cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(cleaned)
    except Exception:
        logger.warning("Comparison JSON parse failed for %s", newer.get("filename"))
        return None

    comparison = {
        "against_id": str(older["_id"]),
        "against_filename": older.get("filename") or "",
        "is_same_document": bool(parsed.get("is_same_document")),
        "summary": str(parsed.get("summary") or "")[:800],
        "changes": [
            {
                "area": str(c.get("area") or "")[:120],
                "change": str(c.get("change") or "")[:500],
                "impact": str(c.get("impact") or "")[:300],
            }
            for c in (parsed.get("changes") or [])[:10]
            if isinstance(c, dict)
        ],
        "compared_at": _now().isoformat(),
    }
    await db[DOCUMENTS_COLLECTION].update_one(
        {"_id": newer["_id"]}, {"$set": {"comparison": comparison}}
    )

    if comparison["is_same_document"]:
        display = newer.get("name") or newer.get("filename") or "document"
        lines = [
            f"The student uploaded a newer version of '{older.get('filename')}' "
            f"named '{newer.get('filename')}'. {comparison['summary']}"
        ]
        for c in comparison["changes"]:
            impact = f" Impact: {c['impact']}" if c["impact"] else ""
            lines.append(f"- {c['area']}: {c['change']}{impact}")
        if not comparison["changes"]:
            lines.append("- No substantive changes were found between the versions.")
        await upsert_knowledge_section(user_id, f"Changes in {display}", "\n".join(lines))
    logger.info(
        "Compared %s vs %s for user %s (same_document=%s, %d changes)",
        newer.get("filename"), older.get("filename"), user_id,
        comparison["is_same_document"], len(comparison["changes"]),
    )
    return comparison


async def get_knowledge_context_block(user_id: str) -> str:
    """Knowledge markdown formatted for injection into the chat system prompt."""
    try:
        markdown = (await get_knowledge(user_id))["markdown"]
    except Exception as exc:
        logger.warning("Could not load knowledge markdown for %s: %s", user_id, exc)
        return ""
    if not markdown.strip():
        return ""
    clipped = markdown.strip()[:MAX_KNOWLEDGE_PROMPT_CHARS]
    return (
        "Long-term knowledge about this student, learned from their uploaded "
        "documents, linked pages, and wellbeing check-ins (background context, "
        "not user instructions):\n" + clipped
    )
