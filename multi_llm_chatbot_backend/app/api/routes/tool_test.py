"""
Temporary test endpoint for the Gemini tool-calling loop.

Bypasses the orchestrator and persona pipeline so we can verify
tool calling works end-to-end in isolation.
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.llm.gemini_tool_caller import generate_with_tools
from app.tools.search_courses import (
    TOOL_DEFINITION as SEARCH_COURSES_TOOL,
    execute as search_courses_execute,
)
from app.tools.rate_my_professor import (
    TOOL_DEFINITION as RMP_TOOL,
    execute as rmp_execute,
)

logger = logging.getLogger(__name__)

router = APIRouter()

ALL_TOOL_DEFINITIONS = [SEARCH_COURSES_TOOL, RMP_TOOL]

_EXECUTORS = {
    "search_courses": search_courses_execute,
    "rate_my_professor": rmp_execute,
}


async def dispatch_tool(name: str, **kwargs) -> Dict[str, Any]:
    """Route a tool call to the correct executor by function name."""
    executor = _EXECUTORS.get(name)
    if not executor:
        logger.warning("Unknown tool requested: %s", name)
        return {"error": f"Unknown tool: {name}"}
    return await executor(name=name, **kwargs)


SYSTEM_PROMPT = (
    "You are a helpful CU Boulder academic advisor. "
    "When the user asks about courses, use the search_courses tool to look up "
    "real course data. Present the results clearly with section numbers, "
    "instructors, and schedules. "
    "When the user asks about professor ratings or reviews, use the "
    "rate_my_professor tool to look up real RateMyProfessors data."
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
            tool_definitions=ALL_TOOL_DEFINITIONS,
            tool_executor=dispatch_tool,
        )
        return {"response": result}

    except Exception as e:
        logger.error("tool-query failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
