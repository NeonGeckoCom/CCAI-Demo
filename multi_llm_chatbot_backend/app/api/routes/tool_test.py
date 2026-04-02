"""
Temporary test endpoint for the Gemini tool-calling loop.

Bypasses the orchestrator and persona pipeline so we can verify
tool calling works end-to-end in isolation.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.llm.gemini_tool_caller import generate_with_tools
from app.tools.search_courses import TOOL_DEFINITION, execute as search_courses_execute

logger = logging.getLogger(__name__)

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a helpful CU Boulder academic advisor. "
    "When the user asks about courses, use the search_courses tool to look up "
    "real course data. Present the results clearly with section numbers, "
    "instructors, and schedules."
)


class ToolTestRequest(BaseModel):
    message: str


@router.post("/tool-query")
async def tool_query(request: ToolTestRequest):
    """Test the Gemini tool-calling loop with a single user message."""
    settings = get_settings()

    api_key = settings.llm.gemini.api_key
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API key not configured.")

    model_name = settings.llm.gemini.model

    try:
        result = await generate_with_tools(
            api_key=api_key,
            model_name=model_name,
            system_prompt=SYSTEM_PROMPT,
            user_message=request.message,
            tool_definitions=[TOOL_DEFINITION],
            tool_executor=search_courses_execute,
        )
        return {"response": result}

    except Exception as e:
        logger.error("tool-query failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
