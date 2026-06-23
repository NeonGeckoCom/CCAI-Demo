import httpx
import json
import logging
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

from openai import AsyncOpenAI, APIConnectionError, APIStatusError

from app.llm.clients.llm_client import LLMClient, LLMStreamChunk, ToolCallInfo, ToolCallResult

from app.core.context_manager import get_context_manager
from app.config import get_settings

logger = logging.getLogger(__name__)

THINKING_DISABLED_CONFIG = {"thinkingBudget": 0}


def _supports_thinking_config(model_name: str) -> bool:
    """Return whether the Gemini model family supports thinkingConfig."""
    normalized = (model_name or "").lower()
    return normalized.startswith("gemini-3") or normalized.startswith("gemini-2.5")


class ImprovedGeminiClient(LLMClient):
    def __init__(self, model_name: str = None):
        settings = get_settings()
        if model_name is None:
            model_name = settings.llm.gemini.model

        self.model_name = model_name
        # Config validator already falls back to GEMINI_API_KEY env var
        self.api_key = settings.llm.gemini.api_key
        if not self.api_key:
            raise ValueError("Gemini API key not set. Provide it in config.yaml (llm.gemini.api_key).")

        # Native Gemini REST API
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"
        self.context_manager = get_context_manager()

        # OpenAI-compatible endpoint (for tool calling)
        self.openai_client = AsyncOpenAI(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key=self.api_key,
            timeout=90.0,
        )

    async def generate(self, system_prompt: str, context: List[dict], temperature: float, max_tokens: int, response_mime_type: str = None) -> str:
        """
        Generate response using improved context management
        FIXED VERSION - Better debugging and context handling
        """
        try:
            # Use context manager to prepare optimal context window
            context_window = self.context_manager.prepare_context_for_llm(
                messages=context,
                system_prompt=system_prompt,
                llm_provider="gemini"
            )

            logger.debug(f"Context prepared: {len(context_window.messages)} messages, "
                        f"~{context_window.total_tokens} tokens, truncated={context_window.truncated}")

            # DEBUG: Log the actual content being sent to Gemini
            logger.debug(f"Gemini payload preview: {str(context_window.messages)[:500]}...")

            generation_config = {
                "temperature": temperature,
                "topK": 40,
                "topP": 0.9,
            }
            if max_tokens is not None:
                generation_config["maxOutputTokens"] = max_tokens

            payload = {
                "contents": context_window.messages,
                "generationConfig": generation_config,
                "safetySettings": [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ]
            }

            if _supports_thinking_config(self.model_name):
                # Disable hidden thinking for latency-sensitive app responses.
                # Otherwise Gemini preview models can spend the output budget on
                # thought tokens, hit MAX_TOKENS, and force a second retry call.
                payload["generationConfig"]["thinkingConfig"] = THINKING_DISABLED_CONFIG

            if response_mime_type is not None:
                payload["generationConfig"]["responseMimeType"] = response_mime_type

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/{self.model_name}:generateContent",
                    json=payload,
                    headers={"x-goog-api-key": self.api_key}
                )
                response.raise_for_status()

                result = response.json()

                # Better error handling
                if "candidates" not in result or not result["candidates"]:
                    logger.error(f"No candidates in Gemini response: {result}")
                    return "I apologize, but I'm unable to generate a response right now. Please try again."

                candidate = result["candidates"][0]
                finish_reason = candidate.get("finishReason")
                if finish_reason and finish_reason != "STOP":
                    logger.warning(
                        "Gemini response finished with finishReason=%s (model=%s, max_tokens=%s)",
                        finish_reason,
                        self.model_name,
                        max_tokens,
                    )

                if "content" not in candidate or "parts" not in candidate["content"]:
                    logger.error(f"Invalid candidate structure: {candidate}")
                    return "I apologize, but I received an unexpected response format. Please try again."

                parts = candidate["content"]["parts"]
                text = "\n\n".join(
                    p.get("text", "")
                    for p in parts
                    if not p.get("thought") and p.get("text", "").strip()
                ).strip()

                if not text:
                    logger.warning("Empty response from Gemini")
                    return "I apologize, but I couldn't generate a meaningful response. Please try rephrasing your question."

                return self._clean_response(text)

        except httpx.HTTPStatusError as e:
            logger.error(f"Gemini API HTTP error: {e.response.status_code} - {e.response.text}")
            return "I'm experiencing issues connecting to the AI service. Please try again."
        except httpx.TimeoutException:
            logger.error("Gemini API timeout")
            return "The AI service is taking too long to respond. Please try again."
        except Exception as e:
            logger.exception("Unexpected error in Gemini client")
            return "I encountered an unexpected error. Please try again."

    async def stream_generate(
        self,
        system_prompt: str,
        context: List[dict],
        temperature: float,
        max_tokens: Optional[int],
        response_mime_type: str = None,
        include_thoughts: bool = False,
    ) -> AsyncIterator[LLMStreamChunk]:
        """Stream Gemini output through the native SSE endpoint."""
        try:
            context_window = self.context_manager.prepare_context_for_llm(
                messages=context,
                system_prompt=system_prompt,
                llm_provider="gemini"
            )

            logger.debug(
                "Streaming Gemini context prepared: %d messages, ~%s tokens, truncated=%s",
                len(context_window.messages),
                context_window.total_tokens,
                context_window.truncated,
            )

            generation_config = {
                "temperature": temperature,
                "topK": 40,
                "topP": 0.9,
            }
            if max_tokens is not None:
                generation_config["maxOutputTokens"] = max_tokens

            if response_mime_type is not None:
                generation_config["responseMimeType"] = response_mime_type

            if _supports_thinking_config(self.model_name):
                generation_config["thinkingConfig"] = (
                    {"includeThoughts": True}
                    if include_thoughts
                    else THINKING_DISABLED_CONFIG
                )

            payload = {
                "contents": context_window.messages,
                "generationConfig": generation_config,
                "safetySettings": [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ],
            }

            emitted_any = False
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/{self.model_name}:streamGenerateContent?alt=sse",
                    json=payload,
                    headers={"x-goog-api-key": self.api_key},
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if not line.startswith("data:"):
                            continue

                        data = line[5:].strip()
                        if data == "[DONE]":
                            break

                        try:
                            result = json.loads(data)
                        except json.JSONDecodeError:
                            logger.warning("Skipping malformed Gemini stream chunk: %r", data[:200])
                            continue

                        for candidate in result.get("candidates", []):
                            finish_reason = candidate.get("finishReason")
                            if finish_reason and finish_reason != "STOP":
                                logger.warning(
                                    "Gemini stream finished with finishReason=%s (model=%s, max_tokens=%s)",
                                    finish_reason,
                                    self.model_name,
                                    max_tokens,
                                )

                            content = candidate.get("content") or {}
                            for part in content.get("parts") or []:
                                text = part.get("text") or ""
                                if not text:
                                    continue
                                kind = "thought" if part.get("thought") else "text"
                                emitted_any = True
                                yield LLMStreamChunk(text=text, kind=kind)

            if not emitted_any:
                logger.warning("Empty Gemini stream response")

        except httpx.HTTPStatusError as e:
            logger.error("Gemini stream HTTP error: %s", e.response.status_code)
            yield LLMStreamChunk(
                text="I'm experiencing issues connecting to the AI service. Please try again.",
                kind="text",
            )
        except httpx.TimeoutException:
            logger.error("Gemini stream timeout")
            yield LLMStreamChunk(
                text="The AI service is taking too long to respond. Please try again.",
                kind="text",
            )
        except Exception:
            logger.exception("Unexpected error in Gemini stream client")
            yield LLMStreamChunk(
                text="I encountered an unexpected error. Please try again.",
                kind="text",
            )

    # ------------------------------------------------------------------
    # Tool-calling support (via Gemini OpenAI-compatible endpoint)
    # ------------------------------------------------------------------

    _MAX_TOOL_ROUNDS = 5

    async def generate_with_tools(
        self,
        system_prompt: str,
        user_message: str,
        tool_definitions: Optional[List[Dict[str, Any]]] = None,
        tool_executor: Optional[Callable] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> ToolCallResult:
        """OpenAI-compatible tool-calling loop via Gemini's /openai/ endpoint.

        Tool definitions are expected in OpenAI format (as returned by the
        tool registry).  Loops through the standard tool-call protocol
        until the model produces a plain text response:

            request 鈫?detect tool_calls 鈫?execute all 鈫?feed results
            back 鈫?repeat (up to ``_MAX_TOOL_ROUNDS`` rounds).

        All tool calls in a single response are executed before the next
        round, so multi-tool queries (e.g. "compare professor A vs B")
        work correctly.
        """
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        openai_tools = tool_definitions or []
        all_tool_calls: List[ToolCallInfo] = []

        try:
            for _round in range(self._MAX_TOOL_ROUNDS):
                response = await self.openai_client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    tools=openai_tools or None,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

                choice = response.choices[0].message

                if not choice.tool_calls:
                    return ToolCallResult(
                        text=choice.content or "",
                        used_tool=bool(all_tool_calls),
                        tool_name=all_tool_calls[0].name if all_tool_calls else None,
                        tool_args=all_tool_calls[0].args if all_tool_calls else {},
                        tool_calls_made=all_tool_calls,
                    )

                messages.append(choice.model_dump(exclude_none=True))

                for tc in choice.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    logger.info("Gemini requested tool call: %s(%s)", fn_name, fn_args)
                    all_tool_calls.append(ToolCallInfo(name=fn_name, args=fn_args))

                    try:
                        tool_result = await tool_executor(name=fn_name, **fn_args)
                    except Exception as exc:
                        logger.error("Tool %s failed: %s", fn_name, exc)
                        tool_result = {"error": str(exc)}

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(tool_result),
                    })

            logger.warning(
                "Tool-calling loop exhausted after %d rounds", self._MAX_TOOL_ROUNDS,
            )
            last_content = response.choices[0].message.content or ""
            return ToolCallResult(
                text=last_content or "I was unable to finish looking that up. Please try again.",
                used_tool=bool(all_tool_calls),
                tool_name=all_tool_calls[0].name if all_tool_calls else None,
                tool_args=all_tool_calls[0].args if all_tool_calls else {},
                tool_calls_made=all_tool_calls,
            )

        except APIConnectionError:
            logger.error("Unable to connect to Gemini OpenAI-compat endpoint")
            return ToolCallResult(
                text="I'm unable to connect to the AI service. Please try again.",
                used_tool=False,
            )
        except APIStatusError as e:
            logger.error("Gemini tool-call API error: %s - %s", e.status_code, e.message)
            return ToolCallResult(
                text="The AI service encountered an error. Please try again.",
                used_tool=False,
            )
        except Exception as e:
            logger.error("Unexpected error in Gemini tool-calling: %s", e)
            return ToolCallResult(
                text="I encountered an unexpected error. Please try again.",
                used_tool=False,
            )
