from fastapi import APIRouter
from app.config import get_settings

import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/")
def root():
    title = get_settings().app.title
    return {
        "message": f"{title} Backend is up and running",
        "version": "2.0.0",
        "features": [
            "Configurable Personas",
            "Improved Session Management",
            "Unified Context Handling",
            "Ollama Support",
            "Gemini API Support",
            "Provider Switching"
        ]
    }

