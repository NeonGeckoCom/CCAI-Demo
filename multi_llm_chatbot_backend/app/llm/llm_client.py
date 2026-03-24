from abc import ABC, abstractmethod
from typing import List

class LLMClient(ABC):
    """Abstract base class for all LLM clients"""
    
    @abstractmethod
    async def generate(self, system_prompt: str, context: List[dict], temperature: float, max_tokens: int, response_mime_type: str = None) -> str:
        """
        Generate a response using the LLM.
        
        Args:
            system_prompt (str): The system prompt defining the persona/role
            context (List[dict]): List of conversation messages with 'role' and 'content' keys
            
        Returns:
            str: The generated response text
        """
        pass