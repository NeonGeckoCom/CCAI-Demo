from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
import re


@dataclass
class ToolCallInfo:
    """Record of a single tool invocation."""

    name: str
    args: dict = field(default_factory=dict)


@dataclass
class ToolCallResult:
    """Structured return value from ``generate_with_tools``."""

    text: str
    used_tool: bool
    tool_name: Optional[str] = None
    tool_args: dict = field(default_factory=dict)
    tool_calls_made: List["ToolCallInfo"] = field(default_factory=list)


class LLMClient(ABC):
    """Abstract base class for all LLM clients"""

    @abstractmethod
    async def generate(self, system_prompt: str, context: List[dict], temperature: float, max_tokens: int, response_mime_type: str = None) -> str:
        """
        Generate a response using the LLM.

        Args:
            system_prompt (str): The system prompt defining the persona/role
            context (List[dict]): List of conversation messages with 'role' and 'content' keys
            temperature (float): Sampling temperature for generation
            max_tokens (int): Maximum number of tokens to generate
            response_mime_type (str, optional): MIME type for the response format. Defaults to None.

        Returns:
            str: The generated response text
        """
        pass

    async def generate_with_tools(
        self,
        system_prompt: str,
        user_message: str,
        tool_definitions: Optional[List[Dict[str, Any]]] = None,
        tool_executor: Optional[Callable] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> ToolCallResult:
        """Generate a response, optionally invoking tools.

        Subclasses that support native tool calling should override this
        method.  The default implementation ignores tools and falls back
        to a plain ``generate()`` call so that providers without tool
        support degrade gracefully.
        """
        text = await self.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": user_message}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return ToolCallResult(text=text, used_tool=False)

    def _clean_response(self, response: str) -> str:
        """Clean up response text, preserving Markdown formatting."""
        response = response.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in response.split("\n")]
        response = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        return response