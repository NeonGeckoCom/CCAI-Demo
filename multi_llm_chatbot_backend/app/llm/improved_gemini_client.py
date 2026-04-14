import httpx
import logging
from typing import Any, Callable, Dict, List, Optional

from app.llm.llm_client import LLMClient, ToolCallResult

from app.core.context_manager import get_context_manager
from app.config import get_settings

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

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
        
        self.base_url = GEMINI_BASE_URL
        self.context_manager = get_context_manager()
    
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
    # Tool-calling support
    # ------------------------------------------------------------------

    async def generate_with_tools(
        self,
        system_prompt: str,
        user_message: str,
        tool_definitions: Optional[List[Dict[str, Any]]] = None,
        tool_executor: Optional[Callable] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> ToolCallResult:
        """Gemini-native tool-calling loop.

        Sends a generateContent request with function declarations.  If
        the model responds with a ``functionCall``, executes the tool via
        *tool_executor*, feeds the result back, and returns the final
        text response.
        """
        contents: List[Dict[str, Any]] = [
            {"role": "user", "parts": [{"text": user_message}]},
        ]
        tool_defs = tool_definitions or []

        payload = self._build_tool_payload(
            system_prompt, contents, tool_defs, temperature, max_tokens,
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.base_url}/{self.model_name}:generateContent",
                    json=payload,
                    headers={"x-goog-api-key": self.api_key},
                )
                resp.raise_for_status()
                body = resp.json()

                text = self._extract_text(body)
                if text is not None:
                    return ToolCallResult(text=text, used_tool=False)

                func_call = self._extract_function_call(body)
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
                        used_tool=True, tool_name=fn_name, tool_args=fn_args,
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

                followup_payload = self._build_tool_payload(
                    system_prompt, contents, tool_defs, temperature, max_tokens,
                )
                followup = await client.post(
                    f"{self.base_url}/{self.model_name}:generateContent",
                    json=followup_payload,
                    headers={"x-goog-api-key": self.api_key},
                )
                followup.raise_for_status()

                text = self._extract_text(followup.json())
                if text is not None:
                    return ToolCallResult(
                        text=text, used_tool=True,
                        tool_name=fn_name, tool_args=fn_args,
                    )

                return ToolCallResult(
                    text="I'm unable to generate a response right now. Please try again.",
                    used_tool=True, tool_name=fn_name, tool_args=fn_args,
                )

        except httpx.HTTPStatusError as e:
            logger.error("Gemini tool-call HTTP error: %s - %s", e.response.status_code, e.response.text)
            return ToolCallResult(
                text="I'm experiencing issues connecting to the AI service. Please try again.",
                used_tool=False,
            )
        except httpx.TimeoutException:
            logger.error("Gemini tool-call timeout")
            return ToolCallResult(
                text="The AI service is taking too long to respond. Please try again.",
                used_tool=False,
            )
        except Exception as e:
            logger.error("Unexpected error in Gemini tool-calling: %s", e)
            return ToolCallResult(
                text="I encountered an unexpected error. Please try again.",
                used_tool=False,
            )

    # ------------------------------------------------------------------
    # Private helpers for tool-calling payloads / response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _build_tool_payload(
        system_prompt: str,
        contents: List[Dict[str, Any]],
        tool_definitions: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
    ) -> Dict[str, Any]:
        """Assemble a Gemini generateContent payload with tool declarations."""
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

    @staticmethod
    def _extract_text(response_body: Dict[str, Any]) -> Optional[str]:
        """Return the first text part from a Gemini response, or ``None``."""
        candidates = response_body.get("candidates", [])
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        texts = [p["text"] for p in parts if "text" in p]
        return texts[0] if texts else None

    @staticmethod
    def _extract_function_call(response_body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Return the ``functionCall`` dict from a Gemini response, or ``None``."""
        candidates = response_body.get("candidates", [])
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        for part in parts:
            if "functionCall" in part:
                return part["functionCall"]
        return None
