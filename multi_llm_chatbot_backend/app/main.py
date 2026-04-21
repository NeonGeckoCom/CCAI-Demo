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
settings = load_settings()

# Import the new database functions
from app.core.database import connect_to_mongo, close_mongo_connection

# Import all route modules
from app.api.routes import router as main_router
from app.api.routes.auth import router as auth_router
from app.api.routes.chat_sessions import router as chat_sessions_router
from app.api.routes.phd_canvas import router as phd_canvas_router

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
    version="2.0.0",
    lifespan=lifespan
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
cors_origins = [origin.strip() for origin in cors_origins]  # Clean whitespace

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(main_router)
app.include_router(auth_router, prefix="/auth", tags=["authentication"])
app.include_router(chat_sessions_router, prefix="/api", tags=["chat-sessions"])
app.include_router(phd_canvas_router, prefix="/api", tags=["phd-canvas"])

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
@app.get("/api/config")
def get_public_config():
    """Return the public (non-secret) application configuration."""
    return settings.get_frontend_config()

@app.get("/")
def root():
    return {
        "message": f"{settings.app.title} Backend",
        "version": "2.0.0",
        "features": [
            "User Authentication", 
            "Persistent Chat Sessions",
            "MongoDB Integration",
            "Ollama Support", 
            "Gemini API Support",
            "Configurable Personas"
        ]
    }
