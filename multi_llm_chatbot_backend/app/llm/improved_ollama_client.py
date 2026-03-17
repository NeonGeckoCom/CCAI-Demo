import httpx
from typing import List
import re
from app.llm.llm_client import LLMClient
from app.core.context_manager import get_context_manager
import logging

logger = logging.getLogger(__name__)

class ImprovedOllamaClient(LLMClient):
    def __init__(self, model_name: str = "llama3.2:1b", base_url: str = "http://localhost:11434"):
        self.model_name = model_name
        self.base_url = base_url
        self.context_manager = get_context_manager()
    
    async def generate(self, system_prompt: str, context: List[dict], temperature: float, max_tokens: int) -> str:
        """
        Generate response using improved context management
        """
        try:
            # Use context manager to prepare optimal context
            context_window = self.context_manager.prepare_context_for_llm(
                messages=context,
                system_prompt=system_prompt,
                llm_provider="ollama"
            )
            
            logger.debug(f"Context prepared: ~{context_window.total_tokens} tokens, "
                        f"truncated={context_window.truncated}")
            
            # For Ollama, context_window.messages is a formatted prompt string
            formatted_prompt = context_window.messages
            
            payload = {
                "model": self.model_name,
                "prompt": formatted_prompt,
                "stream": False,
                "options": {
                    "temperature": temperature,
                    "top_p": 0.9,
                    "top_k": 40,
                    "num_predict": max_tokens,
                    "repeat_penalty": 1.1,
                    "stop": ["</END>", "\n\nStudent:", "\n\nUser:", "Question:", "Student:"]
                }
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f"{self.base_url}/api/generate", json=payload)
                response.raise_for_status()
                
                result = response.json()
                text = result.get("response", "").strip()
                
                return self._clean_response(text)
                
        except httpx.ConnectError:
            logger.error(f"Cannot connect to Ollama at {self.base_url}")
            return "I'm unable to connect to the local AI service. Please ensure Ollama is running."
        except httpx.TimeoutException:
            logger.error("Ollama request timeout")
            return "The AI service is taking too long to respond. Please try again."
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama HTTP error: {e.response.status_code}")
            return "The AI service encountered an error. Please try again."
        except Exception as e:
            logger.error(f"Unexpected error in Ollama client: {str(e)}")
            return "I encountered an unexpected error. Please try again."
    
    def _clean_response(self, response: str) -> str:
        """Clean up common response issues"""
        # Remove common prefixes that indicate AI confusion
        prefixes_to_remove = [
            "Here are 2-3 sentence", "Here's an expansion", "Assistant:",
            "Dr. Methodologist:", "Dr. Theorist:", "Dr. Pragmatist:",
            "Methodologist Advisor:", "Theorist Advisor:", "Pragmatist Advisor:",
        ]
        
        for prefix in prefixes_to_remove:
            if response.startswith(prefix):
                response = response[len(prefix):].strip()
        
        # Remove trailing incomplete sentences
        sentences = response.split('.')
        if len(sentences) > 1 and len(sentences[-1].strip()) < 10:
            response = '.'.join(sentences[:-1]) + '.'
        
        # Remove excessive academic fluff
        fluff_patterns = [
            "conceptual insights:", "actionable advice:", "my inquisitive student",
            "excellent question", "thank you for", "assistant!"
        ]
        
        for pattern in fluff_patterns:
            response = response.replace(pattern, "").strip()
        
        response = response.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in response.split("\n")]

        response = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        return response


    def _is_poor_quality(self, response: str) -> bool:
        """Check if response quality is poor"""
        poor_indicators = [
            "Thank you, Dr." in response,
            "Assistant:" in response,
            len(response.split()) > 150,  # Too verbose
            response.count("?") > 3,  # Too many questions
        ]
        return any(poor_indicators)