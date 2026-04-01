import re
from typing import List
from openai import AsyncOpenAI, APIConnectionError, APIStatusError
from app.llm.llm_client import LLMClient
from app.core.context_manager import get_context_manager
import logging

logger = logging.getLogger(__name__)


class ImprovedVllmClient(LLMClient):
    def __init__(self, api_url: str, api_key: str, model_name: str = None):
        self.api_url = api_url
        self.api_key = api_key
        self.model_name = model_name
        self.client = AsyncOpenAI(
            base_url=f"{api_url}/v1",
            api_key=api_key,
            timeout=30.0,
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

            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=context_window.messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            text = response.choices[0].message.content.strip()
            return self._clean_response(text)

        except APIConnectionError:
            logger.error(f"Unable to connect to vLLM at {self.api_url}")
            return "I'm unable to connect to the AI service. Please ensure the vLLM endpoint is available."
        except APIStatusError as e:
            logger.error(f"vLLM API error: {e.status_code}")
            return "The AI service encountered an error. Please try again."
        except Exception as e:
            logger.error(f"Unexpected error in vLLM client: {str(e)}")
            return "I encountered an unexpected error. Please try again."

    def _clean_response(self, response: str) -> str:
        """Clean up response text, preserving Markdown formatting."""
        response = response.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in response.split("\n")]
        response = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        return response
