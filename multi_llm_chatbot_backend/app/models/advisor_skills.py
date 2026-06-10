from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AdvisorSkillSpecRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    use_when: str = Field(min_length=1, max_length=1800)
    how_to_work: List[str] = Field(default_factory=list)
    headings: List[Dict[str, str]] = Field(default_factory=list)
    preferred_advisors: List[str] = Field(default_factory=list)
    rag_policy: str = "optional"
    token_budgets: Dict[str, int] = Field(default_factory=dict)


class AdvisorSkillUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, min_length=1, max_length=500)
    use_when: Optional[str] = Field(default=None, min_length=1, max_length=1800)
    how_to_work: Optional[List[str]] = None
    headings: Optional[List[Dict[str, str]]] = None
    preferred_advisors: Optional[List[str]] = None
    rag_policy: Optional[str] = None
    token_budgets: Optional[Dict[str, int]] = None


class AdvisorSkillListResponse(BaseModel):
    default_skills: List[Dict[str, Any]]
    user_skills: List[Dict[str, Any]]
    items: List[Dict[str, Any]]
