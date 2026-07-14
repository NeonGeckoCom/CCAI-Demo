import os
from dotenv import load_dotenv

load_dotenv()

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

# Load configuration FIRST so every module can use it
from app.config import load_settings
from app.version import __version__
settings = load_settings()

# Import the new database functions
from app.core.database import connect_to_mongo, close_mongo_connection

# Import all route modules
from app.api.routes import router as main_router
from app.api.routes.auth import router as auth_router
from app.api.routes.chat_sessions import router as chat_sessions_router
from app.api.routes.phd_canvas import router as phd_canvas_router
from app.api.routes.preferences import router as preferences_router
from app.api.routes.advisor_skills import router as advisor_skills_router
from app.api.routes.discovery import router as discovery_router
from app.api.routes.defense import router as defense_router

import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_to_mongo()
    yield
    # Shutdown
    await close_mongo_connection()

app = FastAPI(
    title=f"{settings.app.title} Backend",
    version=__version__,
    lifespan=lifespan
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
cors_origins = [origin.strip() for origin in cors_origins]  # Clean whitespace
for local_origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
    if local_origin not in cors_origins:
        cors_origins.append(local_origin)
cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(main_router)
app.include_router(auth_router, prefix="/auth", tags=["authentication"])
app.include_router(chat_sessions_router, prefix="/api", tags=["chat-sessions"])
app.include_router(phd_canvas_router, prefix="/api", tags=["phd-canvas"])
app.include_router(preferences_router, prefix="/api", tags=["preferences"])
app.include_router(advisor_skills_router, prefix="/api", tags=["advisor-skills"])
app.include_router(discovery_router, prefix="/api", tags=["discovery"])
app.include_router(defense_router, prefix="/api", tags=["defense"])

# Serve bundled avatar images
_avatars_dir = Path(__file__).resolve().parent / "assets" / "avatars"
if _avatars_dir.is_dir():
    app.mount(
        "/api/avatars/bundled",
        StaticFiles(directory=_avatars_dir),
        name="bundled-avatars",
    )


# ---------------------------------------------------------------------------
# Public configuration endpoint — serves the frontend-safe subset
# ---------------------------------------------------------------------------
@app.get("/api/config", tags=["meta"])
def get_public_config():
    """Return the public (non-secret) application configuration.

    Serves the frontend-safe subset of configured app settings.
    """
    return settings.get_frontend_config()

@app.get("/")
def root():
    return {
        "message": f"{settings.app.title} Backend",
        "version": __version__,
        "features": [
            "User Authentication", 
            "Persistent Chat Sessions",
            "MongoDB Integration",
            "Ollama Support", 
            "Gemini API Support",
            "Configurable Personas"
        ]
    }
