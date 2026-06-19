# PhD Coach ("PhD Navigator") — Backend Integration Guide

This document tells a backend developer **exactly** what to build to make the
`PhD Coach` front-end prototype dynamic and fully functional.

The front end was imported from a Claude Design project and is now **the** app:
the static files live at the **`public/`** root and are served at **`/`**. The
old v2 CRA app has been removed; `src/` is just a no-op entry point that
react-scripts requires. The app is React 18 + in-browser Babel, no build step,
and self-boots from `public/index.html`.

> **Already wired to your existing backend** (no new backend was added — it
> reuses the same endpoints the removed v2 used). See **`public/coach-api.js`**
> (`window.CoachAPI`), which now powers:
> - **Auth** — `POST /auth/login`, `POST /auth/signup`; JWT in `localStorage["authToken"]`, user in `localStorage["user"]`.
> - **Streaming chat** — `POST /chat-stream` (NDJSON), rendered live in the Chat view.
> - **Chat sessions** — `POST/GET/PUT/DELETE /api/chat-sessions`, message persistence, `/new-chat`.
>
> Every call **degrades gracefully**: if the backend is unreachable the app
> falls back to offline/demo behavior so it never hard-fails. The API base URL
> is resolved at runtime (static app, no `process.env`): `window.PHD_API_BASE`
> → `localStorage["phd-api-base"]` → `http(s)://<host>:8000` (the docker-compose
> default).

The remaining mocks (roadmap discovery/generation/replan, skills, insights,
committee scoring, document parsing/storage) are still local. Your job: replace
those with real API calls — each is isolated behind a function or a
`localStorage` read/write. Search for the marker `BACKEND:` to find them.

```
grep -rn "BACKEND:" public/
```

---

## 1. How the prototype is wired today

| Concern | Today (prototype) | Needs to become |
| --- | --- | --- |
| Auth / login | ✅ **LIVE** via `public/coach-api.js` → `/auth/login`,`/auth/signup` (JWT in `localStorage["authToken"]`) | done — reuses existing backend |
| Program → deliverables discovery | `roadmap-engine.js` → `discoverDeliverables()` (mock + `setTimeout`) | Perplexity/web-search API |
| Roadmap generation | `roadmap-engine.js` → `generateRoadmap()` (deterministic) | LLM plan synthesis |
| Re-planning on setback | `roadmap-engine.js` → `replan()` (keyword classifier) | LLM re-planning |
| Plan forking from chat | `roadmap-engine.js` → `detectFork()` / `forkPlan()` | LLM situation classifier |
| Chat replies | ✅ **LIVE** via `coach-api.js` → `/chat-stream` (NDJSON), rendered in `coach-chat.jsx` | done — offline demo fallback remains |
| Skills (do work) | `coach-chat.jsx` / `coach-skills.jsx` → `runSkill()` | LLM tasks that write artifacts |
| Committee match scoring | `coach-committee.jsx` → `mockScore()`, `SUGGESTED` | Faculty/publication overlap API |
| Insights | `canvas-data.js` → `window.CHAT_INSIGHTS` | LLM summarization over chat history |
| Document upload / parse | `coach-views.jsx` → `CoachDocuments.onUpload` (client-side `mammoth`) | Server-side storage + parsing |
| Chat sessions | ✅ **LIVE** via `coach-api.js` → `/api/chat-sessions` CRUD + message save | done |
| Other persistence | `localStorage` (keys below) | Database keyed by user |

### localStorage keys (these become per-user DB records)

| Key | Written in | Holds |
| --- | --- | --- |
| `phd-coach-authed` | `coach-app2.jsx` | auth flag |
| `phd-coach-roadmap-v1` | `coach-app2.jsx` / `coach-app.jsx` (`RM_KEY`) | the entire roadmap object |
| `phd-coach-tasks-v1` | `coach-app2.jsx` (`TASK_KEY`) | set of completed subtask keys |
| `phd-coach-theme` | `coach-app2.jsx` (`THEME_KEY`) | light/dark |
| `phd-coach-workspace-v1` | `coach-views.jsx` / `coach-chat.jsx` (`WS_KEY`/`WS_STORE`) | workspace widget layout + seeds |
| `phd-coach-docs-v1` | `coach-views.jsx` / `coach-chat.jsx` (`DOC_KEY`/`DOC_STORE`) | documents (templates + uploads) |
| `phd-coach-skills-enabled-v1` / `-custom-v1` | `coach-skills.jsx` | enabled + user-created skills |
| `phd-coach-tour-done-v1` | `coach-tour.jsx` | onboarding-tour completion |
| `phd-tool-*` | `canvas-tools.jsx`, `coach-committee.jsx` | per-tool content (notes, tasks, reading, bib, committee) |
| `phd-chat-mode` / `phd-chat-personas` | `coach-chat.jsx` | chat composer prefs |

> **Recommended first step:** extend `public/coach-api.js` (the existing data layer)
> that mirrors these reads/writes, then swap each `localStorage` call for a
> `fetch` to your service. Keep the function signatures identical so the UI is
> untouched.

---

## 2. Data model the front end already assumes

The roadmap object (persisted under `phd-coach-roadmap-v1`) is the spine of the
whole app. Its shape (produced by `generateRoadmap`):

```jsonc
{
  "program":      { "name": "PhD, Information Science", "institution": "University of Colorado Boulder" },
  "deliverables": { "degree": "...", "institution": "...",
                    "deliverables": [ { "name": "...", "when": "...", "source": "..." } ] },
  "workflow":     { "writeStyle": "as-you-go|at-end|unsure", "publish": true },
  "materials":    [ { "kind": "file|text", "name": "..." } ],
  "createdAt":    1718800000000,
  "steps": [
    {
      "id": "committee", "phase": "Topic", "title": "Build Your Committee",
      "icon": "Users", "objective": "...", "estimate": "By end of Y2",
      "gate": true, "status": "done|current|locked|redo|paused",
      "subtasks": ["...", "..."],
      "add": ["advisor-matcher"], "retire": ["topic-explorer"],
      "deliverable": "Comprehensive examination",     // gate steps only
      "recovery": false, "fork": false                // set on detour/fork nodes
    }
  ]
}
```

Feature ids referenced in `add`/`retire` are defined in `roadmap-engine.js` →
`FEATURES`. Milestone templates are in `MILESTONES` / `OPTIONAL_MILESTONES`.

The engine functions (`computeFeatureState`, `setCurrent`, `markComplete`,
`replan`, `forkPlan`) are **pure** and run client-side today. You can keep them
client-side and only call the server for the three *generative* steps
(discover → generate → replan/fork), persisting the resulting roadmap. That is
the lowest-risk integration path.

---

## 3. Endpoints to build

Suggested REST surface. Adapt to your stack (the existing backend lives in
[`../multi_llm_chatbot_backend/`](../multi_llm_chatbot_backend/) — wire these in there).

### 3.1 Auth
- `POST /api/auth/login` `{ email, password }` → session/JWT
- `POST /api/auth/signup` `{ name, email, password }` → session/JWT
- `POST /api/auth/google` (OAuth) → session/JWT
- `GET  /api/me` → `{ name, email, initials, stage, program }` (replaces `window.MOCK_USER` in `canvas-data.js`)

Front-end hook: `coach-landing.jsx` `CoachLogin.onAuthed`, and the `authed`
flag in `coach-app2.jsx` `CoachRoot`.

### 3.2 Deliverable discovery — Perplexity / web search
- `POST /api/discover-deliverables` `{ program, institution }`
- Returns: `{ degree, institution, deliverables: [ { name, when, source } ] }`
- Server side: Perplexity `sonar` query, e.g.
  *"official PhD deliverables, milestones, and timeline for {program} at {institution}"* → structured JSON.

Replaces `roadmap-engine.js` → `discoverDeliverables()` (currently a `PROGRAM_DB`
lookup + `genericDeliverables()` fallback + `setTimeout`). Keep the returned
shape identical; the onboarding flow in `coach-app.jsx` consumes it directly.

### 3.3 Roadmap generation — LLM plan synthesis
- `POST /api/roadmap/generate` `{ program, deliverables, startPosition, workflow }`
- Returns: a full roadmap object (shape in §2).
- Server side: feed the `MILESTONES` library to an LLM as the toolset; have it
  order/select/personalize and map each `gate` step to a deliverable.

Replaces `roadmap-engine.js` → `generateRoadmap()`. The deterministic version is
a fine fallback if the LLM call fails.

### 3.4 Re-planning on a setback — LLM
- `POST /api/roadmap/replan` `{ roadmap, problemText, currentStepId }`
- Returns: `{ roadmap, detour }` where `detour` is the inserted recovery milestone.
- Server side: classify severity + affected milestone, reopen it (`status:"redo"`),
  emit an ordered recovery `detour`, patch the feature lifecycle.

Replaces `roadmap-engine.js` → `replan()` + `RECOVERY_TEMPLATES`/`classifyProblem()`.
Triggered from the "Something came up?" modal (`RecoveryModal` in `coach-app2.jsx`).

### 3.5 Plan forking from chat — LLM
- `POST /api/roadmap/detect-fork` `{ roadmap, message }`
- Returns: `{ shouldFork: bool, fork: { title, icon, objective, estimate, subtasks, reason } }`

Replaces `roadmap-engine.js` → `shouldFork()` + `detectFork()` + `proposeForks()`.
Consumed in `coach-chat.jsx` → `send()`; `forkPlan()` can stay client-side to apply it.

### 3.6 Chat — streaming, persona-aware
- `POST /api/chat/stream` (SSE or chunked)
  `{ message, personaIds: [...], mode: "single|multiple", stepContext: { id, title, objective }, history }`
- Streams one reply per active persona.
- Persona definitions are in `canvas-data.js` → `window.ADVISORS` (six personas).
  The real persona prompts already exist in the repo under
  [`../personas/`](../personas/) and [`../phd_config.yaml`](../phd_config.yaml) —
  reuse those system prompts.

Replaces the demo generators: `coach-chat.jsx` → `personaReply()` and
`coach-app2.jsx` → `ChatView.send()` (both currently return canned markdown).
Persist conversations server-side so Insights (§3.8) can summarize them.

### 3.7 Skills — LLM tasks that produce artifacts
Skills currently call `window.CoachActions.addWidget()` / `createDoc()` (defined in
`coach-chat.jsx`) to write into the Workspace/Documents `localStorage` stores.

- `POST /api/skills/run` `{ skillId, roadmap, stepContext }`
- Returns the artifact to create: `{ target: "workspace|documents|chat", widget?, doc?, message }`

Replaces the hard-coded outputs in `coach-chat.jsx` → `SKILLS[].run()` and
`coach-skills.jsx` → `runSkill()`. The skill catalog is `canvas-data.js` →
`window.SKILL_LIBRARY`. User-created skills (`CreateSkillModal`) should `POST`
to a `/api/skills` create endpoint and be tuned server-side.

### 3.8 Insights — LLM summarization over chat history
- `GET /api/insights` → array shaped like `canvas-data.js` → `window.CHAT_INSIGHTS`
  (`{ id, title, icon, confidence, summary, bullets[], sources, quotes[], updatedMinutesAgo, pinned }`)
- `POST /api/insights/:id/pin`

Replaces the static `window.CHAT_INSIGHTS`. Consumed by `coach-views.jsx` →
`CoachInsights`. Generate by summarizing the stored conversations from §3.6.

### 3.9 Committee builder — faculty match
- `GET  /api/faculty/suggest?topic=...&institution=...` → suggested faculty (replaces `SUGGESTED`)
- `POST /api/faculty/score` `{ name, area, topic }` → `{ score, strengths: [...] }`

Replaces `coach-committee.jsx` → `mockScore()` / `mockStrengths()` / `SUGGESTED`.
Score = publication/topic overlap model or directory search (Perplexity over
department pages is acceptable, as noted in the file's `BACKEND:` comments).

### 3.10 Documents — storage + parsing
Today, uploads are parsed in the browser (`mammoth` for `.docx`, `FileReader`
for text, data-URL for PDF) and stored in `localStorage` — which caps size and
loses files across devices.

- `POST   /api/documents` (multipart) → store file, server-parse to text/preview
- `GET    /api/documents` / `GET /api/documents/:id`
- `PUT    /api/documents/:id` (edit body or template sections)
- `DELETE /api/documents/:id`

Replaces `coach-views.jsx` → `CoachDocuments` (`onUpload`, `create`, `del`, the
`store` object). Keep the `kind: pdf|docx|text` and template-`sections` shapes so
the editor UI is unchanged.

### 3.11 Workspace / tasks / tools persistence
- `GET/PUT /api/workspace` (the widget layout array)
- `GET/PUT /api/roadmap/progress` (completed subtask keys)
- `GET/PUT /api/tools/:toolKey` (notes, tasks, reading, bibliography, committee, pomodoro)

These replace the `phd-coach-workspace-v1`, `phd-coach-tasks-v1`, and `phd-tool-*`
localStorage keys. The tool components in `canvas-tools.jsx` all go through a
single `useStored(key, initial)` hook — swap that one hook to hit the API and
every tool becomes server-backed at once.

---

## 4. Suggested order of work

1. **Auth + `/api/me`** — gate the app on a real user; replace `MOCK_USER`.
2. **Persistence layer** — back the `localStorage` keys with DB tables per user
   (start with roadmap, progress, workspace, documents). Extend `public/coach-api.js`.
3. **Discovery + generation** (§3.2, §3.3) — the onboarding flow becomes real.
4. **Chat streaming** (§3.6) reusing existing `personas/` prompts.
5. **Replan + fork** (§3.4, §3.5) — the headline "living plan" feature.
6. **Skills + Insights + Committee + Documents parsing** (§3.7–§3.10).

Each step is independently shippable: the mocks stay as fallbacks until you flip
each integration point.

## 5. Notes / gotchas

- The prototype loads React, Babel, lucide, and mammoth from CDNs and compiles
  `.jsx` in the browser. For production, it already lives inside the CRA app (served statically from `public/`)
  next to v2 — promoting it to a bundled build later is a front-end task; the
  API contracts above are unaffected.
- All engine functions in `roadmap-engine.js` are pure and well-commented; read
  that file first — it is effectively the product spec for the backend.
- Keep response shapes byte-compatible with the mock outputs documented above and
  you will not need to touch any component.
