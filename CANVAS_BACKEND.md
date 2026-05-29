# PhD Canvas — Backend Integration Guide

This document is the handoff spec for wiring the redesigned **PhD Canvas** front end
(implemented from the Claude Design prototype `PhD Canvas.html`) to the backend.

The new UI ships **fully functional with mock data** so it renders and demos end‑to‑end
today. Every place that currently reads a hard‑coded constant or `localStorage` is called
out below with the exact endpoint, request, and response shape needed to make it real.

- **Front end:** `phd-advisor-frontend/` (Create React App, React 19)
- **Mock data lives in:** [`src/data/canvasData.js`](phd-advisor-frontend/src/data/canvasData.js) — this is the single file to replace with API calls.
- **Backend:** `multi_llm_chatbot_backend/` (FastAPI). Several endpoints below **already exist** and are noted as ✅.

---

## 0. Conventions

| Item | Value |
|---|---|
| Base URL | `process.env.REACT_APP_API_URL` (e.g. `http://localhost:8000`) |
| Auth | `Authorization: Bearer <authToken>` on every authenticated request |
| Content type | `application/json` unless noted (uploads use `multipart/form-data`) |
| Token storage | `localStorage.authToken`, user object in `localStorage.user` |
| Error shape | `{ "detail": "human-readable message" }` with appropriate HTTP status |

All timestamps are ISO‑8601 UTC strings. All IDs are strings.

---

## 1. What is real today vs. mocked

| Area | Status | Source |
|---|---|---|
| Auth / signup / login / token | ✅ exists | `routes/auth.py` |
| Account: change password, update profile, delete account | ✅ exists | `routes/auth.py` (`POST /me/password`, `PATCH /me`, `DELETE /me`) |
| Chat (stream, sessions, history) | ✅ exists | `routes/chat*.py`, `routes/chat_sessions.py` |
| Document upload + extraction | ✅ exists | `routes/documents.py` (`POST /upload-document`, `GET /uploaded-files`) |
| Canvas insights (sections/insights) | ✅ exists, **needs adapter** | `routes/phd_canvas.py`, `models/phd_canvas.py` |
| Canvas **Insights v2** cards | ⚠️ mocked | `CHAT_INSIGHTS` in `canvasData.js` |
| **Workspace** widgets + layout | ⚠️ mocked (localStorage) | `WORKSPACE_KEY` |
| **Documents** drafts (editor) | ⚠️ mocked (localStorage) | `DOCS_KEY` |
| **Active advisors** set | ⚠️ mocked (in‑memory) | `App.js` state |
| **Projects** (the "Active project" header) | ⚠️ mocked | `DEMO_PROJECT` |
| **Required deliverables** status | ⚠️ mocked | `REQUIRED_DELIVERABLES` |
| **Notification** preferences | ⚠️ mocked | `SettingsPage.js` |
| Value‑add resources / journey phases | ⚠️ mocked / optional | `VALUE_DELIVERABLES`, `JOURNEY_PHASES` |

---

## 2. Insights (Canvas → "Insights" tab)

The Insights tab renders cards from `CHAT_INSIGHTS`. The backend already synthesizes
insights into `PhdCanvas.sections[*].insights` (`models/phd_canvas.py`). You only need a
**read endpoint that returns the card-shaped projection**, or have the front end map the
existing `GET /api/phd-canvas` response (see §2.2).

### 2.1 `GET /api/phd-canvas/insights`  (new, recommended)
Returns one card per themed section.

**Response**
```jsonc
{
  "insights": [
    {
      "id": "research_progress",          // section key
      "title": "Research progress",
      "icon": "TrendingUp",               // lucide icon name; default "Sparkles"
      "confidence": 78,                    // 0-100 (round(avg(insight.confidence_score)*100))
      "summary": "Primary recordings from 4 of 6 ...",
      "bullets": ["V1 recordings: **4/6 animals** ...", "..."],  // **bold** markdown supported
      "sources": 12,                       // count of source messages/docs
      "pinned": true,                      // user pin state (persist server-side; see 2.3)
      "updatedMinutesAgo": 3,              // or send "updatedAt" ISO and let FE compute
      "quotes": ["\"...\" — May 6 lab notes"]  // optional
    }
  ],
  "sessionsAnalyzed": 28,                  // shown in the toolbar
  "lastUpdated": "2026-05-29T18:00:00Z"
}
```

### 2.2 Reuse existing `GET /api/phd-canvas` ✅
If you prefer not to add an endpoint, the FE can map the existing `CanvasResponse`:

```
section_key            -> id
section.title          -> title
avg(confidence_score)  -> confidence (×100)
section.insights[].content (top 3) -> bullets
len(section.insights)  -> sources
section.description    -> summary (or first insight)
```
Tell us which approach you want; the FE wiring point is `InsightsView` /
[`canvasData.js`](phd-advisor-frontend/src/data/canvasData.js).

### 2.3 Pin / unpin a card
`PUT /api/phd-canvas/insights/{id}/pin` → `{ "pinned": true }` → `200 { "ok": true }`
(Currently pin state is component‑local and resets on reload.)

### 2.4 Refresh / re-synthesize
- ✅ `GET /api/phd-canvas/refresh` — already used by the legacy canvas; the Insights
  toolbar **Refresh** button should call this, then re-fetch §2.1.
- ✅ `POST /api/phd-canvas/auto-update`, `GET /api/phd-canvas/stats`, `DELETE /api/phd-canvas` exist.

---

## 3. Workspace (Canvas → "Workspace" tab)

A user‑customizable dashboard of widgets. Today the **layout** persists to
`localStorage["phd-canvas-workspace-v1"]` and each widget renders **static stub content**.

### 3.1 Layout persistence
**Layout object** (array of placed widgets):
```jsonc
[ { "id": "w-bibliography-1717000000000", "type": "bibliography", "size": "M" } ]  // size: "S"|"M"|"L"
```

- `GET  /api/canvas/workspace` → `{ "layout": [ ... ] }`
- `PUT  /api/canvas/workspace` body `{ "layout": [ ... ] }` → `{ "ok": true }`

Widget **catalog**, **categories**, and **presets** are static UI config
(`WIDGET_CATALOG`, `WIDGET_CATEGORIES`, `WORKSPACE_PRESETS`) and can stay client‑side.
If you want them server‑driven, expose `GET /api/canvas/widget-catalog`.

### 3.2 Per‑widget data (to replace the stubs)
Each widget type currently shows placeholder content (see
[`Widget.js`](phd-advisor-frontend/src/components/canvas/Widget.js)). To make them live,
provide `GET /api/canvas/widgets/{type}?projectId=...` returning the shape that widget needs.
Suggested contracts for the non‑stub widgets:

| Widget `type` | Endpoint payload (suggested) |
|---|---|
| `bibliography` | `{ count, format, items:[{key,authors,venue,year}] }` |
| `reading-queue` | `{ toRead, readThisWeek, items:[{title}] }` |
| `notes` | `{ count, lastEditedMinutesAgo, latest:{title,body} }` |
| `highlights` | `{ items:[{quote,citationKey}], more }` |
| `writing` | `{ wordsToday, target, heatmap:number[28], streak }` |
| `outline` | `{ nodes:[{title,children:[]}] }` |
| `kanban` | `{ columns:[{name,cards:[{title}]}] }` |
| `deadlines` | `{ items:[{title,daysOut}] }` |
| `pomodoro` | client‑only timer (no backend) |
| `calendar` | `{ days:[{date,isToday,hasEvent}] }` |
| `activity` | `{ items:[{action,target,ago}] }` |
| `documenter` | `{ date, entry }` (+ `POST` to append) |
| `phd-journey` | `{ phases:[{name,status}] }` — from `JOURNEY_PHASES` (see §8) |
| `meeting-log` | `{ items:[{who,last,note}] }` |
| `goals` | `{ items:[{name,pct}] }` |
| `habits` | `{ items:[{name,streak}] }` |
| `reviewer-2`, `devils-advocate`, `scope-realism` | **AI‑generated critique** for the active project/draft — call the LLM orchestrator with the relevant persona. Payload: `{ text }` or `{ bullets:[] }` / `{ estimate, target, advice }`. These are the "anti‑yes‑man" widgets and are the highest‑value to back with real model output. |

Widgets flagged `stub: true` in the catalog are intentional placeholders — back them later.

---

## 4. Documents (Canvas → "Documents" tab)

A template‑driven editor (Notion‑style: TOC + section textareas with word‑count/heuristic
checks). Drafts persist to `localStorage["phd-canvas-docs-v1"]` today.

**Draft object**
```jsonc
{
  "id": "p-1717000000000",
  "name": "Research Paper draft",
  "templateId": "research-paper",       // from DOC_TEMPLATES
  "sections": { "abstract": "text...", "intro": "text..." },  // keyed by section id
  "createdAt": 1717000000000
}
```

| Method & path | Purpose |
|---|---|
| `GET    /api/canvas/documents` | list current user's drafts → `{ "documents": [Draft] }` |
| `POST   /api/canvas/documents` | create from template `{ templateId }` → `Draft` |
| `GET    /api/canvas/documents/{id}` | fetch one draft |
| `PUT    /api/canvas/documents/{id}` | update `{ name?, sections? }` (autosave — debounce ~1s) |
| `DELETE /api/canvas/documents/{id}` | delete draft |

**Templates** (`DOC_TEMPLATES`) and **section scaffolding** (`SECTION_DEFINITIONS`) are static
UI config and can stay client‑side, or be served via `GET /api/canvas/document-templates`.

**AI check** button → `POST /api/canvas/documents/{id}/ai-check` `{ sectionId }` →
`{ suggestions: [string] }` (LLM pass over the section text).

**Export** button → `GET /api/canvas/documents/{id}/export?format=pdf|docx|md` → file download.
Note: a chat/markdown export already exists at `GET /export-chat` (`routes/documents.py`) and
can be a starting point.

---

## 5. Advisors (header pill + Manage Advisors modal + Settings → Advisors)

The 6 advisors come from `ADVISORS` (mirrors `personas/phd_advisors/*.yaml`). The **active
set** (which advisors answer in chat) is shared across Chat/Canvas/Settings and is currently
React state in `App.js` (resets on reload).

- `GET /api/advisors` → `{ "advisors": [{ id, name, role, summary, color, bg, icon }] }`
  (Or reuse the existing `AppConfigContext` advisor config — already loaded by the Chat page.)
- `GET /api/advisors/active` → `{ "activeIds": ["methodologist", "theorist", ...] }`
- `PUT /api/advisors/active` body `{ "activeIds": [...] }` → `{ "ok": true }`

The chat orchestrator should **respect `activeIds`** when fanning out a user message to personas.

---

## 6. Projects ("Active project" header + Switch project)

The canvas header shows a single `DEMO_PROJECT`. A project scopes insights, workspace, and
documents. To make multi‑project real:

```jsonc
// Project
{ "id": "proj_1", "title": "Cortical Predictive Coding in Mouse V1", "meta": "Year 2 · PhD · Adv. Dr. Reineke", "isActive": true }
```

- `GET  /api/projects` → `{ "projects": [Project] }`
- `POST /api/projects` `{ title, meta }` → `Project`
- `PUT  /api/projects/{id}/activate` → `{ "ok": true }`

If multi‑project is out of scope for now, a single `GET /api/projects/active` returning one
Project is enough to replace `DEMO_PROJECT`. All workspace/document/insight endpoints above
accept an optional `?projectId=`.

---

## 7. Settings page

`SettingsPage.js` has 7 sections. Most map to existing auth endpoints:

| Setting | Endpoint |
|---|---|
| Profile: first/last name, email, institution, program, stage | ✅ `PATCH /api/auth/me` (extend `User` model with `institution`, `program`, `stage`) |
| Appearance: theme | client‑only (`localStorage.theme`) — no backend |
| Appearance: replay tour | client‑only (`localStorage["phd-canvas-tour-seen-v1"]`) |
| Advisors | §5 |
| Documents (required uploads) | §9 |
| Notifications (4 toggles) | `GET/PUT /api/settings/notifications` → `{ weeklySummary, deadlineReminders, newInsight, wordTarget }` (booleans) |
| Data: export all | `GET /api/account/export` → JSON archive download |
| Data: reset workspace | client clears `WORKSPACE_KEY`; or `DELETE /api/canvas/workspace` |
| Account: change password | ✅ `POST /api/auth/me/password` |
| Account: sign out everywhere | `POST /api/auth/logout` ✅ (extend to revoke all sessions) |
| Account: delete account | ✅ `DELETE /api/auth/me` |

**Academic stages** (`ACADEMIC_STAGES`) mirror `phd_config.yaml` — keep in sync server‑side.

---

## 8. PhD Journey phases (optional / for `phd-journey` widget)

`JOURNEY_PHASES` (14 phases, courses → ProQuest) is static UI content sourced from the project
notes PDF. It powers the `phd-journey` workspace widget and can stay client‑side. To make a
phase's `status` (`done`/`active`/`next`/`locked`), `eta`, `checklist` state, and latest
`insight` per‑user, expose:
- `GET /api/journey` → `{ "phases": [ { id, status, eta, checklistDone:[bool], insight } ] }`
- `PUT /api/journey/{phaseId}` → update status / checklist.

---

## 9. Required deliverables / uploads (Settings → Documents)

`REQUIRED_DELIVERABLES` are the 4 grounding uploads (PhD Handbook, CV, Formatting Criteria,
IRB Process). Upload reuses the existing pipeline:
- ✅ `POST /upload-document` (multipart) — already extracts + chunks.
- `GET /api/deliverables` → `{ "items": [ { id, title, sub, uploaded, filename, when, required } ] }`
  (Derive `uploaded`/`filename` from `GET /uploaded-files` ✅ tagged by deliverable `id`.)
- When a deliverable upload completes, tag it server‑side so the four slots resolve correctly.

---

## 10. Value‑add resources (optional)

`VALUE_DELIVERABLES` (Faculty Match, Top Authors, Meeting Prep, Community, Conferences,
Open‑Source Tools) are generated artifacts. Not rendered on the final canvas, but if surfaced:
`GET /api/resources` → `{ "items": [ { id, title, desc, icon, badge, accent, bg } ] }`.

---

## 11. localStorage keys in use (migrate to server when backing the above)

| Key | Purpose | Replace with |
|---|---|---|
| `theme` | light/dark | keep client‑side |
| `phd-canvas-tour-seen-v1` (`TOUR_KEY`) | welcome tour seen flag | keep client‑side, or store on user |
| `phd-canvas-workspace-v1` (`WORKSPACE_KEY`) | workspace layout | §3.1 |
| `phd-canvas-docs-v1` (`DOCS_KEY`) | document drafts | §4 |
| `authToken`, `user` | auth | existing |

---

## 12. Front-end wiring checklist (where to plug each call in)

1. **`src/data/canvasData.js`** — replace each exported constant with a fetch (or keep static
   config like catalogs/templates/stages). This is the primary integration surface.
2. **`InsightsView.js`** — fetch §2 on mount; wire Refresh button to §2.4; wire pin to §2.3.
3. **`WorkspaceView.js`** — load/save layout via §3.1 instead of `localStorage`; (optionally)
   fetch per‑widget data via §3.2.
4. **`DocumentsView.js`** — replace the `localStorage` store with the §4 CRUD endpoints.
5. **`App.js`** — load/persist active advisors (§5) and project (§6); seed `headerUser` from the
   real authenticated `user`.
6. **`SettingsPage.js`** — wire Profile save (`PATCH /me`), notifications (§7), data export/reset.

Everything renders today against mocks, so the backend can be implemented incrementally —
each endpoint above can be turned on independently without breaking the UI.
