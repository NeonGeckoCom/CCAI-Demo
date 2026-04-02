"""
Standalone Gemini tool-calling loop.

Sends a generateContent request with function declarations, handles any
functionCall the model returns, executes the tool, feeds the result back,
and returns the final text response.
"""

import logging
from typing import Any, Callable, Dict, List

import httpx

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


async def generate_with_tools(
    api_key: str,
    model_name: str,
    system_prompt: str,
    user_message: str,
    tool_definitions: List[Dict[str, Any]],
    tool_executor: Callable,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Send a Gemini request with tool definitions and handle the tool-call loop.

    If Gemini responds with a functionCall, the tool_executor is called with
    the function name and arguments as keyword args. The result is sent back
    and Gemini produces a final text response.

    Returns the final text string.
    """
    contents = [
        {"role": "user", "parts": [{"text": user_message}]},
    ]

    payload = _build_payload(
        system_prompt, contents, tool_definitions, temperature, max_tokens,
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
            return text

        func_call = _extract_function_call(body)
        if func_call is None:
            return "I'm unable to generate a response right now. Please try again."

        fn_name = func_call["name"]
        fn_args = func_call["args"]
        logger.info("Gemini requested tool call: %s(%s)", fn_name, fn_args)

        tool_result = await tool_executor(name=fn_name, **fn_args)

        # Append the model's functionCall and the tool's functionResponse
        contents.append({
            "role": "model",
            "parts": [{"functionCall": func_call}],
        })
        contents.append({
            "role": "user",
            "parts": [{
                "functionResponse": {
                    "name": fn_name,
                    "response": tool_result,
                },
            }],
        })

        followup_payload = _build_payload(
            system_prompt, contents, tool_definitions, temperature, max_tokens,
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
            return text

        return "I'm unable to generate a response right now. Please try again."


def _build_payload(
    system_prompt: str,
    contents: List[Dict[str, Any]],
    tool_definitions: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> Dict[str, Any]:
    """Assemble the Gemini generateContent request payload."""
    return {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "tools": [{"function_declarations": tool_definitions}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }


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
