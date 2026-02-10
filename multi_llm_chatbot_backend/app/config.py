"""
Centralised application configuration.

Reads ``config.yaml`` from the project root (two levels above this file) and
validates it with Pydantic models.  Every setting falls back to environment
variables when the YAML value is empty, so existing ``.env`` workflows keep
working.
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import List, Optional

import yaml
from pydantic import BaseModel, validator, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class FeatureConfig(BaseModel):
    title: str = ""
    description: str = ""
    icon: str = "HelpCircle"


class AppConfig(BaseModel):
    title: str = "Advisor Canvas"
    subtitle: str = "AI-Powered Guidance"
    primary_color: str = "#7C3AED"
    footer_text: str = ""


class HomepageConfig(BaseModel):
    headline_prefix: str = "Get Guidance from"
    headline_highlight: str = "Advisor Personas"
    description: str = ""
    features_title: str = "Why Choose Our Advisory Panel?"
    features: List[FeatureConfig] = []


class AcademicStage(BaseModel):
    value: str = ""
    label: str = ""


class LoginConfig(BaseModel):
    subtitle: str = "Sign in to continue"
    signup_subtitle: str = "Create your account to get personalized guidance from expert advisors"
    academic_stages: List[AcademicStage] = []


class ExampleCategory(BaseModel):
    title: str
    icon: str = "BookOpen"
    color: str = "#3B82F6"
    bg_color: str = "#EFF6FF"
    suggestions: List[str] = []


class ChatPageConfig(BaseModel):
    placeholder: str = "Ask your advisors anything..."
    examples: List[ExampleCategory] = []


class PersonaItemConfig(BaseModel):
    id: str
    name: str
    role: str = ""
    summary: str = ""
    color: str = "#6B7280"
    bg_color: str = "#F3F4F6"
    dark_color: str = "#9CA3AF"
    dark_bg_color: str = "#374151"
    icon: str = "HelpCircle"
    temperature: int = 5
    persona_prompt: str = ""


class PersonasConfig(BaseModel):
    base_prompt: str = ""
    items: List[PersonaItemConfig] = []


class OrchestratorConfig(BaseModel):
    vague_patterns: List[str] = []
    min_words_without_keywords: int = 6
    specific_keywords: List[str] = []
    clarification_questions: List[str] = []
    clarification_suggestions: List[str] = []


class AuthConfig(BaseModel):
    jwt_secret: str = ""
    algorithm: str = "HS256"
    token_expiry_minutes: int = 43200  # 30 days

    @validator("jwt_secret", always=True)
    def _fallback_jwt_secret(cls, v: str) -> str:  # noqa: N805
        return v or os.getenv(
            "JWT_SECRET_KEY",
            "your-secret-key-change-this-in-production",
        )


class MongoDBConfig(BaseModel):
    connection_string: str = ""
    database_name: str = "phd_advisor"

    @validator("connection_string", always=True)
    def _fallback_connection_string(cls, v: str) -> str:  # noqa: N805
        return v or os.getenv("MONGODB_CONNECTION_STRING", "")


class GeminiConfig(BaseModel):
    api_key: str = ""
    model: str = "gemini-2.0-flash"

    @validator("api_key", always=True)
    def _fallback_api_key(cls, v: str) -> str:  # noqa: N805
        return v or os.getenv("GEMINI_API_KEY", "")


class OllamaConfig(BaseModel):
    model: str = "llama3.2:1b"
    base_url: str = "http://localhost:11434"

    @validator("base_url", always=True)
    def _fallback_base_url(cls, v: str) -> str:  # noqa: N805
        return v or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


class LLMConfig(BaseModel):
    gemini: GeminiConfig = GeminiConfig()
    ollama: OllamaConfig = OllamaConfig()


class RAGConfig(BaseModel):
    embedding_model: str = "all-MiniLM-L6-v2"
    chroma_collection: str = "phd_advisor_documents"


class AppSettings(BaseModel):
    """Top-level container that mirrors the YAML structure."""
    app: AppConfig = AppConfig()
    homepage: HomepageConfig = HomepageConfig()
    login: LoginConfig = LoginConfig()
    chat_page: ChatPageConfig = ChatPageConfig()
    personas: PersonasConfig = PersonasConfig()
    orchestrator: OrchestratorConfig = OrchestratorConfig()
    auth: AuthConfig = AuthConfig()
    mongodb: MongoDBConfig = MongoDBConfig()
    llm: LLMConfig = LLMConfig()
    rag: RAGConfig = RAGConfig()

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    def get_public_config(self) -> dict:
        """Return the subset of configuration safe to expose to the frontend
        via ``GET /api/config``.  Secrets are excluded."""
        return {
            "app": self.app.dict(),
            "homepage": self.homepage.dict(),
            "login": self.login.dict(),
            "chat_page": self.chat_page.dict(),
            "personas": {
                "items": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "role": p.role,
                        "summary": p.summary,
                        "color": p.color,
                        "bg_color": p.bg_color,
                        "dark_color": p.dark_color,
                        "dark_bg_color": p.dark_bg_color,
                        "icon": p.icon,
                    }
                    for p in self.personas.items
                ],
            },
        }


# ---------------------------------------------------------------------------
# Singleton loader
# ---------------------------------------------------------------------------

_settings: Optional[AppSettings] = None


def _find_config_yaml() -> Path:
    """Walk upwards from this file to find ``config.yaml``."""
    current = Path(__file__).resolve().parent  # app/
    for _ in range(5):
        candidate = current / "config.yaml"
        if candidate.exists():
            return candidate
        current = current.parent
    # Fallback: project root relative to workspace
    return Path(__file__).resolve().parent.parent.parent / "config.yaml"


def load_settings(config_path: Optional[str] = None) -> AppSettings:
    """Load and validate ``config.yaml``, returning an ``AppSettings`` object.

    The result is cached as a module-level singleton so subsequent calls are
    free.  Pass *config_path* to override the auto-detected location (useful
    for tests).
    """
    global _settings
    if _settings is not None:
        return _settings

    path = Path(config_path) if config_path else _find_config_yaml()
    if path.exists():
        logger.info("Loading configuration from %s", path)
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}
    else:
        logger.warning(
            "config.yaml not found at %s — using defaults + env vars", path
        )
        raw = {}

    _settings = AppSettings(**raw)
    logger.info("Configuration loaded: app.title=%r", _settings.app.title)
    return _settings


def get_settings() -> AppSettings:
    """Return the cached settings singleton (loads on first call)."""
    return load_settings()
