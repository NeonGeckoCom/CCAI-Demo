from fastapi import APIRouter
from app.config import get_settings
from app.version import __version__

import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/")
def root():
    title = get_settings().app.title
    return {
        "message": f"{title} Backend is up and running",
        "version": __version__,
        "features": [
            "Configurable Personas",
            "Improved Session Management",
            "Unified Context Handling",
            "Ollama Support",
            "Gemini API Support",
            "Provider Switching"
        ]
    }

