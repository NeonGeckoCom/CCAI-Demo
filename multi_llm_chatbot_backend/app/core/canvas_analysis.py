import re
import json
import logging
from typing import Dict, List, Tuple, Set
from datetime import datetime
from collections import defaultdict

from app.models.phd_canvas import CanvasInsight, CanvasSection
from app.llm.improved_gemini_client import ImprovedGeminiClient
from app.llm.improved_ollama_client import ImprovedOllamaClient
from app.config import get_settings

logger = logging.getLogger(__name__)

class CanvasAnalysisService:
    """Service for extracting and categorizing insights from chat messages"""
    
    def __init__(self, llm_client=None):
        self.llm_client = llm_client
        
        # Predefined section mappings for semantic analysis
        self.section_keywords = {
            "research_progress": [
                "progress", "milestone", "completed", "finished", "accomplished", 
                "achieved", "timeline", "deadline", "chapter", "draft", "version"
            ],
            "methodology": [
                "method", "methodology", "approach", "design", "data collection",
                "survey", "interview", "experiment", "analysis", "statistical", 
                "qualitative", "quantitative", "mixed methods"
            ],
            "theoretical_framework": [
                "theory", "theoretical", "framework", "concept", "model",
                "literature", "author", "philosophy", "paradigm", "assumption"
            ],
            "challenges_obstacles": [
                "challenge", "problem", "difficulty", "obstacle", "stuck",
                "confused", "frustrated", "struggle", "barrier", "issue"
            ],
            "next_steps": [
                "next", "plan", "should", "will", "going to", "need to",
                "action", "step", "priority", "focus", "goal", "objective"
            ],
            "writing_communication": [
                "write", "writing", "paper", "thesis", "dissertation", "publication",
                "communication", "presentation", "defense", "draft", "revision"
            ],
            "career_development": [
                "career", "job", "position", "networking", "conference",
                "skills", "CV", "resume", "application", "fellowship", "grant"
            ],
            "literature_review": [
                "literature", "sources", "papers", "articles", "bibliography",
                "citation", "author", "study", "research", "gap", "review"
            ],
            "data_analysis": [
                "data", "analysis", "results", "findings", "statistics",
                "coding", "software", "tool", "visualization", "pattern"
            ],
            "motivation_mindset": [
                "motivation", "confidence", "stress", "anxiety", "balance",
                "mental health", "mindset", "support", "overwhelmed", "burnout"
            ]
        }
    
    async def extract_insights_from_messages(self, messages: List[Dict], chat_session_id: str) -> List[CanvasInsight]:
        """Extract actionable insights from chat messages using semantic analysis"""
        try:
            insights = []
            
            for message in messages:
                # Handle the actual stored message format from your database
                msg_type = message.get("type", "")
                
                if msg_type == "advisor":
                    # This is the format used in your database
                    content = message.get("content", "")
                    persona_id = message.get("advisorName", message.get("persona", "advisor"))
                    message_id = message.get("id", str(message.get("_id", "")))
                    
                    if content and len(content.strip()) > 20:  # Only process substantial content
                        persona_insights = await self._extract_insights_from_content(
                            content, persona_id, message_id, chat_session_id
                        )
                        insights.extend(persona_insights)
                        logger.debug(f"Extracted {len(persona_insights)} insights from {persona_id} message")
                        
                elif msg_type == "assistant" and "responses" in message:
                    # Handle multi-persona responses (if this format exists)
                    for response in message.get("responses", []):
                        persona_insights = await self._extract_insights_from_persona_response(
                            response, message.get("id"), chat_session_id
                        )
                        insights.extend(persona_insights)
                        
                elif message.get("role") == "assistant" and message.get("content"):
                    # Handle converted message format (from export functions)
                    persona_insights = await self._extract_insights_from_content(
                        message.get("content", ""), "assistant", 
                        message.get("id"), chat_session_id
                    )
                    insights.extend(persona_insights)
            
            # Remove duplicates and low-confidence insights
            unique_insights = self._deduplicate_insights(insights)
            high_confidence_insights = [i for i in unique_insights if i.confidence_score >= 0.5]  # Lowered threshold
            
            logger.info(f"Extracted {len(high_confidence_insights)} insights from {len(messages)} messages")
            return high_confidence_insights
            
        except Exception as e:
            logger.error(f"Error extracting insights from messages: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return []
    
    async def _extract_insights_from_persona_response(self, response: Dict, message_id: str, chat_session_id: str) -> List[CanvasInsight]:
        """Extract insights from a single persona response"""
        persona_id = response.get("persona_id", "unknown")
        content = response.get("content", "")
        
        return await self._extract_insights_from_content(content, persona_id, message_id, chat_session_id)
    
    async def _extract_insights_from_content(self, content: str, persona_id: str, message_id: str, chat_session_id: str) -> List[CanvasInsight]:
        """Extract actionable insights from content using LLM analysis"""
        if not content or len(content.strip()) < 30:  # Lowered minimum length
            return []
        
        try:
            # Use LLM to extract key insights
            app_title = get_settings().app.title
            extraction_prompt = f"""
            Extract actionable insights from this {app_title} advisor response that would be valuable for a user's progress summary:

            PERSONA: {persona_id}
            CONTENT: {content}

            Return a JSON list of insights. Each insight should be:
            - Actionable and specific to the user's progress
            - 1-2 sentences long
            - Valuable for advisor meetings
            - Not generic advice

            Format: [{{"insight": "specific actionable insight here", "keywords": ["keyword1", "keyword2"]}}]
            
            Return ONLY the JSON array, no other text.
            """
            
            if self.llm_client:
                try:
                    llm_response = await self.llm_client.generate(
                        system_prompt=f"You are an expert at extracting actionable guidance from {app_title} advisor responses.",
                        context=[{"role": "user", "content": extraction_prompt}],
                        temperature=0.3,
                        max_tokens=500
                    )
                    
                    # Clean the response to extract just the JSON
                    llm_response = llm_response.strip()
                    if llm_response.startswith('```json'):
                        llm_response = llm_response[7:]
                    if llm_response.endswith('```'):
                        llm_response = llm_response[:-3]
                    llm_response = llm_response.strip()
                    
                    insights_data = json.loads(llm_response)
                    insights = []
                    
                    for item in insights_data:
                        if isinstance(item, dict) and "insight" in item:
                            insight = CanvasInsight(
                                content=item["insight"],
                                source_persona=persona_id,
                                source_message_id=message_id,
                                source_chat_session=chat_session_id,
                                confidence_score=0.8,  # High confidence from LLM extraction
                                keywords=item.get("keywords", [])
                            )
                            insights.append(insight)
                    
                    logger.debug(f"LLM extracted {len(insights)} insights from {persona_id}")
                    return insights
                    
                except json.JSONDecodeError as je:
                    logger.warning(f"Failed to parse LLM insights response for {persona_id}: {je}")
                    logger.debug(f"Raw LLM response: {llm_response}")
                    # Fallback to rule-based extraction
                    return self._extract_insights_rule_based(content, persona_id, message_id, chat_session_id)
                except Exception as llm_error:
                    logger.warning(f"LLM extraction failed for {persona_id}: {llm_error}")
                    # Fallback to rule-based extraction
                    return self._extract_insights_rule_based(content, persona_id, message_id, chat_session_id)
            
            # Fallback if no LLM available
            return self._extract_insights_rule_based(content, persona_id, message_id, chat_session_id)
            
        except Exception as e:
            logger.error(f"Error extracting insights from {persona_id} content: {e}")
            return []
    
    def _extract_insights_rule_based(self, content: str, persona_id: str, message_id: str, chat_session_id: str) -> List[CanvasInsight]:
        """Fallback rule-based insight extraction"""
        insights = []
        
        # Extract actionable sentences
        sentences = re.split(r'[.!?]+', content)
        actionable_patterns = [
            r"(?:you should|consider|try|focus on|prioritize|next step|recommended?|suggest)",
            r"(?:action item|goal|objective|plan|strategy)",
            r"(?:deadline|timeline|schedule|by \w+)",
            r"(?:complete|finish|work on|tackle|address)"
        ]
        
        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) < 15:  # Lowered minimum length
                continue
                
            # Check if sentence contains actionable language
            is_actionable = any(re.search(pattern, sentence, re.IGNORECASE) for pattern in actionable_patterns)
            
            if is_actionable:
                # Extract keywords
                keywords = self._extract_keywords_from_sentence(sentence)
                
                insight = CanvasInsight(
                    content=sentence,
                    source_persona=persona_id,
                    source_message_id=message_id,
                    source_chat_session=chat_session_id,
                    confidence_score=0.6,  # Lower confidence for rule-based
                    keywords=keywords
                )
                insights.append(insight)
        
        logger.debug(f"Rule-based extracted {len(insights)} insights from {persona_id}")
        return insights[:3]  # Limit to 3 insights per message to avoid noise
    
    def _extract_keywords_from_sentence(self, sentence: str) -> List[str]:
        """Extract relevant keywords from a sentence"""
        # Simple keyword extraction
        words = re.findall(r'\b\w{4,}\b', sentence.lower())  # Words with 4+ chars
        
        # Filter out common words
        stop_words = {
            "should", "could", "would", "your", "research", "work", "study", 
            "consider", "think", "important", "also", "really", "maybe",
            "probably", "definitely", "certainly", "particular", "specific"
        }
        
        keywords = [word for word in words if word not in stop_words]
        return keywords[:5]  # Limit to 5 keywords
    
    def categorize_insights(self, insights: List[CanvasInsight]) -> Dict[str, List[CanvasInsight]]:
        """Categorize insights into canvas sections using semantic analysis"""
        categorized = defaultdict(list)
        
        for insight in insights:
            section = self._determine_section(insight)
            categorized[section].append(insight)
        
        return dict(categorized)
    
    def _determine_section(self, insight: CanvasInsight) -> str:
        """Determine which section an insight belongs to"""
        content_lower = insight.content.lower()
        keywords_lower = [k.lower() for k in insight.keywords]
        all_text = content_lower + " " + " ".join(keywords_lower)
        
        # Score each section based on keyword matches
        section_scores = {}
        for section, keywords in self.section_keywords.items():
            score = sum(1 for keyword in keywords if keyword in all_text)
            if score > 0:
                section_scores[section] = score
        
        # Return the section with highest score, or default
        if section_scores:
            return max(section_scores, key=section_scores.get)
        else:
            return "general_notes"  # Default section
    
    def prioritize_insights(self, insights: List[CanvasInsight]) -> List[CanvasInsight]:
        """Sort insights by priority (confidence score and recency)"""
        return sorted(insights, key=lambda x: (x.confidence_score, x.extracted_at), reverse=True)
    
    def _deduplicate_insights(self, insights: List[CanvasInsight]) -> List[CanvasInsight]:
        """Remove duplicate or very similar insights"""
        if not insights:
            return insights
        
        unique_insights = []
        seen_content = set()
        
        for insight in insights:
            # Simple deduplication based on content similarity
            content_key = insight.content.lower().strip()[:100]  # First 100 chars
            
            if content_key not in seen_content:
                seen_content.add(content_key)
                unique_insights.append(insight)
        
        return unique_insights