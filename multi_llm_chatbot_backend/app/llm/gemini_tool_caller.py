"""
Standalone Gemini tool-calling loop.

Sends a generateContent request with function declarations, handles any
functionCall the model returns, executes the tool, feeds the result back,
and returns a ``ToolCallResult`` indicating whether a tool was used.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
import httpx
from app.llm import GEMINI_BASE_URL

logger = logging.getLogger(__name__)


@dataclass
class ToolCallResult:
    """Structured return value from ``generate_with_tools``."""

    text: str
    used_tool: bool
    tool_name: Optional[str] = None
    tool_args: dict = field(default_factory=dict)


async def generate_with_tools(
    api_key: str,
    model_name: str,
    system_prompt: str,
    user_message: str,
    tool_definitions: Optional[List[Dict[str, Any]]] = None,
    tool_executor: Optional[Callable] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> ToolCallResult:
    """Send a Gemini request with tool definitions and handle the tool-call loop.

    If Gemini responds with a functionCall, *tool_executor* is called with
    the function name and arguments.  The result is sent back and Gemini
    produces a final text response.

    Returns a ``ToolCallResult`` so callers can determine whether a tool
    was actually invoked.
    """
    contents = [
        {"role": "user", "parts": [{"text": user_message}]},
    ]

    tool_defs = tool_definitions or []

    payload = _build_payload(
        system_prompt, contents, tool_defs, temperature, max_tokens,
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        result = await client.post(
            f"{GEMINI_BASE_URL}/{model_name}:generateContent",
            json=payload,
            headers={"x-goog-api-key": api_key},
        )
        result.raise_for_status()
        body = result.json()

        text = _extract_text(body)
        if text is not None:
            return ToolCallResult(text=text, used_tool=False)

        func_call = _extract_function_call(body)
        if func_call is None:
            return ToolCallResult(
                text="I'm unable to generate a response right now. Please try again.",
                used_tool=False,
            )

        fn_name = func_call["name"]
        fn_args = func_call.get("args", {})
        logger.info("Gemini requested tool call: %s(%s)", fn_name, fn_args)

        try:
            tool_result = await tool_executor(name=fn_name, **fn_args)
        except Exception as exc:
            logger.error("Tool %s failed: %s", fn_name, exc)
            return ToolCallResult(
                text="I tried to look that up but the data source is unavailable right now.",
                used_tool=True,
                tool_name=fn_name,
                tool_args=fn_args,
            )

        contents.append({
            "role": "model",
            "parts": [{"functionCall": func_call}],
        })
        fn_response: Dict[str, Any] = {
            "name": fn_name,
            "response": tool_result,
        }
        if func_call.get("id"):
            fn_response["id"] = func_call["id"]

        contents.append({
            "role": "user",
            "parts": [{"functionResponse": fn_response}],
        })

        followup_payload = _build_payload(
            system_prompt, contents, tool_defs, temperature, max_tokens,
        )

        followup = await client.post(
            f"{GEMINI_BASE_URL}/{model_name}:generateContent",
            json=followup_payload,
            headers={"x-goog-api-key": api_key},
        )
        followup.raise_for_status()
        followup_body = followup.json()

        text = _extract_text(followup_body)
        if text is not None:
            return ToolCallResult(
                text=text, used_tool=True,
                tool_name=fn_name, tool_args=fn_args,
            )

        return ToolCallResult(
            text="I'm unable to generate a response right now. Please try again.",
            used_tool=True, tool_name=fn_name, tool_args=fn_args,
        )


def _build_payload(
    system_prompt: str,
    contents: List[Dict[str, Any]],
    tool_definitions: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> Dict[str, Any]:
    """Assemble the Gemini generateContent request payload."""
    payload: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }

    if system_prompt:
        payload["system_instruction"] = {"parts": [{"text": system_prompt}]}

    if tool_definitions:
        payload["tools"] = [{"function_declarations": tool_definitions}]

    return payload


def _extract_text(response_body: Dict[str, Any]) -> str | None:
    """Return the text from a Gemini response, or None if there is none."""
    candidates = response_body.get("candidates", [])
    if not candidates:
        return None

    parts = candidates[0].get("content", {}).get("parts", [])
    texts = [p["text"] for p in parts if "text" in p]
    return texts[0] if texts else None


def _extract_function_call(response_body: Dict[str, Any]) -> Dict[str, Any] | None:
    """Return the functionCall dict from a Gemini response, or None."""
    candidates = response_body.get("candidates", [])
    if not candidates:
        return None

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        if "functionCall" in part:
            return part["functionCall"]
    return None
