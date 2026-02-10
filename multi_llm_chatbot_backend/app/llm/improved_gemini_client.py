import httpx
import os
from typing import List
from app.llm.llm_client import LLMClient
from app.core.context_manager import get_context_manager
from app.config import get_settings
import logging

logger = logging.getLogger(__name__)

class ImprovedGeminiClient(LLMClient):
    def __init__(self, model_name: str = None):
        settings = get_settings()
        if model_name is None:
            model_name = settings.llm.gemini.model
        
        self.model_name = model_name
        # Config validator already falls back to GEMINI_API_KEY env var
        self.api_key = settings.llm.gemini.api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("Gemini API key not set. Provide it in config.yaml (llm.gemini.api_key) or as GEMINI_API_KEY env var.")
        
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"
        self.context_manager = get_context_manager()
    
    async def generate(self, system_prompt: str, context: List[dict], temperature: float, max_tokens: int) -> str:
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
                    "stopSequences": ["</END>", "Student:", "Question:", "\n\nStudent:", "\n\nQuestion:"]
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
                
                text = candidate["content"]["parts"][0].get("text", "").strip()
                
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
    
    def _clean_response(self, response: str) -> str:
        """Clean up response text"""
        # Remove common issues
        """response = response.strip()
        
        # Remove duplicate spaces and normalize
        response = ' '.join(response.split())
        
        return response"""
        response = response.strip()

        # Preserve line breaks for Markdown; only trim right-side spaces and collapse 3+ blank lines
        response = response.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln.rstrip() for ln in response.split("\n")]

        import re
        response = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()

        return response