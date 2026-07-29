# PhD Navigator Backend

This directory contains the current FastAPI processing and account service for
PhD Navigator. It supports authenticated chat, plan generation, document
parsing and retrieval, meeting transcription and follow-up, Defense Room
simulation, source-aware insights, integrations, and the prototype's remaining
server synchronization paths.

For the product scope, privacy model, and full-stack setup, start with the
[repository README](../README.md).

## Backend responsibilities

The backend currently provides:

- authentication and account APIs;
- streaming, context-aware chat;
- program-material extraction and plan generation;
- document parsing, analysis, comparison, and retrieval;
- meeting agenda generation, transcription, summaries, and action extraction;
- simulated Defense Room questions and answer feedback;
- public academic profile lookup for optional topic emphasis;
- calendar, mail, and document integrations; and
- compatibility endpoints retained from earlier prototypes.

## Data boundary and privacy status

PhD Navigator's product requirement is to keep sensitive student context
device-local at rest by default. The backend should receive only the bounded
context needed for an AI operation explicitly requested by the student.

The current backend predates full enforcement of that requirement. Its storage
components should be read as implementation status, not the desired final
privacy architecture:

| Component | Current use |
| --- | --- |
| MongoDB | Accounts, authenticated chat sessions, and legacy/best-effort workspace and document synchronization |
| ChromaDB | Retrieval index for documents sent to server-side chat upload workflows |
| Browser storage | Primary product state for the plan, tools, meetings, local document copies, and Defense Room history |
| Configured LLM service | Processes the context included in chat, extraction, transcription, planning, and simulation requests |

Meeting recordings and Defense Room recordings are uploaded when the student
requests analysis. The API processes those payloads to produce structured
results; the resulting meeting record may still enter a legacy workspace sync
path from the current frontend. Signed-in document uploads are also currently
mirrored into the server library.

Removing implicit synchronization of sensitive meetings, transcripts,
documents, and plan state is remaining work. Do not characterize the current
prototype as fully local-only.

## Runtime components

- **FastAPI and Uvicorn** — HTTP endpoints and OpenAPI documentation
- **Gemini, Ollama, or OpenAI-compatible vLLM** — AI processing
- **MongoDB** — current account, chat, and compatibility persistence
- **ChromaDB** — current server-side retrieval index
- **Format-specific parsers** — PDF, Word, text, Markdown, HTML, JSON, CSV,
  XLSX, and PPTX
- **ffmpeg** — recording conversion for transcription workflows

```text
Browser-local student state
          │
          │ explicit AI request with bounded context
          ▼
FastAPI
  ├─ authentication / chat-session APIs
  ├─ document and recording parsing
  ├─ plan, meeting, chat, and simulation orchestration
  └─ configured AI provider
          │
          ▼
structured result returned to the browser
```

The current code also contains server-persistence paths described in
[Data boundary and privacy status](#data-boundary-and-privacy-status).

## Local setup

The CI matrix uses Python 3.10, 3.11, and 3.12.

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

On Windows:

```powershell
venv\Scripts\activate
```

Create `.env` in this directory:

```dotenv
CONFIG_PATH=../phd_config.yaml
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
JWT_SECRET_KEY=replace-with-a-long-random-value
GEMINI_API_KEY=your-gemini-api-key
CORS_ORIGINS=http://localhost:3000

# Optional
OLLAMA_BASE_URL=http://localhost:11434
VLLM_API_KEY=
```

Start the service:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open:

- API root: <http://localhost:8000>
- OpenAPI UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/openapi.json>

The current provider defaults to Gemini, so startup requires
`GEMINI_API_KEY`.

## Configuration

Configuration is modeled in [`app/config.py`](app/config.py) and normally
loaded from [`../phd_config.yaml`](../phd_config.yaml).

| Variable | Purpose |
| --- | --- |
| `CONFIG_PATH` | Application YAML path |
| `MONGODB_CONNECTION_STRING` | MongoDB connection URL used by the current backend |
| `JWT_SECRET_KEY` | JWT signing secret |
| `GEMINI_API_KEY` | Gemini API key |
| `OLLAMA_BASE_URL` | Ollama server |
| `VLLM_API_KEY` | Optional vLLM key |
| `CORS_ORIGINS` | Comma-separated browser origins |
| `CORS_ORIGIN_REGEX` | Additional allowed-origin regex |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google integration OAuth |
| `MS_OAUTH_CLIENT_ID` / `MS_OAUTH_CLIENT_SECRET` | Microsoft integration OAuth |
| `OAUTH_REDIRECT_BASE` | Public backend origin used for OAuth callbacks |

Model names and `mongodb.database_name` are YAML settings. The legacy
`GEMINI_MODEL`, `DEFAULT_PROVIDER`, and `MONGODB_DATABASE_NAME` environment
variables are not consumed by the current configuration loader.

Some configuration keys and internal model names remain from an earlier
advisory-panel implementation. They are compatibility details, not current
user-facing product concepts.

## AI providers

The provider manager exposes `gemini`, `ollama`, and `vllm`.

```http
GET /current-provider
POST /switch-provider
Content-Type: application/json

{"provider":"ollama"}
```

Related endpoints:

- `GET /current-model`
- `POST /switch-model`

Provider settings are under `llm` in the selected YAML configuration. The vLLM
client expects an OpenAI-compatible endpoint.

## API organization

Use `/docs` as the authoritative request and response reference. The main
current product route groups are:

| Area | Representative routes |
| --- | --- |
| Authentication | `/auth/signup`, `/auth/login`, `/auth/me` |
| Grounded chat | `/chat-stream` |
| Chat history | `/api/chat-sessions` |
| Program discovery | `/api/discover-deliverables` |
| Plan building | `/api/plan/base-template`, `/api/plan/generate`, `/api/plan/import`, `/api/plan/retrofit` |
| Documents | `/api/library/documents`, `/upload-document`, `/search-documents` |
| Meeting work | `/api/workspace/meeting/suggest`, `/api/workspace/meeting/actions`, `/api/workspace/meeting/analyze-recording` |
| Defense practice | `/api/defense/materials/parse`, `/api/defense/presentation/analyze`, `/api/defense/questions` |
| Insights | `/api/insights/brain` |
| Integrations | `/api/integrations/*` |
| Voice | `/voice/status`, `/voice/transcribe`, `/voice/tts` |
| Provider selection | `/current-provider`, `/switch-provider`, `/current-model` |

Additional compatibility routes remain registered and are visible in OpenAPI.
Their presence does not make them part of the current product scope.

## Grounding behavior

The chat frontend currently assembles bounded context from:

- the current, previous, and upcoming plan steps;
- uploaded or synchronized document references;
- recent meeting notes;
- tasks, deadlines, and recent plan activity; and
- the active conversation.

The backend retrieves relevant document passages when server-side indexed
content is available and returns grounding metadata for the UI's **Context
used** disclosure. Responses may also include assumptions and information to
verify.

Grounding is an evidence aid, not a correctness guarantee. Official program
requirements and deadlines must still be checked against university sources.

## Document pipeline

[`app/parsing/document_extractor.py`](app/parsing/document_extractor.py)
dispatches by MIME type and then filename extension:

```text
.pdf .doc .docx .txt .md .markdown .html .htm .json .csv .xlsx .pptx
```

The root chat-upload route enforces a 10 MB limit. Content sent to the current
server retrieval workflow is extracted, chunked, and indexed in ChromaDB.
Signed-in Documents-page uploads are currently mirrored into the MongoDB-backed
server library for analysis and comparison. That automatic mirror conflicts
with the local-only target and should become explicit or be removed.

## Meeting and Defense Room processing

Meeting recording analysis accepts audio, an agenda, a meeting title, and the
other participant's name. It returns a transcript, structured notes, a summary,
and proposed action items. These are AI interpretations and require student
review.

Defense Room endpoints:

- parse submitted materials or a slide deck;
- optionally analyze a practice recording and slide timing;
- generate a student-selected number of simulated questions;
- vary difficulty and selected areas of scrutiny;
- optionally use public academic information for topic emphasis; and
- provide feedback on practice answers.

Public profile information must never be represented as knowledge of what an
actual committee member asked, will ask, believes, or intends. Defense history
is practice evidence only.

## Source layout

| Directory | Responsibility |
| --- | --- |
| [`app/api`](app/api/README.md) | Route aggregation and endpoints |
| [`app/core`](app/core/README.md) | Authentication, sessions, database, and context |
| [`app/llm`](app/llm/README.md) | AI orchestration and provider clients |
| [`app/models`](app/models/README.md) | API and persistence models |
| [`app/parsing`](app/parsing) | Per-format document extraction |
| [`app/rag`](app/rag) | Server-side chunking and retrieval |
| [`app/tools`](app/tools) | Optional backend tools |
| [`app/utils`](app/utils/README.md) | Export, summary, icon, and file helpers |
| [`app/tests`](app/tests) | Unit and integration tests |
| [`tests`](tests) | Additional behavior and regression tests |

## Testing

Install test dependencies:

```bash
pip install -r requirements.txt -r test_requirements.txt
```

Run the CI unit-test directory:

```bash
pytest app/tests/unit/
```

Run the complete backend test tree:

```bash
pytest app/tests/ tests/
```

## Docker and deployment

- The root [`Dockerfile`](../Dockerfile) contains backend and frontend targets.
- [`docker-compose.yml`](../docker-compose.yml) starts the current backend,
  frontend, and MongoDB stack.
- [`Dockerfile.render`](../Dockerfile.render) is the slim backend-only Render
  image.
- The main backend Docker target installs `ffmpeg` for recording
  transcription.
- Current MongoDB and ChromaDB volumes are prototype persistence, not the
  desired sensitive-data architecture.
