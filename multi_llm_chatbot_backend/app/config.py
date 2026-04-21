"""
Centralized application configuration.

Reads ``config.yaml`` from the project root (two levels above this file) and
validates it with Pydantic models.  Every setting falls back to environment
variables when the YAML value is empty, so existing ``.env`` workflows keep
working.
"""

import os
import logging
import colorsys
from pathlib import Path
from typing import Any, Dict, List, Optional
from colorhash import ColorHash

import yaml
from pydantic import BaseModel, validator, Field, model_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class _IconValidatorMixin(BaseModel):
    """Validates that the ``icon`` field is a known Lucide icon name."""

    @model_validator(mode="after")
    def _validate_icon(self):
        from app.utils.lucide_icons import get_valid_icon_names

        valid = get_valid_icon_names()
        if valid and self.icon not in valid:
            raise ValueError(
                f"Unknown icon {self.icon!r}. "
                f"Must be a valid Lucide icon name."
            )
        return self


class FeatureConfig(_IconValidatorMixin):
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


class ExampleCategory(_IconValidatorMixin):
    title: str
    icon: str = "BookOpen"
    color: str = "#3B82F6"
    bg_color: str = "#EFF6FF"
    suggestions: List[str] = []


class ChatPageConfig(BaseModel):
    placeholder: str = "Ask your advisors anything..."
    examples: List[ExampleCategory] = []


class PersonaItemConfig(_IconValidatorMixin):
    id: str
    name: str
    enabled: bool = True
    role: str = ""
    summary: str = ""
    color: Optional[str] = None
    bg_color: Optional[str] = None
    dark_color: Optional[str] = None
    dark_bg_color: Optional[str] = None
    icon: str = "HelpCircle"
    avatar: Optional[str] = None
    temperature: int = 5
    persona_prompt: str = ""

    @model_validator(mode='after')
    def _auto_generate_colors(self):
        if self.color is None:
            generated = generate_persona_colors(self.name)
            self.color = generated["color"]
            self.bg_color = generated["bg_color"]
            self.dark_color = generated["dark_color"]
            self.dark_bg_color = generated["dark_bg_color"]
        return self

    def _resolve_image(self) -> dict:
        """Resolve the persona's visual representation into a unified image
        descriptor for the frontend.

        Returns ``{"type": "url", "value": "<url>"}`` when an avatar is
        configured, otherwise ``{"type": "icon", "value": "<LucideIconName>"}``.
        Falls back to the icon when a bundled avatar name doesn't match a
        file on disk.
        """
        if self.avatar is None:
            return {"type": "icon", "value": self.icon}
        if self.avatar.startswith(("http://", "https://")):
            return {"type": "url", "value": self.avatar}
        from app.utils.avatar_helpers import get_bundled_avatar_path
        if get_bundled_avatar_path(self.avatar) is None:
            logger.warning(
                "Bundled avatar %r not found for persona %r, falling back to icon.",
                self.avatar, self.id,
            )
            return {"type": "icon", "value": self.icon}
        return {"type": "url", "value": f"/api/avatars/bundled/{self.avatar}"}

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
            "image": self._resolve_image(),
            }


class PersonasConfig(BaseModel):
    base_prompt: str = ""
    personas_dir: str = ""
    config_dir: str = ""
    items: List[PersonaItemConfig] = []

    @model_validator(mode='after')
    def _load_personas_from_directory(self):
        if self.personas_dir:
            dir_path = Path(self.personas_dir)
            if not dir_path.is_absolute() and self.config_dir:
                dir_path = Path(self.config_dir) / dir_path
            loaded = load_personas_from_dir(str(dir_path))
            if loaded:
                self.items = loaded
                logger.info(f"Loaded {len(loaded)} personas.")
            else:
                logger.warning(f"No personas found in {self.personas_dir}. falling back to personas.items config")
        return self


class OrchestratorConfig(BaseModel):
    min_words_without_keywords: int = 6
    specific_keywords: List[str] = []
    clarification_questions: List[str] = [
            "Could you provide more details about what you need help with?"]
    clarification_suggestions: List[str] = [
            "Provide more details about your question."]

    @model_validator(mode="after")
    def validate_clarificaiton_questions(self):
        if len(self.clarification_questions) < 1:
            raise ValueError("At least one clarification question is required.")
        return self


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
    model: str = "gemini-2.5-flash"

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


class VllmConfig(BaseModel):
    api_url: str = ""
    api_key: str = Field(default=os.getenv("VLLM_API_KEY", ""))


class LLMConfig(BaseModel):
    gemini: GeminiConfig = GeminiConfig()
    ollama: OllamaConfig = OllamaConfig()
    vllm: VllmConfig = VllmConfig()


class RAGConfig(BaseModel):
    embedding_model: str = "all-MiniLM-L6-v2"
    chroma_collection: str = "phd_advisor_documents"


class ToolsConfig(BaseModel):
    model_config = {"extra": "allow"}

    def get_enabled_names(self) -> List[str]:
        """Return tool names whose config has ``enabled: true``."""
        return [
            name
            for name, cfg in self.__pydantic_extra__.items()
            if isinstance(cfg, dict) and cfg.get("enabled", True)
        ]

    def get_tool_config(self, name: str) -> Dict[str, Any]:
        """Return the raw config dict for a single tool, or ``{}``."""
        cfg = self.__pydantic_extra__.get(name, {})
        return cfg if isinstance(cfg, dict) else {}


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
    tools: ToolsConfig = ToolsConfig()

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

    personas_cfg = raw.setdefault("personas", {})

    if config_path:
        personas_cfg["config_dir"] = str(Path(config_path).parent)

    _settings = AppSettings(**raw)
    logger.info(f"Configuration loaded: app.title={_settings.app.title}")
    return _settings


def get_settings() -> AppSettings:
    """Return the cached settings singleton (loads on first call)."""
    return load_settings()


# ---------------------------------------------------------------------------
# Helper Functions
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


def generate_persona_colors(name: str) -> dict:
    """Deterministically generate four theme colors from a persona name."""

    ch = ColorHash(name.lower(), lightness=[0.55], saturation=[0.65])
    hue = ch.hsl[0]  # grab the hue colorhash picked
    h = hue / 360

    def hsl_to_hex(h, s, l):
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return f"#{int(r*255):02X}{int(g*255):02X}{int(b*255):02X}"

    return {
        "color":         hsl_to_hex(h, 0.65, 0.55),
        "bg_color":      hsl_to_hex(h, 0.60, 0.95),
        "dark_color":    hsl_to_hex(h, 0.70, 0.70),
        "dark_bg_color": hsl_to_hex(h, 0.65, 0.25),
    }