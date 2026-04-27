from datetime import datetime
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.auth import get_current_active_user
from app.core.database import get_database
from app.models.user import User

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class AvatarPreferencesResponse(BaseModel):
    avatar_overrides: Dict[str, str] = {}
    custom_avatars: List[str] = []


class UpdateAvatarOverrideRequest(BaseModel):
    advisor_id: str
    url: str


class AddCustomAvatarRequest(BaseModel):
    url: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/avatar-preferences", response_model=AvatarPreferencesResponse)
async def get_avatar_preferences(
    current_user: User = Depends(get_current_active_user),
):
    """
    Return the authenticated user's avatar overrides and custom avatar list.
    @param current_user: Authenticated user from dependency injection
    @return: AvatarPreferencesResponse with avatar_overrides dict and custom_avatars list
    """
    try:
        db = get_database()
        doc = await db.user_preferences.find_one({"user_id": current_user.id})
        if not doc:
            return AvatarPreferencesResponse()
        return AvatarPreferencesResponse(
            avatar_overrides=doc.get("avatar_overrides", {}),
            custom_avatars=doc.get("custom_avatars", []),
        )
    except Exception as e:
        logger.error(f"Error fetching avatar preferences: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not fetch avatar preferences",
        )


@router.put("/avatar-preferences/overrides")
async def set_avatar_override(
    body: UpdateAvatarOverrideRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Set or reset the avatar override for a single advisor.
    @param body: UpdateAvatarOverrideRequest with advisor_id and avatar URL
    @param current_user: Authenticated user from dependency injection
    @return: Message confirming the override was saved
    """
    try:
        db = get_database()
        await db.user_preferences.update_one(
            {"user_id": current_user.id},
            {
                "$set": {
                    f"avatar_overrides.{body.advisor_id}": body.url,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
        return {"message": "Avatar override saved"}
    except Exception as e:
        logger.error(f"Error saving avatar override: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save avatar override",
        )


@router.post("/avatar-preferences/custom-avatars")
async def add_custom_avatar(
    body: AddCustomAvatarRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Add a URL to the user's personal custom-avatar gallery.
    @param body: AddCustomAvatarRequest with the image URL to add
    @param current_user: Authenticated user from dependency injection
    @return: Message confirming the custom avatar was added
    """
    try:
        db = get_database()
        await db.user_preferences.update_one(
            {"user_id": current_user.id},
            {
                "$addToSet": {"custom_avatars": body.url},
                "$set": {"updated_at": datetime.utcnow()},
            },
            upsert=True,
        )
        return {"message": "Custom avatar added"}
    except Exception as e:
        logger.error(f"Error adding custom avatar: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not add custom avatar",
        )
