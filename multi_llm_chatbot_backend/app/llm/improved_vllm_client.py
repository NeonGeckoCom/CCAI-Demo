import json
import logging
from typing import Any, Callable, Dict, List, Optional

from openai import AsyncOpenAI, APIConnectionError, APIStatusError

from app.llm.llm_client import LLMClient, ToolCallResult
from app.core.context_manager import get_context_manager

logger = logging.getLogger(__name__)


class ImprovedVllmClient(LLMClient):
    def __init__(self, api_url: str, api_key: str, model_name: str = None):
        self.api_url = api_url
        self.api_key = api_key
        self.model_name = model_name
        self.client = AsyncOpenAI(
            base_url=f"{api_url}/v1",
            api_key=api_key,
            timeout=90.0,
        )
        self.context_manager = get_context_manager()

    async def refresh_model(self):
        """Query the vLLM endpoint to discover the currently loaded model."""
        models = await self.client.models.list()
        if not models.data:
            raise ValueError("No models available at the vLLM endpoint")
        self.model_name = models.data[0].id

    async def generate(self, system_prompt: str, context: List[dict],
                       temperature: float, max_tokens: int,
                       response_mime_type: str = None) -> str:
        try:
            context_window = self.context_manager.prepare_context_for_llm(
                messages=context,
                system_prompt=system_prompt,
                llm_provider="vllm"
            )

            logger.debug(f"Context prepared: {len(context_window.messages)} messages, "
                        f"~{context_window.total_tokens} tokens, truncated={context_window.truncated}")

            if not self.model_name:
                await self.refresh_model()

            create_kwargs = dict(
                model=self.model_name,
                messages=context_window.messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            if response_mime_type == "application/json":
                create_kwargs["response_format"] = {"type": "json_object"}

            response = await self.client.chat.completions.create(**create_kwargs)

            text = response.choices[0].message.content.strip()
            return self._clean_response(text)

        except APIConnectionError:
            logger.error(f"Unable to connect to vLLM at {self.api_url}")
            return "I'm unable to connect to the AI service. Please ensure the vLLM endpoint is available."
        except APIStatusError as e:
            logger.error(f"vLLM API error: {e.status_code} - {e.message}")
            if e.status_code == 404:
                logger.info("Model not found, will re-discover on next request")
                self.model_name = None
            return "The AI service encountered an error. Please try again."
        except Exception as e:
            logger.error(f"Unexpected error in vLLM client: {str(e)}")
            return "I encountered an unexpected error. Please try again."

    # ------------------------------------------------------------------
    # Tool-calling support (OpenAI-compatible format)
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
        """OpenAI-compatible tool-calling loop for vLLM.

        Converts tool definitions from the registry's Gemini format to
        OpenAI format, then follows the standard tool-call protocol:
        request → detect tool_call → execute → feed result back → return
        final text.
        """
        if not self.model_name:
            await self.refresh_model()

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        openai_tools = [
            self._gemini_to_openai_tool(d) for d in (tool_definitions or [])
        ]

        try:
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                tools=openai_tools or None,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            choice = response.choices[0].message

            if not choice.tool_calls:
                return ToolCallResult(text=choice.content or "", used_tool=False)

            tool_call = choice.tool_calls[0]
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)
            logger.info("vLLM requested tool call: %s(%s)", fn_name, fn_args)

            try:
                tool_result = await tool_executor(name=fn_name, **fn_args)
            except Exception as exc:
                logger.error("Tool %s failed: %s", fn_name, exc)
                return ToolCallResult(
                    text="I tried to look that up but the data source is unavailable right now.",
                    used_tool=True, tool_name=fn_name, tool_args=fn_args,
                )

            messages.append(choice.model_dump())
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result),
            })

            followup = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            text = followup.choices[0].message.content or ""
            return ToolCallResult(
                text=text, used_tool=True,
                tool_name=fn_name, tool_args=fn_args,
            )

        except APIConnectionError:
            logger.error("Unable to connect to vLLM at %s", self.api_url)
            return ToolCallResult(
                text="I'm unable to connect to the AI service. Please ensure the vLLM endpoint is available.",
                used_tool=False,
            )
        except APIStatusError as e:
            logger.error("vLLM tool-call API error: %s - %s", e.status_code, e.message)
            if e.status_code == 404:
                self.model_name = None
            return ToolCallResult(
                text="The AI service encountered an error. Please try again.",
                used_tool=False,
            )
        except Exception as e:
            logger.error("Unexpected error in vLLM tool-calling: %s", e)
            return ToolCallResult(
                text="I encountered an unexpected error. Please try again.",
                used_tool=False,
            )

    @staticmethod
    def _gemini_to_openai_tool(defn: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a Gemini function-declaration dict to OpenAI tool format."""
        return {
            "type": "function",
            "function": {
                "name": defn["name"],
                "description": defn.get("description", ""),
                "parameters": defn.get("parameters", {}),
            },
        }

