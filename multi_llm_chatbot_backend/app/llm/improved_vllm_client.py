import json
import logging
from typing import Any, Callable, Dict, List, Optional

from openai import AsyncOpenAI, APIConnectionError, APIStatusError

from app.llm.llm_client import LLMClient, ToolCallInfo, ToolCallResult
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
        """OpenAI-compatible tool-calling loop for vLLM.

        Converts tool definitions from the registry's Gemini format to
        OpenAI format, then loops through the standard tool-call protocol
        until the model produces a plain text response:

            request → detect tool_calls → execute all → feed results
            back → repeat (up to ``_MAX_TOOL_ROUNDS`` rounds).

        All tool calls in a single response are executed before the next
        round, so multi-tool queries (e.g. "compare professor A vs B")
        work correctly.
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

        all_tool_calls: List[ToolCallInfo] = []

        try:
            for _round in range(self._MAX_TOOL_ROUNDS):
                response = await self.client.chat.completions.create(
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

                messages.append(choice.model_dump())

                for tc in choice.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    logger.info("vLLM requested tool call: %s(%s)", fn_name, fn_args)
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

