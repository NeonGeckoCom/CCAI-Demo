import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.advisor_skills.registry import ADVISOR_SKILLS
from app.advisor_skills.user_skills import (
    create_user_advisor_skill,
    delete_user_advisor_skill,
    get_user_advisor_skill_map,
    serialize_advisor_skill,
    update_user_advisor_skill,
)
from app.core.auth import get_current_active_user
from app.models.advisor_skills import (
    AdvisorSkillListResponse,
    AdvisorSkillSpecRequest,
    AdvisorSkillUpdateRequest,
)
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/advisor-skills", response_model=AdvisorSkillListResponse)
async def list_advisor_skills(
    current_user: User = Depends(get_current_active_user),
):
    """List default skills plus this user's editable custom skills."""
    default_skills = [
        serialize_advisor_skill(skill, scope="default")
        for skill in ADVISOR_SKILLS.values()
    ]
    user_skills = [
        serialize_advisor_skill(skill, scope="user")
        for skill in (await get_user_advisor_skill_map(current_user.id)).values()
    ]
    return AdvisorSkillListResponse(
        default_skills=default_skills,
        user_skills=user_skills,
        items=default_skills + user_skills,
    )


@router.post("/advisor-skills", status_code=status.HTTP_201_CREATED)
async def create_advisor_skill(
    body: AdvisorSkillSpecRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Create an editable custom skill owned by the authenticated user."""
    skill = await create_user_advisor_skill(current_user.id, body.model_dump())
    return serialize_advisor_skill(skill, scope="user")


@router.put("/advisor-skills/{skill_id}")
async def update_advisor_skill(
    skill_id: str,
    body: AdvisorSkillUpdateRequest,
    current_user: User = Depends(get_current_active_user),
):
    """Replace/edit an authenticated user's custom advisor skill."""
    if skill_id in ADVISOR_SKILLS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Default advisor skills are read-only.",
        )
    skill = await update_user_advisor_skill(
        current_user.id,
        skill_id,
        body.model_dump(exclude_unset=True),
    )
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Advisor skill not found")
    return serialize_advisor_skill(skill, scope="user")


@router.delete("/advisor-skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_advisor_skill(
    skill_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Delete an authenticated user's custom advisor skill."""
    if skill_id in ADVISOR_SKILLS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Default advisor skills cannot be deleted.",
        )
    deleted = await delete_user_advisor_skill(current_user.id, skill_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Advisor skill not found")
    return None
