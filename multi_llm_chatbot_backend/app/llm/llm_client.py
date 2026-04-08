from abc import ABC, abstractmethod
from typing import List
import re

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

    def _clean_response(self, response: str) -> str:
        """Clean up response text, preserving Markdown formatting."""
        response = response.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in response.split("\n")]
        response = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        return response