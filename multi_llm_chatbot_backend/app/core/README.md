# `app/core` – Application Core Logic

This is the **central brain** of the multi-LLM chatbot system. It orchestrates user interaction, persona logic, context management, document-based retrieval (RAG), session tracking, authentication, and initialization.

---

## Overview of Modules

| Module | Responsibility |
|--------|----------------|
| `auth.py` | Authentication (JWT, password hashing, user resolution) |
| `bootstrap.py` | System startup logic: loads LLMs, personas, orchestrators |
| `context.py` | Global per-session context (simplified storage) |
| `context_manager.py` | Core context formatting & windowing for Gemini/Ollama |
| `database.py` | MongoDB connection & index management |
| `improved_orchestrator.py` | Main message routing engine: document-aware, multi-persona orchestrator |
| `rag_manager.py` | RAG with ChromaDB: chunking, storage, semantic search |
| `session_manager.py` | Full chat lifecycle tracker (in-memory) with RAG hooks |

---

## `auth.py` – Authentication System

Handles secure authentication via:
- Bcrypt hashing (`passlib`)
- JWT creation and validation (`python-jose`)
- Secure route access using FastAPI’s `Depends`

### Functions

- `get_password_hash(password)` – Hash password using bcrypt
- `verify_password(plain, hashed)` – Verify password
- `create_access_token(data)` – Return JWT (30-day expiry default)
- `get_current_user()` – Decodes token and returns `User` model
- `authenticate_user(email, password)` – Checks login credentials
- `create_user_response(user)` – Returns `UserResponse` for frontend

---

## `bootstrap.py` – System Bootstrap

Runs once on app startup to:
- Determine the default LLM provider (Gemini or Ollama)
- Initialize `ImprovedChatOrchestrator`
- Inject personas using `get_default_personas(llm)`

```python
llm = create_llm_client()  # Gemini or Ollama
chat_orchestrator = ImprovedChatOrchestrator()
DEFAULT_PERSONAS = get_default_personas(llm)
```

Each persona is **registered** into the orchestrator using `.register_persona()`.

---

## `context.py` – Global Per-Session Context

A basic context storage class (`GlobalSessionContext`) that keeps:
- `full_log`: List of all messages
- `uploaded_files`: Tracked files per session
- `total_upload_size`: Helps enforce limits

Used primarily in earlier versions or smaller contexts.

---

## `context_manager.py` – LLM Context Window Formatter

This class builds optimized context windows for both Gemini and Ollama:

### `ContextManager.prepare_context_for_llm()`
Returns a `ContextWindow(messages, token_count, truncated)` with:
- LLM-specific formatting
- Automatic message pruning based on token limits
- Recency- and relevance-weighted scoring for old messages
- Automatic stop tokens, system prompts, and formatting

### Key Features

| Feature | Gemini | Ollama |
|--------|--------|--------|
| Format | JSON roles + parts | Flat prompt string |
| Role Mapping | 'user', 'model' | 'User:', 'Assistant:' |
| Chunking Strategy | Full doc as `Context Document:` | Plain text injection |
| Stop Sequences | Customizable | Enforced via `stop[]` |

Used **by all LLM clients** (Ollama/Gemini) and the **orchestrator**.

---

## `database.py` – MongoDB Connector

- Uses `motor` for async MongoDB
- Exposes `get_database()` to other modules
- Automatically creates indexes on `users` and `chat_sessions`
- Controlled via `.env` (`MONGODB_CONNECTION_STRING`)

```python
await connect_to_mongo()
await close_mongo_connection()
```

---

## `improved_orchestrator.py` – Brain of the Chatbot

This is the main **message routing engine**.

### Main Responsibilities

- Route user input through:
  - Clarification detection
  - Document-aware context building
  - Persona-level response generation
- Aggregate responses from **multiple advisors**
- Embed document-based context (RAG)

### Key Functions

- `process_message()` – Entry point for chat flow (calls all advisors)
- `chat_with_persona()` – Talk to one specific advisor
- `_generate_persona_responses()` – Routes through each registered persona
- `_build_enhanced_context_for_persona()` – Combines conversation + document info

### Extras
- Document parsing hints (`"my thesis"`, `"section 2"`, etc.)
- Top-K persona ranking (`get_top_personas()`)
- Persona-specific fallback logic
- Session reset/deletion

Used by `/chat-stream`, `/reply-to-advisor`, etc.

---

## `rag_manager.py` – RAG System for Docs

Supports **vector-based retrieval** using:

- Sentence Transformers (`all-MiniLM-L6-v2`)
- ChromaDB (`PersistentClient` with metadata)
- Metadata-aware enhanced chunking
- Overlapping token window strategy
- Section-wise classification

### Core Components

| Class | Role |
|-------|------|
| `RAGManager` | Standard chunking, basic RAG |
| `EnhancedRAGManager` | Persona-aware + metadata-annotated vector chunks |

### `EnhancedRAGManager` supports:
- Section tagging (`methodology`, `theory`, etc.)
- Multi-level filters (`session_id`, `filename`)
- Attribution fields (`chunk_position`, `has_methodology`)
- Relevance scoring and ranking

Used by orchestrator when generating document-aware responses.

---

## `session_manager.py` – Chat Lifecycle Controller

Handles:
- In-memory session creation + cleanup (with expiration)
- Tracks uploaded files and size
- Holds message logs for each session
- Links to RAG via `add_uploaded_file()` and `get_rag_stats()`

### `ConversationContext`

| Attribute | Description |
|-----------|-------------|
| `messages` | List of role-message entries |
| `uploaded_files` | Filenames (content stored in RAG DB) |
| `document_chunks_count` | Count of indexed doc chunks |
| `last_retrieval_stats` | From last RAG search |
| `created_at`, `last_accessed` | Session activity tracking |

Includes:
- Reset functions (`clear_all_data()`)
- File-level message logging (`append_message()`)

### `SessionManager`

- Thread-safe via locks
- Handles cleanup of expired sessions (`_cleanup_expired_sessions()`)
- Returns statistics via `get_session_stats()`

---

## Interactions Summary

```text
User Input → Orchestrator
             ↳ SessionManager → Context
             ↳ RAGManager → Relevant Docs
             ↳ LLMClient (Gemini/Ollama) ← ContextManager
```