# PhD Navigator

PhD Navigator is a student workspace for turning the complicated, often
implicit work of a PhD into a plan that can be inspected, updated, and acted
on. It brings program requirements, research materials, meetings, deadlines,
decisions, and practice work into one place, then uses AI to help the student
understand what matters and what to do next.

It is designed for doctoral students who need to:

- understand the formal requirements of their program;
- maintain an editable path from enrollment through graduation;
- prepare for and follow up on advisor or committee meetings;
- ask questions grounded in their own plan and materials;
- keep decisions, expectations, blockers, and deadlines visible; and
- rehearse a defense, poster session, or research talk.

PhD Navigator is a student support tool. It is not an institutional degree
audit, an official source of program policy, or a substitute for a student's
advisor, committee, graduate program, or university.

## Current product scope

The current product is organized around one student's PhD context and a single
grounded assistance experience.

- **Grounded AI assistance** — ask questions about your PhD plan, program
  requirements, documents, meetings, research work, and upcoming milestones.
- **A living PhD plan** — create a plan from program materials, edit milestones
  and tasks, track progress, and revise the plan when circumstances change.
- **Meeting memory and follow-up** — prepare agendas, capture notes or
  recordings, review transcripts and summaries, extract action items, and keep
  unresolved work visible.
- **Evidence-aware insights** — surface progress, decisions, advisor feedback,
  unresolved questions, blockers, expectations, deadlines, and proposed next
  steps from the records the student has supplied.
- **Defense practice** — rehearse with simulated questions grounded in the
  student's materials and chosen areas of scrutiny.
- **Document and source use** — keep handbooks, drafts, notes, forms, and
  supporting research available to the plan and chat experience.

## Core student workflows

### Onboarding and program materials

A student starts with their program, institution, academic stage, and research
area. They can then upload program handbooks, timelines, forms, advisor emails,
or other supporting files, or paste requirements directly from an email or web
page.

When materials are supplied, PhD Navigator sends them to the plan-discovery
workflow to:

- extract named milestones, gates, forms, and deadlines;
- preserve the source associated with each extracted requirement;
- distinguish requirements found in supplied materials from public web results
  or built-in templates;
- turn the extracted requirements into ordered plan steps and task lists; and
- add the supplied materials to Documents so they remain available after
  onboarding.

A student can also continue without uploading anything. In that case, the
application creates a standard template plan based on the available program
profile. The UI should label that plan as a template rather than imply that it
was extracted from an official handbook.

If the backend cannot read supplied materials, the application does not claim
that it did. It reports the failure or clearly degrades to a template that the
student must compare against official program sources.

### Editable PhD plan

The plan is the working spine of the site. Home summarizes current progress,
the next dated work, the current milestone, recent meetings, and selected
workspace tools. My Plan exposes the complete sequence and its underlying
tasks.

The generated plan is a starting point, not an authoritative degree audit. The
student can:

- rename, add, remove, and reorder plan sections;
- edit milestone titles, phases, objectives, estimates, notes, deliverables,
  sources, and task lists;
- mark work complete and see the current and upcoming work;
- expand an individual task and request a contextual “How do I do this?”
  walkthrough;
- open a milestone-focused workspace and turn its tasks into a working board;
- import plan data from CSV;
- describe a setback in plain language and add a recovery step or reopen
  affected work;
- move selected meeting action items into the current plan.

Plan progress is calculated from explicit milestone statuses and checked tasks.
The plan can be backed up through the current workspace API, but the browser
copy remains the primary working state in the prototype.

Student review is the approval boundary. AI-derived suggestions should not
silently change the plan or be represented as approved advisor decisions.

### Grounded chat

Chat is a single assistance experience connected to the rest of the student's
workspace. It is intended to answer one question using the smallest relevant
set of available context:

- the current, previous, and upcoming plan steps;
- program requirements and uploaded documents;
- recent meeting notes and selected action items;
- tasks, deadlines, and recent plan activity; and
- the current conversation.

Students can start a new conversation, reopen saved conversations, attach
documents, ask about the current milestone, or carry a Defense Room question
into chat for a deeper debrief. Responses stream into the page as they are
generated.

When documents are attached, the current backend extracts and indexes them for
retrieval within that chat session. The response can expose a **Context used**
section containing:

- plan items and their recorded statuses;
- document names and available page, slide, or section locations;
- meeting-note references;
- assumptions made while answering; and
- information the student should verify.

The student can open a referenced document from the grounding details when the
corresponding local or server library record is available. Saved chat sessions
are currently persisted by the authenticated backend, while the browser also
maintains a local conversation representation.

If the backend is unavailable, the interface can return a clearly identified
offline demonstration response. That fallback is not equivalent to grounded
model output. Grounding reduces unsupported claims; it does not make AI output
automatically correct.

### Meeting notes and follow-up

Meeting Notes connects preparation, capture, and follow-through rather than
treating a meeting as a single text field.

Before a meeting, the student can:

- draft an agenda manually or ask the backend to suggest one using the current
  milestone, open tasks, participant, prior notes, and stated focus;
- set a date, time, and optional recurrence;
- choose a preferred meeting cadence and receive an overdue reminder; and
- create a Google Calendar or Outlook event with the agenda in its description.

During or after a meeting, the student can paste notes, record in the browser,
or upload an audio file. With an audio-capable provider—currently Gemini—the
backend can return a readable transcript, organized notes, a short summary, and
proposed action items. The original notes and transcript remain available for
comparison.

After review, the student can mark action items complete or explicitly send the
open items to the current plan's to-do list. Meeting summaries, transcripts,
and action items are also available to later chat and Insight workflows under
the current synchronization model.

Meeting-derived context should distinguish among:

- decisions that were actually recorded;
- advisor or committee feedback;
- unresolved questions;
- blockers and risks;
- expectations and deadlines;
- extracted tasks; and
- proposed plan changes that still require student approval.

An AI summary is an interpretation of the supplied record. It is not an
official meeting record and should be checked against the original notes or
transcript.

### Insights

Insights is an evidence-aware review of what may deserve attention now. It can
surface plan progress, an approaching or overdue deadline, meeting cadence,
document activity, recorded decisions or blockers, unresolved questions,
source-grounded quotes, and possible next actions.

Generation has two deliberately separate layers:

1. Code builds every eligible candidate and computes its dates, counts,
   percentages, trends, and evidence references from plan state, deadlines,
   meeting metadata, documents, chat activity, and accumulated context.
2. The AI ranks those candidates, selects four metrics and four content blocks,
   writes the headline, and explains why the selected items matter. It is
   instructed not to invent numerical values.

Opening a card shows its rank, selection reason, and supporting records. When
more candidates exist, a student can set aside an unhelpful card and show the
next ranked item. If evidence is thin, the page should make fewer claims rather
than manufacture a pattern.

The current backend caches a signed-in composition for up to 20 hours and
recomposes automatically when accumulated server knowledge is newer. A
browser-only change may not invalidate that cache immediately. Without the
endpoint, the browser can still show a smaller fallback based on local plan,
task, deadline, meeting, and document counts.

An Insight is a prompt to review evidence, not an official finding or approval.
It does not change the plan automatically. Students should compare it with the
underlying plan item, meeting record, deadline, or document and correct stale
or incomplete source data.

### Defense Room

Defense Room runs a structured, simulated practice session for a dissertation
defense, poster presentation, or research talk.

#### 1. Choose the session type

The student starts in one of two modes:

- **Present, then answer questions** — rehearse the presentation first, then
  receive follow-up questions based on the uploaded materials and, when
  recorded, the practice delivery.
- **Practice questions only** — skip the presentation and move directly into
  questions grounded in the uploaded materials.

The selected format changes the default question set and scrutiny:

- a dissertation defense emphasizes framing, theory, methods, evidence,
  robustness, contribution, limitations, application, and future work;
- a poster session emphasizes the short explanation, methods at a glance,
  results, significance, and visual communication; and
- a research talk emphasizes motivation, clarity, novelty, evidence,
  generalization, implications, and next steps.

#### 2. Supply the grounding materials

Every session requires at least one primary material: a slide deck,
dissertation draft, paper, poster, or other readable research artifact.
Supporting notes, appendices, references, and related papers are optional.

The system labels files as primary or supporting and attempts to parse them
before the session begins. PowerPoint decks use their parsed slide count; a PDF
used as a deck uses the page count selected by the student. The material—not a
generic script—is intended to anchor the questions.

#### 3. Configure the practice

The student controls:

- the number of practice or follow-up questions, from 1 to 12;
- supportive, standard, or rigorous difficulty;
- free-text focus areas such as methods, clarity, weak points, or material that
  may need to be cut;
- for a presentation, the target duration and whether to record nothing,
  audio only, or camera and microphone;
- for a defense, selected scrutiny areas such as theory, methods, evidence,
  alternative explanations, contribution, limitations, or application;
- for a poster or talk, the audience's familiarity and interests; and
- whether questions should be read aloud.

The student can optionally select up to six public academic profiles. The
profile service gathers documented public academic information and uses it only
to emphasize relevant subject areas. A selected profile is a topic lens, not a
simulation of that person.

#### 4. Run the presentation

In presentation mode, Defense Room displays the parsed deck one slide or page
at a time. It records the time spent on each slide even when recording is
disabled. When audio or camera capture is enabled, the browser records the
practice for analysis and later local playback.

At the end of the talk, the current backend can analyze:

- the uploaded deck and supporting materials;
- slide text and speaker notes;
- time spent per slide;
- the selected format, audience, and target duration; and
- the recorded delivery when a recording was requested.

That analysis can return a transcript, delivery observations, presentation
feedback, and a grounded material summary. Follow-up questions are then
generated from the combined presentation record. If recording analysis fails,
the session can continue using the readable deck material and slide timing.

#### 5. Answer the simulated questions

Questions are shown one at a time with their focus tag and source lens. The
student can:

- hear the question aloud;
- type an answer or use browser speech recognition to dictate it;
- skip a question;
- end the session early; or
- continue until the requested set is complete.

The log records the question, focus tag, answer, whether voice input was used,
and the public-profile topic influence when applicable.

#### 6. Review feedback and history

After the session, the report can include:

- total presentation time compared with the target;
- average time and individual timing for each slide;
- local playback of the recorded talk;
- presentation and delivery observations;
- questions faced, answered, and skipped;
- average answer length;
- focus areas the student skipped;
- a strong, okay, or needs-work assessment with a short note for each answer;
  and
- actions to take an individual question or the overall debrief into chat.

Completed report data is saved automatically in browser `localStorage`.
Recordings are saved in IndexedDB because they are too large for
`localStorage`. Defense Room History is a local archive of practice reports and
available recordings; reports and recordings can be reviewed or deleted.

#### Simulation and fallback boundaries

Questions are generated from the submitted materials, selected focus,
difficulty, audience settings, and optional public academic information.
Generated questions are simulations:

- they are not statements from real committee members;
- they are not evidence of what a committee member previously asked;
- prior Defense Room history contains practice sessions, not real committee
  interactions; and
- changing a lens or difficulty changes the focus of the simulation, not the
  beliefs or intentions of a real person.

If the question service is unavailable, Defense Room can create a clearly
labeled offline practice set on the device using the selected scrutiny areas
and claim-like sentences found in readable uploaded material. Offline
questions must not be presented as backend-grounded or public-profile-informed
questions. They keep practice possible, but they are a reduced fallback.

### Documents and source use

Documents is the shared source shelf for files added during onboarding, chat,
meeting tools, or direct upload. Students can search, filter, and sort the
combined local and server-visible library, then open an individual file for
preview.

The browser can:

- render PDFs and formatted Word documents;
- extract text for preview and local use;
- retain the original file when browser storage allows;
- show word counts and basic file metadata;
- download the original;
- hand extracted content to Google Docs, Word, or Overleaf; and
- keep locally created or tool-generated notes alongside uploaded files.

For signed-in users, the current server library can:

- parse and retain extracted document text;
- generate a summary and topic list;
- follow supported links found in the document and record takeaways;
- compare a newer upload with an earlier version of the same work;
- re-run analysis on demand; and
- expose the document to grounded chat retrieval.

The backend parser currently recognizes:

```text
.pdf .doc .docx .txt .md .markdown .html .htm .json .csv .xlsx .pptx
```

Server-side chat uploads are limited to 10 MB per file. The current frontend
mirrors signed-in uploads into the server library automatically; that behavior
is documented as a privacy gap rather than the intended local-only design.

## Data and privacy

The product requirement is **local-only storage for sensitive student
context by default**, especially meeting recordings, transcripts,
meeting-derived context, research documents, and plan state.

Local-only storage describes where data is retained. It does not mean that AI
processing happens entirely on the device. When a student explicitly requests
transcription, analysis, grounded chat, plan generation, or Defense Room
questions, the context required for that request may be sent to the configured
backend and LLM provider. The UI should make that processing boundary clear and
send only the context needed for the requested action.

### Current implementation status

The current prototype is local-first, but it does **not yet fully enforce** the
local-only requirement:

| Data | Current behavior |
| --- | --- |
| Plan, progress, preferences, tools | Stored in per-account browser `localStorage`; plan and workspace sections also have best-effort backend backup paths |
| Meeting notes and transcripts | Stored in the browser first; recordings are sent to the API when transcription is requested, and completed meeting records currently have a backend synchronization path |
| Local document copies | Stored in the browser; signed-in uploads are currently mirrored into the server document library for AI retrieval |
| Defense practice reports | Stored in browser `localStorage`; large recordings are stored in IndexedDB and may be sent to the API when analysis is requested |
| Chat conversations | Cached in the browser and currently persisted as authenticated backend chat sessions |
| Insights compositions | Currently generated and cached in the backend `insights_brain` collection; local-only browser changes do not always invalidate that cache immediately |
| Account records | Stored by the backend in MongoDB |
| Server retrieval index | ChromaDB is currently used only for content sent to server-side document retrieval workflows |

MongoDB and ChromaDB should therefore be understood as parts of the current
prototype backend, not as the intended default home for sensitive student
context. Removing implicit meeting, document, and plan synchronization is
remaining privacy work.

Do not use the current deployment for sensitive or regulated research data
until its storage, retention, deletion, access-control, and third-party model
processing behavior have been reviewed for the intended institution and use
case.

## Current limitations

- The local-only privacy model is not fully implemented; see
  [Data and privacy](#data-and-privacy).
- Program requirements, policies, dates, and forms can change. Students must
  verify them against official university sources.
- AI extraction can omit, merge, or misinterpret requirements, meeting content,
  and document details.
- Insights can be stale when a change exists only in browser storage and the
  current backend composition cache has not been invalidated.
- Meeting summaries and action items require review against the original
  record.
- Defense Room questions are simulated and cannot predict a real committee.
- Public academic profiles may be incomplete, ambiguous, or outdated.
- Offline fallbacks keep parts of the UI usable, but AI generation and
  authenticated synchronization require the backend.
- The frontend loads React, Babel, and several supporting libraries from CDNs,
  so a fully disconnected local launch is not currently supported.
- Some internal route, model, and configuration names are inherited from
  earlier prototypes and do not represent the current product language.

## Architecture

### Verified frontend architecture

The active frontend is the static application in
[`phd-advisor-frontend/public`](phd-advisor-frontend/public):

- [`public/index.html`](phd-advisor-frontend/public/index.html) is the runtime
  entry point.
- React 18.3.1 and ReactDOM 18.3.1 are loaded from CDN scripts.
- JSX files are compiled in the browser by Babel.
- The `coach-*.jsx` modules implement the active pages and workflows.
- [`public/coach-api.js`](phd-advisor-frontend/public/coach-api.js) is the
  browser-to-backend data layer.
- [`src/index.js`](phd-advisor-frontend/src/index.js) is intentionally a no-op
  retained only for the `react-scripts` development server.

Although `package.json` contains React 19 dependencies, those packages do not
mount the active application. The live site uses the React 18 CDN scripts
declared in `public/index.html`.

### Backend role

The backend in
[`multi_llm_chatbot_backend`](multi_llm_chatbot_backend) currently provides:

- FastAPI endpoints for authentication and AI-assisted operations;
- Gemini, Ollama, and OpenAI-compatible vLLM clients;
- transcription, document parsing, plan generation, grounded chat, source
  retrieval, and Defense Room processing;
- MongoDB-backed accounts, chat sessions, and legacy synchronization paths;
  and
- ChromaDB retrieval for documents explicitly sent to server-side workflows.

The backend should be treated as a processing boundary. The product direction
is to keep sensitive student context on the device at rest and transmit bounded
context only when the student requests an AI operation.

## Run locally with Docker

### Prerequisites

- Docker with the Compose plugin
- A Gemini API key, because Gemini is the current startup provider

### 1. Clone the repository

```bash
git clone https://github.com/Ryan-Venturi1/CCAI-Demo-CU-Team.git
cd CCAI-Demo-CU-Team
```

### 2. Create `.env` in the repository root

```dotenv
GEMINI_API_KEY=your-gemini-api-key
JWT_SECRET_KEY=replace-with-a-long-random-value

# Optional
VLLM_API_KEY=
CORS_ORIGINS=http://localhost:3000
```

### 3. Start the stack

```bash
docker compose up --build
```

Open:

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:8000>
- OpenAPI documentation: <http://localhost:8000/docs>

Compose starts the frontend, FastAPI backend, and MongoDB 8. The current
Compose stack also creates named MongoDB and ChromaDB volumes. Those volumes
reflect the prototype's remaining server-persistence paths described above.

## Development setup

### Prerequisites

- Python 3.10–3.12, matching the CI matrix
- Node.js and npm; the main Dockerfile currently uses Node 24
- MongoDB for the current authenticated backend
- `ffmpeg` when using voice or recording transcription
- a Gemini key, a running Ollama server, or a configured vLLM endpoint

### Backend

```bash
cd multi_llm_chatbot_backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

On Windows:

```powershell
venv\Scripts\activate
```

Create `multi_llm_chatbot_backend/.env`:

```dotenv
CONFIG_PATH=../phd_config.yaml
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
JWT_SECRET_KEY=replace-with-a-long-random-value
GEMINI_API_KEY=your-gemini-api-key
CORS_ORIGINS=http://localhost:3000

# Optional provider settings
OLLAMA_BASE_URL=http://localhost:11434
VLLM_API_KEY=
```

Start the API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend currently starts with Gemini. After startup, a local Ollama
instance can be selected with:

```bash
ollama pull llama3.2:1b

curl -X POST http://localhost:8000/switch-provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"ollama"}'
```

Valid provider names are `gemini`, `ollama`, and `vllm`.

### Frontend

In another terminal:

```bash
cd phd-advisor-frontend
npm install
npm start
```

Open <http://localhost:3000>. The frontend probes
`http://localhost:8000` and falls back to the deployed API for supported calls
when a local API is unavailable. Browser `localStorage["phd-api-base"]` can
override the API origin.

## Repository structure

```text
.
├── phd_config.yaml
├── multi_llm_chatbot_backend/
│   ├── app/
│   │   ├── api/routes/             # FastAPI feature endpoints
│   │   ├── core/                   # Auth, sessions, context, and persistence
│   │   ├── llm/                    # AI orchestration and provider clients
│   │   ├── models/                 # API and persistence models
│   │   ├── parsing/                # Format-specific document parsers
│   │   ├── rag/                    # Server-side chunking and retrieval
│   │   ├── tools/                  # Optional backend tools
│   │   └── utils/                  # Export, summary, and file helpers
│   ├── tests/
│   ├── requirements.txt
│   └── test_requirements.txt
├── phd-advisor-frontend/
│   ├── public/                     # Active static React application
│   ├── src/index.js                # No-op react-scripts entry
│   └── package.json
├── Dockerfile
├── Dockerfile.render
├── docker-compose.yml
├── render.yaml
└── vercel.json
```

## Testing

Install and run the backend unit-test suite used by CI:

```bash
cd multi_llm_chatbot_backend
pip install -r requirements.txt -r test_requirements.txt
pytest app/tests/unit/
```

Run all backend test directories:

```bash
pytest app/tests/ tests/
```

The frontend currently has no automated test files. Verify the deployable
static bundle with:

```bash
cd phd-advisor-frontend
npm run build
```

## Detailed backend documentation

- [Backend implementation guide](multi_llm_chatbot_backend/README.md)
- [Interactive OpenAPI documentation](http://localhost:8000/docs) when the
  backend is running
- [Changelog](CHANGELOG.md)

## Copyright

© 2026 University of Colorado Boulder. All rights reserved.

This project is developed and maintained by the University of Colorado Boulder
for academic and research purposes.
