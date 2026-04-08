from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import re
from datetime import datetime

@dataclass
class ContextWindow:
    """Represents a context window for LLM processing"""
    messages: List[dict]
    total_tokens: int
    truncated: bool = False
    
class ContextManager:
    """Unified context management for consistent LLM behavior"""
    
    def __init__(self, 
                 max_context_tokens: int = 8000,
                 preserve_recent_messages: int = 5,
                 chars_per_token: float = 4.0):
        self.max_context_tokens = max_context_tokens
        self.preserve_recent_messages = preserve_recent_messages
        self.chars_per_token = chars_per_token
    
    def prepare_context_for_llm(self, 
                               messages: List[dict], 
                               system_prompt: str,
                               llm_provider: str = "gemini") -> ContextWindow:
        """
        Prepare context for LLM with intelligent windowing and formatting
        """
        # Calculate token budget
        system_tokens = self._estimate_tokens(system_prompt)
        available_tokens = self.max_context_tokens - system_tokens - 500  # Reserve for response
        
        # Get relevant context window
        context_messages = self._get_optimal_context_window(messages, available_tokens)
        
        # Format for specific LLM provider
        formatted_messages = self._format_for_provider(context_messages, system_prompt, llm_provider)
        
        return ContextWindow(
            messages=formatted_messages,
            total_tokens=self._estimate_tokens_for_messages(formatted_messages),
            truncated=len(context_messages) < len(messages)
        )
    
    def _get_optimal_context_window(self, messages: List[dict], token_budget: int) -> List[dict]:
        """
        Select optimal messages for context window using recency + relevance
        """
        if not messages:
            return []
        
        # Always preserve the most recent messages
        recent_messages = messages[-self.preserve_recent_messages:]
        recent_tokens = self._estimate_tokens_for_messages(recent_messages)
        
        if recent_tokens >= token_budget:
            # If recent messages exceed budget, truncate to fit
            return self._truncate_to_fit(recent_messages, token_budget)
        
        # Add older messages if we have token budget remaining
        remaining_budget = token_budget - recent_tokens
        older_messages = messages[:-self.preserve_recent_messages] if len(messages) > self.preserve_recent_messages else []
        
        # Score older messages by relevance and recency
        scored_messages = self._score_messages_for_relevance(older_messages, messages[-1]['content'] if messages else "")
        
        # Add highest scoring messages that fit in budget
        selected_older = []
        for message, score in scored_messages:
            message_tokens = self._estimate_tokens(message['content'])
            if message_tokens <= remaining_budget:
                selected_older.append(message)
                remaining_budget -= message_tokens
            else:
                break
        
        # Combine in chronological order
        return selected_older + recent_messages
    
    def _score_messages_for_relevance(self, messages: List[dict], current_query: str) -> List[Tuple[dict, float]]:
        """
        Score messages by relevance to current query and recency
        """
        scored = []
        current_query_lower = current_query.lower()
        
        for i, message in enumerate(messages):
            score = 0.0
            content_lower = message['content'].lower()
            
            # Recency score (more recent = higher score)
            recency_score = (i + 1) / len(messages) * 0.3
            
            # Keyword overlap score
            current_words = set(current_query_lower.split())
            message_words = set(content_lower.split())
            overlap = len(current_words.intersection(message_words))
            keyword_score = min(overlap / max(len(current_words), 1) * 0.4, 0.4)
            
            # Role importance (user questions and document content more important)
            role_score = 0.3 if message['role'] in ['user', 'document'] else 0.1
            
            score = recency_score + keyword_score + role_score
            scored.append((message, score))
        
        # Sort by score descending
        return sorted(scored, key=lambda x: x[1], reverse=True)
    
    def _truncate_to_fit(self, messages: List[dict], token_budget: int) -> List[dict]:
        """
        Truncate messages to fit within token budget, preserving most recent
        """
        result = []
        current_tokens = 0
        
        # Add messages from most recent backward
        for message in reversed(messages):
            message_tokens = self._estimate_tokens(message['content'])
            if current_tokens + message_tokens <= token_budget:
                result.insert(0, message)
                current_tokens += message_tokens
            else:
                break
        
        return result
    
    def _format_for_provider(self, messages: List[dict], system_prompt: str, provider: str) -> List[dict]:
        """
        Format messages for specific LLM provider
        """
        if provider.lower() == "gemini":
            return self._format_for_gemini(messages, system_prompt)
        elif provider.lower() in ["ollama", "mistral"]:
            return self._format_for_ollama(messages, system_prompt)
        elif provider.lower() == "vllm":
            return self._format_for_vllm(messages, system_prompt)
        else:
            # Default format
            return [{"role": "system", "content": system_prompt}] + messages

    def _format_for_vllm(self, messages: List[dict], system_prompt: str) -> List[dict]:
        """
        Format messages for vLLM's OpenAI-compatible API.
        Normalizes custom persona roles to 'assistant' since the API
        only accepts system/user/assistant.
        """
        formatted = [{"role": "system", "content": system_prompt}]
        for message in messages:
            role = message["role"]
            content = message["content"]
            if role == "system":
                continue
            if role not in ("user", "assistant"):
                content = f"[{role.title()} Advisor]: {content}"
                role = "assistant"
            formatted.append({"role": role, "content": content})
        return formatted

    def _format_for_gemini(self, messages: List[dict], system_prompt: str) -> List[dict]:
        """
        Format messages for Gemini API (uses user/model roles with parts structure)
        FIXED VERSION - Better handles system messages and document context
        """
        formatted = []
        
        # Process all messages, handling system messages properly
        system_message_content = ""
        conversation_messages = []
        
        # Add initial system prompt if provided
        if system_prompt:
            system_message_content = system_prompt
        
        for message in messages:
            role = message['role']
            content = message['content']
            
            if role == 'system':
                # Accumulate system messages
                if system_message_content:
                    system_message_content += "\n\n" + content
                else:
                    system_message_content = content
            else:
                conversation_messages.append(message)
        
        # Add accumulated system content as initial exchange
        if system_message_content:
            formatted.extend([
                {
                    "role": "user",
                    "parts": [{"text": system_message_content}]
                },
                {
                    "role": "model",
                    "parts": [{"text": "I understand. I'll follow these instructions and use the document context you've provided."}]
                }
            ])
        
        # Convert conversation messages to Gemini format
        for message in conversation_messages:
            role = message['role']
            content = message['content']
            
            if role == 'user':
                formatted.append({
                    "role": "user",
                    "parts": [{"text": content}]
                })
            elif role in ['assistant', 'methodologist', 'theorist', 'pragmatist']:
                formatted.append({
                    "role": "model",
                    "parts": [{"text": content}]
                })
            elif role == 'document':
                # Add document as user context
                formatted.append({
                    "role": "user",
                    "parts": [{"text": f"[Context Document] {content}"}]
                })

        return formatted
    
    def _format_for_ollama(self, messages: List[dict], system_prompt: str) -> str:
        """
        Format messages for Ollama (returns formatted prompt string)
        """
        parts = [system_prompt] if system_prompt else []
        
        for message in messages:
            role = message['role'].capitalize()
            content = message['content']
            
            if role == 'Document':
                parts.append(f"Context: {content}")
            else:
                parts.append(f"{role}: {content}")
        
        parts.append("Assistant:")
        return "\n\n".join(parts)
    
    def _estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for text
        """
        return int(len(text) / self.chars_per_token)
    
    def _estimate_tokens_for_messages(self, messages: List[dict]) -> int:
        """
        Estimate total tokens for list of messages
        """
        if isinstance(messages, str):
            return self._estimate_tokens(messages)
        
        total = 0
        for message in messages:
            if isinstance(message, dict):
                if 'content' in message:
                    total += self._estimate_tokens(message['content'])
                elif 'parts' in message:
                    # Gemini format
                    for part in message['parts']:
                        if 'text' in part:
                            total += self._estimate_tokens(part['text'])
            else:
                total += self._estimate_tokens(str(message))
        
        return total
    
    def get_context_summary(self, messages: List[dict]) -> Dict[str, any]:
        """
        Get summary information about context
        """
        if not messages:
            return {"total_messages": 0, "estimated_tokens": 0, "roles": {}}
        
        role_counts = {}
        for message in messages:
            role = message.get('role', 'unknown')
            role_counts[role] = role_counts.get(role, 0) + 1
        
        return {
            "total_messages": len(messages),
            "estimated_tokens": self._estimate_tokens_for_messages(messages),
            "roles": role_counts,
            "oldest_message": messages[0].get('timestamp', 'unknown') if messages else None,
            "newest_message": messages[-1].get('timestamp', 'unknown') if messages else None
        }

# Global context manager instance
context_manager = ContextManager()

def get_context_manager() -> ContextManager:
    """Get the global context manager instance"""
    return context_manager