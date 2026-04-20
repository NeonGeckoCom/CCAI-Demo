import httpx
import json
import logging
from typing import Any, Callable, Dict, List, Optional

from openai import AsyncOpenAI, APIConnectionError, APIStatusError

from app.llm.llm_client import LLMClient, ToolCallInfo, ToolCallResult

from app.core.context_manager import get_context_manager
from app.config import get_settings

logger = logging.getLogger(__name__)

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
            
            payload = {
                "contents": context_window.messages,
                "generationConfig": {
                    "temperature": temperature,
                    "topK": 40,
                    "topP": 0.9,
                    "maxOutputTokens": max_tokens,
                },
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

            if response_mime_type is not None:
                payload["generationConfig"]["responseMimeType"] = response_mime_type
                # no thinking required for JSON responses; conserve token budget
                payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
            else:
                payload["generationConfig"]["stopSequences"] = ["</END>", "Student:", "Question:", "\n\nStudent:", "\n\nQuestion:"]
            
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
            logger.error(f"Unexpected error in Gemini client: {str(e)}")
            return "I encountered an unexpected error. Please try again."

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

            request → detect tool_calls → execute all → feed results
            back → repeat (up to ``_MAX_TOOL_ROUNDS`` rounds).

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
