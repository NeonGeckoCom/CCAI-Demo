"""
Centralized application configuration.

Reads ``config.yaml`` from the project root (two levels above this file) and
validates it with Pydantic models.  Every setting falls back to environment
variables when the YAML value is empty, so existing ``.env`` workflows keep
working.
"""

import os
import logging
from pathlib import Path
from typing import List, Optional

import yaml
from pydantic import BaseModel, validator, Field, model_validator

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
    enabled: bool = True
    role: str = ""
    summary: str = ""
    color: str = "#6B7280"
    bg_color: str = "#F3F4F6"
    dark_color: str = "#9CA3AF"
    dark_bg_color: str = "#374151"
    icon: str = "HelpCircle"
    temperature: int = 5
    persona_prompt: str = ""

    def to_frontend_config(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "summary": self.summary,
            "color": self.color,
            "bg_color": self.bg_color,
            "dark_color": self.dark_color,
            "dark_bg_color": self.dark_bg_color,
            "icon": self.icon
            }


class PersonasConfig(BaseModel):
    base_prompt: str = ""
    personas_dir: str = ""
    items: List[PersonaItemConfig] = []

    @model_validator(mode='after')
    def _load_personas_from_directory(self):
        if self.personas_dir:
            loaded = load_personas_from_dir(self.personas_dir)
            if loaded:
                self.items = loaded
        return self


class OrchestratorConfig(BaseModel):
    min_words_without_keywords: int = 6
    specific_keywords: List[str] = []
    clarification_questions: List[str] = []
    clarification_suggestions: List[str] = []


class AuthConfig(BaseModel):
    jwt_secret: str = Field(default=os.getenv("JWT_SECRET_KEY", ""))
    algorithm: str = "HS256"
    token_expiry_minutes: int = 43200  # 30 days

    @model_validator(mode="after")
    def _validate_jwt_secret(self):
        if not self.jwt_secret:
            logger.warning(
                    "Insecure default JWT secret will be used. "
                    "Set auth.jwt_secret in config.yaml for production use.")
            self.jwt_secret = "your-secret-key-change-me"
        return self


class MongoDBConfig(BaseModel):
    connection_string: str = Field(default=os.getenv("MONGODB_CONNECTION_STRING")) 
    database_name: str = "phd_advisor"

    @model_validator(mode="after")
    def _warn_connection_envvar(self):
        if os.getenv("MONGODB_CONNECTION_STRING"):
            if self.connection_string != os.getenv("MONGODB_CONNECTION_STRING"):
                logger.warning(
                    "MONGODB_CONNECTION_STRING envvar is overridden in "
                    "config.yaml"
                )
            else:
                logger.warning(
                    "MongoDB connection string not set in config.yaml. "
                    "Falling back to MONGODB_CONNECTION_STRING envvar."
                )
        return self


class GeminiConfig(BaseModel):
    api_key: str = Field(default=os.getenv("GEMINI_API_KEY"))
    model: str = "gemini-2.0-flash"

    @model_validator(mode="after")
    def _warn_gemini_envvar(self):
        if os.getenv("GEMINI_API_KEY"):
            if self.api_key != os.getenv("GEMINI_API_KEY"):
                logger.warning(
                    "GEMINI_API_KEY envvar is overridden in config.yaml"
                )
            else:
                logger.warning(
                    "Gemini API key not set in config.yaml. "
                    "Falling back to GEMINI_API_KEY environment variable."
                )
        return self


class OllamaConfig(BaseModel):
    model: str = "llama3.2:1b"
    # TODO: Drop support for `OLLAMA_BASE_URL` envvar handling
    base_url: str = Field(default=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"))


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

    def get_frontend_config(self) -> dict:
        """Return the subset of configuration safe to expose to the frontend
        via ``GET /api/config``.  Secrets are excluded."""
        return {
            "app": self.app.dict(),
            "homepage": self.homepage.dict(),
            "login": self.login.dict(),
            "chat_page": self.chat_page.dict(),
            "personas": {
                "items": [p.to_frontend_config() for p in self.personas.items],
            },
        }


# ---------------------------------------------------------------------------
# Singleton loader
# ---------------------------------------------------------------------------

_settings: Optional[AppSettings] = None


def load_settings(config_path: Optional[str] = None) -> AppSettings:
    """Load and validate ``config.yaml``, returning an ``AppSettings`` object.

    The result is cached as a module-level singleton so subsequent calls are
    free.  Pass *config_path* to override the auto-detected location (useful
    for tests).
    """
    global _settings
    if _settings is not None:
        return _settings

    config_path = config_path or os.getenv("CONFIG_PATH")
    if not config_path:
        logger.warning("No CONFIG_PATH specified. Using default values")
        raw = {}
    else:
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found at {config_path}")
        logger.info(f"Loading configuration from {path}")
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}

    personas_cfg = raw.get("personas", {})

    if personas_cfg.get("personas_dir"):
        if config_path:
            base = Path(config_path).parent
        else:
            base = Path.cwd()
        personas_cfg["personas_dir"] = str(base / personas_cfg["personas_dir"])

    _settings = AppSettings(**raw)

    logger.info(f"Configuration loaded: app.title={_settings.app.title}")
    return _settings


def get_settings() -> AppSettings:
    """Return the cached settings singleton (loads on first call)."""
    return load_settings()


# ---------------------------------------------------------------------------
# Personas loader from directory
# ---------------------------------------------------------------------------


def load_personas_from_dir(personas_dir: str) -> List[PersonaItemConfig]:
    """Load persona configs from individual YAML files in a directory.
    
    Each file is validated independently — invalid files are skipped with a
    warning.  Duplicate ids/names and disabled personas are filtered out.
    """

    dir_path = Path(personas_dir)
    if not dir_path.is_dir():
        logger.warning(f"Personas directory not found: {personas_dir}")
        return []

    personas: List[PersonaItemConfig] = []
    seen_ids: dict[str, str] = {}     # id -> filename that defined it
    seen_names: dict[str, str] = {}   # name -> filename that defined it

    # sorting files alphabetically ensures consistent and predictable loading order
    for filepath in sorted(dir_path.glob("*.yaml")):
        try:
            with open(filepath, "r", encoding="utf-8") as fh:
                raw = yaml.safe_load(fh) or {}
            persona = PersonaItemConfig(**raw)
        except Exception as exc:
            logger.warning(f"Skipping invalid persona file {filepath.name}: {exc}")
            continue

        if not persona.enabled:
            logger.info(f"Persona '{persona.id}' is disabled, skipping")
            continue

        if persona.id in seen_ids:
            logger.warning(
                f"Duplicate persona id '{persona.id}' in {filepath.name} "
                f"(already defined in {seen_ids[persona.id]}), skipping"
            )
            continue

        if persona.name in seen_names:
            logger.warning(
                f"Duplicate persona name '{persona.name}' in {filepath.name} "
                f"(already defined in {seen_names[persona.name]}), skipping"
            )
            continue

        seen_ids[persona.id] = filepath.name
        seen_names[persona.name] = filepath.name
        personas.append(persona)

    logger.info(f"Loaded {len(personas)} persona(s) from {personas_dir}")
    return personas