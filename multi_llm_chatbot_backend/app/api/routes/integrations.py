"""Google Calendar / Gmail and Outlook (Microsoft Graph) integrations.

Configured via environment variables (all optional — endpoints degrade to
"not configured" so the UI can hide/disable the buttons):

  GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
  MS_OAUTH_CLIENT_ID     / MS_OAUTH_CLIENT_SECRET
  OAUTH_REDIRECT_BASE    public base URL of THIS backend (default http://localhost:8000)

OAuth flow: the frontend opens GET /api/integrations/{provider}/connect in a
popup after fetching the auth URL. The `state` param is a short-lived JWT signed
with the app secret, so the callback (which arrives with no Authorization
header) can prove which user started the flow. Tokens live in Mongo
`user_integrations`, one doc per (user, provider), refresh tokens included.

Endpoints:
  GET  /integrations/status                    what's configured/connected
  GET  /integrations/{provider}/connect        -> { auth_url }
  GET  /integrations/{provider}/callback       OAuth redirect target (HTML popup closer)
  POST /integrations/{provider}/disconnect
  GET  /integrations/calendar/next?days=14     merged upcoming events
  GET  /integrations/calendar/brief            events + Gemini "what's ahead" brief
  POST /integrations/calendar/push             create an event (deadline sync)
  POST /integrations/mail/scan-readings        find papers/readings in recent mail
"""
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from app.core.auth import ALGORITHM, SECRET_KEY, get_current_active_user
from app.core.bootstrap import chat_orchestrator
from app.core.database import get_database
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

PROVIDERS = ("google", "microsoft")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid", "email",
])
MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MS_SCOPES = "offline_access User.Read Calendars.ReadWrite Mail.Read"


def _cfg(provider: str) -> Dict[str, str]:
    if provider == "google":
        return {
            "client_id": os.getenv("GOOGLE_OAUTH_CLIENT_ID", ""),
            "client_secret": os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
        }
    return {
        "client_id": os.getenv("MS_OAUTH_CLIENT_ID", ""),
        "client_secret": os.getenv("MS_OAUTH_CLIENT_SECRET", ""),
    }


def _redirect_uri(provider: str) -> str:
    base = os.getenv("OAUTH_REDIRECT_BASE", "http://localhost:8000").rstrip("/")
    return f"{base}/api/integrations/{provider}/callback"


def _require_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _oauth_state(user_id: str, provider: str) -> str:
    return jwt.encode(
        {"sub": user_id, "provider": provider, "purpose": "oauth-connect",
         "exp": _now() + timedelta(minutes=10)},
        SECRET_KEY, algorithm=ALGORITHM,
    )


def _read_oauth_state(state: str, provider: str) -> str:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")
    if payload.get("purpose") != "oauth-connect" or payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="OAuth state mismatch.")
    return str(payload.get("sub"))


# ---------------------------------------------------------------------------
# Token storage / refresh
# ---------------------------------------------------------------------------
async def _store_tokens(user_id: str, provider: str, tokens: Dict[str, Any],
                        account_email: str = "") -> None:
    db = get_database()
    update = {
        "access_token": tokens.get("access_token", ""),
        "expires_at": (_now() + timedelta(seconds=int(tokens.get("expires_in", 3600) or 3600))),
        "scopes": tokens.get("scope", ""),
        "updated_at": _now(),
    }
    if tokens.get("refresh_token"):
        update["refresh_token"] = tokens["refresh_token"]
    if account_email:
        update["account_email"] = account_email
    await db.user_integrations.update_one(
        {"user_id": user_id, "provider": provider},
        {"$set": update, "$setOnInsert": {"user_id": user_id, "provider": provider,
                                          "created_at": _now()}},
        upsert=True,
    )


async def _get_connection(user_id: str, provider: str) -> Optional[Dict[str, Any]]:
    db = get_database()
    return await db.user_integrations.find_one({"user_id": user_id, "provider": provider})


async def _valid_access_token(user_id: str, provider: str) -> Optional[str]:
    """Return a live access token, refreshing if needed; None when not connected."""
    conn = await _get_connection(user_id, provider)
    if not conn:
        return None
    expires_at = conn.get("expires_at")
    if expires_at and expires_at.replace(tzinfo=timezone.utc) > _now() + timedelta(minutes=2):
        return conn.get("access_token")
    refresh = conn.get("refresh_token")
    if not refresh:
        return conn.get("access_token")
    cfg = _cfg(provider)
    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    }
    if provider == "microsoft":
        data["scope"] = MS_SCOPES
    token_url = GOOGLE_TOKEN_URL if provider == "google" else MS_TOKEN_URL
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(token_url, data=data)
        if res.status_code != 200:
            logger.warning("Token refresh failed for %s: %s", provider, res.text[:300])
            return None
        tokens = res.json()
        await _store_tokens(user_id, provider, tokens)
        return tokens.get("access_token")
    except httpx.HTTPError as e:
        logger.warning("Token refresh error for %s: %s", provider, e)
        return None


# ---------------------------------------------------------------------------
# Status / connect / callback / disconnect
# ---------------------------------------------------------------------------
@router.get("/integrations/status")
async def integrations_status(current_user: User = Depends(get_current_active_user)):
    out = {}
    for provider in PROVIDERS:
        cfg = _cfg(provider)
        conn = await _get_connection(str(current_user.id), provider)
        out[provider] = {
            "configured": bool(cfg["client_id"] and cfg["client_secret"]),
            "connected": bool(conn),
            "account_email": (conn or {}).get("account_email", ""),
        }
    return out


@router.get("/integrations/{provider}/connect")
async def integration_connect(provider: str,
                              current_user: User = Depends(get_current_active_user)):
    _require_provider(provider)
    cfg = _cfg(provider)
    if not (cfg["client_id"] and cfg["client_secret"]):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"{provider.title()} integration is not configured on this server. "
                   f"Set the OAuth client id/secret environment variables.",
        )
    state = _oauth_state(str(current_user.id), provider)
    if provider == "google":
        params = {
            "client_id": cfg["client_id"],
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "scope": GOOGLE_SCOPES,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        return {"auth_url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "response_mode": "query",
        "scope": MS_SCOPES,
        "state": state,
    }
    return {"auth_url": f"{MS_AUTH_URL}?{urlencode(params)}"}


_POPUP_HTML = """<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
<h3>{message}</h3><p>You can close this window.</p>
<script>
  try {{
    if (window.opener) window.opener.postMessage({{ type: "phd-integration", provider: "{provider}", ok: {ok} }}, "*");
  }} catch (e) {{}}
  setTimeout(function () {{ window.close(); }}, 1200);
</script></body></html>"""


@router.get("/integrations/{provider}/callback")
async def integration_callback(provider: str, code: str = "", state: str = "",
                               error: str = ""):
    _require_provider(provider)
    if error or not code:
        return HTMLResponse(_POPUP_HTML.format(
            message=f"Connection was cancelled ({error or 'no code returned'}).",
            provider=provider, ok="false"))
    user_id = _read_oauth_state(state, provider)
    cfg = _cfg(provider)
    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": _redirect_uri(provider),
    }
    if provider == "microsoft":
        data["scope"] = MS_SCOPES
    token_url = GOOGLE_TOKEN_URL if provider == "google" else MS_TOKEN_URL
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(token_url, data=data)
        if res.status_code != 200:
            logger.error("OAuth exchange failed for %s: %s", provider, res.text[:300])
            return HTMLResponse(_POPUP_HTML.format(
                message="Connection failed while exchanging tokens.",
                provider=provider, ok="false"))
        tokens = res.json()
        # Best-effort account email for display in Settings
        email = ""
        try:
            if provider == "google" and tokens.get("id_token"):
                claims = jwt.get_unverified_claims(tokens["id_token"])
                email = claims.get("email", "")
            elif provider == "microsoft":
                me = await client.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers={"Authorization": f"Bearer {tokens.get('access_token','')}"})
                if me.status_code == 200:
                    body = me.json()
                    email = body.get("mail") or body.get("userPrincipalName", "")
        except Exception:  # display-only nicety; never fail the connect over it
            pass
    await _store_tokens(user_id, provider, tokens, account_email=email)
    return HTMLResponse(_POPUP_HTML.format(
        message=f"{provider.title()} connected!", provider=provider, ok="true"))


@router.post("/integrations/{provider}/disconnect")
async def integration_disconnect(provider: str,
                                 current_user: User = Depends(get_current_active_user)):
    _require_provider(provider)
    db = get_database()
    await db.user_integrations.delete_one(
        {"user_id": str(current_user.id), "provider": provider})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Calendar: upcoming events (merged), Gemini brief, push event
# ---------------------------------------------------------------------------
async def _google_events(token: str, days: int) -> List[Dict[str, Any]]:
    params = {
        "timeMin": _now().isoformat(),
        "timeMax": (_now() + timedelta(days=days)).isoformat(),
        "singleEvents": "true", "orderBy": "startTime", "maxResults": 20,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params=params, headers={"Authorization": f"Bearer {token}"})
    if res.status_code != 200:
        logger.warning("Google events fetch failed: %s", res.text[:200])
        return []
    out = []
    for ev in res.json().get("items", []):
        start = ev.get("start", {})
        out.append({
            "provider": "google",
            "title": ev.get("summary", "(no title)"),
            "start": start.get("dateTime") or start.get("date", ""),
            "all_day": "date" in start,
            "location": ev.get("location", ""),
            "attendees": [a.get("email", "") for a in ev.get("attendees", [])][:8],
            "link": ev.get("htmlLink", ""),
        })
    return out


async def _ms_events(token: str, days: int) -> List[Dict[str, Any]]:
    params = {
        "startDateTime": _now().isoformat(),
        "endDateTime": (_now() + timedelta(days=days)).isoformat(),
        "$orderby": "start/dateTime", "$top": "20",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            "https://graph.microsoft.com/v1.0/me/calendarview",
            params=params,
            headers={"Authorization": f"Bearer {token}",
                     "Prefer": 'outlook.timezone="UTC"'})
    if res.status_code != 200:
        logger.warning("Outlook events fetch failed: %s", res.text[:200])
        return []
    out = []
    for ev in res.json().get("value", []):
        out.append({
            "provider": "microsoft",
            "title": ev.get("subject", "(no title)"),
            "start": (ev.get("start") or {}).get("dateTime", ""),
            "all_day": bool(ev.get("isAllDay")),
            "location": ((ev.get("location") or {}).get("displayName", "")),
            "attendees": [
                ((a.get("emailAddress") or {}).get("address", ""))
                for a in ev.get("attendees", [])][:8],
            "link": ev.get("webLink", ""),
        })
    return out


async def _merged_events(user_id: str, days: int) -> Dict[str, Any]:
    events: List[Dict[str, Any]] = []
    connected = []
    for provider, fetch in (("google", _google_events), ("microsoft", _ms_events)):
        token = await _valid_access_token(user_id, provider)
        if token:
            connected.append(provider)
            events.extend(await fetch(token, days))
    events.sort(key=lambda e: e.get("start") or "9999")
    return {"connected": connected, "events": events}


@router.get("/integrations/calendar/next")
async def calendar_next(days: int = Query(14, ge=1, le=60),
                        current_user: User = Depends(get_current_active_user)):
    return await _merged_events(str(current_user.id), days)


BRIEF_SYSTEM_PROMPT = """You are the PhD Navigator's morning-brief writer. Given a student's
upcoming calendar events, their logged deadlines, and the faculty they mean to meet regularly,
write a compact session-start brief. Return ONLY valid JSON:
{
  "brief": "2-3 warm, concrete sentences: what's next on the calendar, what deadline is closest, and one nudge if a faculty member is overdue for a meeting",
  "next_meeting": {"title": "...", "start": "ISO datetime or empty", "with": "person or empty"} or null,
  "overdue_faculty": ["names of faculty overdue for a meeting per their cadence"]
}"""


@router.get("/integrations/calendar/brief")
async def calendar_brief(current_user: User = Depends(get_current_active_user)):
    """Session-start brief: next events + deadlines + faculty cadence → Gemini summary."""
    user_id = str(current_user.id)
    merged = await _merged_events(user_id, 14)
    db = get_database()
    ws = await db.user_workspace.find_one({"user_id": user_id}, {"sections": 1}) or {}
    sections = ws.get("sections") or {}
    deadlines = sections.get("deadlines") or []
    faculty = sections.get("faculty") or []

    # Deterministic next-meeting fallback (works with no LLM and no calendar)
    next_meeting = None
    for ev in merged["events"]:
        if not ev.get("all_day"):
            next_meeting = {"title": ev["title"], "start": ev["start"],
                            "with": (ev.get("attendees") or [""])[0]}
            break

    result = {
        "connected": merged["connected"],
        "events": merged["events"][:10],
        "next_meeting": next_meeting,
        "brief": "",
        "overdue_faculty": [],
    }
    if not merged["connected"] and not deadlines and not faculty:
        return result

    client = getattr(chat_orchestrator, "llm_client", None)
    if client is None:
        return result
    try:
        payload = {
            "now": _now().isoformat(),
            "events": merged["events"][:10],
            "deadlines": [
                {"label": d.get("label"), "date": d.get("date")}
                for d in deadlines if isinstance(d, dict)][:15],
            "faculty": [
                {"name": f.get("name"), "role": f.get("role"),
                 "cadence": f.get("cadence"), "last_met": f.get("lastMet")}
                for f in faculty if isinstance(f, dict)][:15],
        }
        raw = await client.generate(
            system_prompt=BRIEF_SYSTEM_PROMPT,
            context=[{"role": "user", "content": json.dumps(payload)}],
            temperature=0.3,
            max_tokens=512,
            response_mime_type="application/json",
        )
        text = (raw or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        parsed = json.loads(text)
        result["brief"] = str(parsed.get("brief", ""))[:600]
        if isinstance(parsed.get("next_meeting"), dict):
            result["next_meeting"] = parsed["next_meeting"]
        if isinstance(parsed.get("overdue_faculty"), list):
            result["overdue_faculty"] = [str(x) for x in parsed["overdue_faculty"]][:10]
    except Exception as e:
        logger.warning("Calendar brief generation failed: %s", e)
    return result


class PushEventRequest(BaseModel):
    title: str
    date: str                      # YYYY-MM-DD
    time: str = ""                 # HH:MM optional; empty → all-day
    duration_minutes: int = 60
    notes: str = ""
    provider: str = ""             # empty → first connected


@router.post("/integrations/calendar/push")
async def calendar_push(body: PushEventRequest,
                        current_user: User = Depends(get_current_active_user)):
    user_id = str(current_user.id)
    providers = [body.provider] if body.provider else list(PROVIDERS)
    token, provider = None, None
    for p in providers:
        if p not in PROVIDERS:
            continue
        token = await _valid_access_token(user_id, p)
        if token:
            provider = p
            break
    if not token:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No calendar is connected. Connect Google or Outlook in Settings first.")

    try:
        day = datetime.strptime(body.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    async with httpx.AsyncClient(timeout=20) as client:
        if provider == "google":
            if body.time:
                start_dt = datetime.strptime(f"{body.date} {body.time}", "%Y-%m-%d %H:%M")
                end_dt = start_dt + timedelta(minutes=max(15, body.duration_minutes))
                event = {"summary": body.title, "description": body.notes,
                         "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
                         "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"}}
            else:
                end_day = (day + timedelta(days=1)).strftime("%Y-%m-%d")
                event = {"summary": body.title, "description": body.notes,
                         "start": {"date": body.date}, "end": {"date": end_day}}
            res = await client.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                json=event, headers={"Authorization": f"Bearer {token}"})
        else:
            start_dt = (datetime.strptime(f"{body.date} {body.time}", "%Y-%m-%d %H:%M")
                        if body.time else day)
            end_dt = (start_dt + timedelta(minutes=max(15, body.duration_minutes))
                      if body.time else day + timedelta(days=1))
            event = {"subject": body.title,
                     "body": {"contentType": "text", "content": body.notes},
                     "isAllDay": not body.time,
                     "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
                     "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"}}
            res = await client.post("https://graph.microsoft.com/v1.0/me/events",
                                    json=event, headers={"Authorization": f"Bearer {token}"})
    if res.status_code not in (200, 201):
        logger.error("Calendar push failed (%s): %s", provider, res.text[:300])
        raise HTTPException(status_code=502,
                            detail=f"{provider.title()} rejected the event.")
    created = res.json()
    return {"ok": True, "provider": provider,
            "link": created.get("htmlLink") or created.get("webLink", "")}


# ---------------------------------------------------------------------------
# Mail: scan for readings your advisor sent you
# ---------------------------------------------------------------------------
MAIL_SCAN_SYSTEM_PROMPT = """You triage a PhD student's recent email for reading material an
advisor, mentor, or colleague sent them: papers, preprints, articles, book chapters.
Input: a JSON list of messages (subject, from, snippet, links, attachments).
Pick ONLY messages that plausibly contain or point to reading material. Return ONLY valid
JSON: an array of objects with keys:
  title (best guess at the reading's title), url (best link from the message, or ""),
  from (sender), source_subject (the email subject), why (one short sentence).
Return [] if nothing qualifies."""

_LINK_RE = re.compile(r"https?://[^\s<>\"')\]]+")


class MailScanRequest(BaseModel):
    days: int = Field(14, ge=1, le=60)


async def _gmail_candidates(token: str, days: int) -> List[Dict[str, Any]]:
    query = (f"newer_than:{days}d (filename:pdf OR arxiv OR doi.org OR paper "
             f"OR readings OR \"attached article\")")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            params={"q": query, "maxResults": 15}, headers=headers)
        if res.status_code != 200:
            logger.warning("Gmail search failed: %s", res.text[:200])
            return []
        ids = [m["id"] for m in res.json().get("messages", [])]
        out = []
        for mid in ids[:15]:
            mres = await client.get(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}",
                params={"format": "metadata",
                        "metadataHeaders": ["Subject", "From", "Date"]},
                headers=headers)
            if mres.status_code != 200:
                continue
            msg = mres.json()
            hdrs = {h["name"].lower(): h["value"]
                    for h in msg.get("payload", {}).get("headers", [])}
            snippet = msg.get("snippet", "")
            out.append({
                "subject": hdrs.get("subject", ""),
                "from": hdrs.get("from", ""),
                "date": hdrs.get("date", ""),
                "snippet": snippet,
                "links": _LINK_RE.findall(snippet)[:5],
                "attachments": [],
            })
        return out


async def _outlook_candidates(token: str, days: int) -> List[Dict[str, Any]]:
    since = (_now() - timedelta(days=days)).isoformat()
    params = {
        "$filter": f"receivedDateTime ge {since}",
        "$orderby": "receivedDateTime desc",
        "$top": "25",
        "$select": "subject,from,receivedDateTime,bodyPreview,hasAttachments",
    }
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get("https://graph.microsoft.com/v1.0/me/messages",
                               params=params,
                               headers={"Authorization": f"Bearer {token}"})
    if res.status_code != 200:
        logger.warning("Outlook mail fetch failed: %s", res.text[:200])
        return []
    out = []
    keywords = re.compile(r"paper|arxiv|doi|read|article|attach|chapter|preprint", re.I)
    for msg in res.json().get("value", []):
        preview = msg.get("bodyPreview", "")
        if not (keywords.search(msg.get("subject", "") + " " + preview)
                or msg.get("hasAttachments")):
            continue
        out.append({
            "subject": msg.get("subject", ""),
            "from": ((msg.get("from") or {}).get("emailAddress") or {}).get("address", ""),
            "date": msg.get("receivedDateTime", ""),
            "snippet": preview[:400],
            "links": _LINK_RE.findall(preview)[:5],
            "attachments": ["(has attachment)"] if msg.get("hasAttachments") else [],
        })
    return out[:15]


@router.post("/integrations/mail/scan-readings")
async def scan_mail_for_readings(body: MailScanRequest,
                                 current_user: User = Depends(get_current_active_user)):
    user_id = str(current_user.id)
    candidates: List[Dict[str, Any]] = []
    connected = []
    for provider, fetch in (("google", _gmail_candidates), ("microsoft", _outlook_candidates)):
        token = await _valid_access_token(user_id, provider)
        if token:
            connected.append(provider)
            candidates.extend(await fetch(token, body.days))
    if not connected:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No mail account is connected. Connect Google or Outlook in Settings first.")
    if not candidates:
        return {"connected": connected, "items": []}

    client = getattr(chat_orchestrator, "llm_client", None)
    items: List[Dict[str, Any]] = []
    if client is not None:
        try:
            raw = await client.generate(
                system_prompt=MAIL_SCAN_SYSTEM_PROMPT,
                context=[{"role": "user", "content": json.dumps(candidates)}],
                temperature=0.2,
                max_tokens=1536,
                response_mime_type="application/json",
            )
            text = (raw or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            parsed = json.loads(text)
            if isinstance(parsed, list):
                for it in parsed[:12]:
                    if isinstance(it, dict) and (it.get("title") or "").strip():
                        items.append({
                            "title": str(it.get("title", "")).strip(),
                            "url": str(it.get("url", "")).strip(),
                            "from": str(it.get("from", "")).strip(),
                            "source_subject": str(it.get("source_subject", "")).strip(),
                            "why": str(it.get("why", "")).strip(),
                        })
        except Exception as e:
            logger.warning("Mail scan classification failed: %s", e)
    if not items:
        # Fallback: surface raw candidates with links so the user can pick
        for c in candidates[:8]:
            if c.get("links") or c.get("attachments"):
                items.append({
                    "title": c.get("subject", "(no subject)"),
                    "url": (c.get("links") or [""])[0],
                    "from": c.get("from", ""),
                    "source_subject": c.get("subject", ""),
                    "why": "Contains a link or attachment that may be a reading.",
                })
    return {"connected": connected, "items": items}
