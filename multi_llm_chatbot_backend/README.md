# Multi-LLM Chatbot Backend

A modular, extensible FastAPI backend for building an AI-powered research advisor chatbot that supports:
- Multiple AI personas with configurable tone and behavior
- Dynamic switching between Gemini (cloud) and Ollama (local) LLMs
- Chat session persistence and context memory
- Document upload, chunking, and retrieval using RAG
- Rich export features (PDF, DOCX, TXT)
- User authentication and JWT-based access control

---

## Backend Architecture

```text
User Input
   ↓
/chat-stream → Orchestrator
     ↓            ↙         ↘
  SessionManager   ContextManager   RAGManager
         ↓              ↓             ↓
     MongoDB        Token Trimming   ChromaDB
         ↓              ↓             ↓
        Persisted Chat & Doc Context → LLM (Gemini/Ollama)
```

---

## Features

- Persona-based multi-agent conversation (`Theorist`, `Pragmatist`, etc.)
- Provider switching (Gemini ↔ Ollama)
- Context-aware response routing + top-K advisor selection
- PDF, DOCX, and TXT file upload and semantic retrieval
- Developer tools: debug personas, test RAG, export sessions
- Secure authentication and session scoping

---

## Setup Instructions

### 1. Clone and Configure Environment

```bash
git clone https://github.com/yourorg/multi-llm-chatbot-backend
cd multi-llm-chatbot-backend
cp .env.example .env  # already provided
```

### 2. Python Environment Setup

```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows

pip install -r requirements.txt
```

### 3. Run the Server

```bash
uvicorn app.main:app --reload
```

> Server will be available at: `http://localhost:8000`

---

## FastAPI Routing & Modules

| Folder | Description |
|--------|-------------|
| [`app/api`](./api_README.md) | REST API endpoints for chat, auth, RAG, exports |
| [`app/core`](./core_README.md) | Main orchestration, context windows, database logic |
| [`app/llm`](./llm_README.md) | Gemini + Ollama LLM wrappers |
| [`app/models`](./models_README.md) | Persona and user schemas |
| [`app/utils`](./utils_README.md) | File parsing, summaries, exports, vector helpers |

---

## Key Files

### `main.py`

- Loads env vars, sets up FastAPI instance with CORS and routers
- Calls `connect_to_mongo()` on startup and `close_mongo_connection()` on shutdown
- Imports and registers all routers (`auth`, `chat_sessions`, etc.)

### `.env` (Sample Vars)

```ini
# MongoDB
MONGODB_CONNECTION_STRING=mongodb://localhost:27017
MONGODB_DATABASE_NAME=neon_ai_backend

# Gemini API Key and model
GEMINI_API_KEY=...  # Replace with real key
GEMINI_MODEL=gemini-2.0-flash

# Default provider
DEFAULT_PROVIDER=gemini
```

### `requirements.txt`

Includes:
- **FastAPI**, **Uvicorn**: API framework and server
- **httpx**: Async LLM request handler
- **motor**, **pymongo**: MongoDB async access
- **chromadb**, **sentence-transformers**: Vector database + embeddings
- **PyPDF2**, **docx2txt**, **reportlab**: Document parsing and PDF generation
- **passlib**, **python-jose**: Auth and security

---

## Persona Design & Context Handling

- Personas defined in `app/models/default_personas.py`
- Rich system prompts, styles, and epistemologies
- Responses routed through `ImprovedChatOrchestrator`
- Context trimmed and weighted via `ContextManager`

---

## Switching LLM Providers

You can hot-swap models via API:

```http
POST /switch-provider
{ "provider": "gemini" } | { "provider": "ollama" }
```

> Also supported: `/switch-model`, `/current-model`, `/current-provider`

---

## Document Upload + RAG

- Upload PDFs, DOCX, or TXT to sessions
- Text is extracted → chunked → embedded → stored in ChromaDB
- Queried during conversation by persona-aware `EnhancedRAGManager`

---

## Export Options

| Format | Export Endpoint |
|--------|------------------|
| PDF | `/export-chat?format=pdf` |
| DOCX | `/export-chat?format=docx` |
| TXT | `/export-chat?format=txt` |
| Summary | `/chat-summary?format=pdf` |

---

## Developer & Debug Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/debug/personas` | See registered advisors and prompts |
| `/debug/ranked-personas` | View top-K advisors for context |
| `/debug/rag-status` | Run sample search to test document index |

---

## Status & Roadmap

- [x] Multi-LLM backend ready (Gemini + Ollama)
- [x] Document RAG + export system
- [x] Session-aware persona routing
- [x] JWT Auth + MongoDB user handling
- [ ] UI enhancements and persona memory
- [ ] Persona fine-tuning support (future)

---

For questions, contributions, or deployment help — feel free to reach out!