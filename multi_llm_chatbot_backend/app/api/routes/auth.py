from fastapi import APIRouter, HTTPException, Depends, status
from datetime import datetime, timedelta
from bson import ObjectId
from app.models.user import UserCreate, UserLogin, User, Token, UserResponse
from pydantic import BaseModel
from typing import Optional
from app.core.auth import (
    get_password_hash, 
    verify_password,
    authenticate_user, 
    create_access_token, 
    get_user_by_email,
    get_current_active_user,
    create_user_response,
    ACCESS_TOKEN_EXPIRE_MINUTES
)
from app.core.database import get_database
import logging

logger = logging.getLogger(__name__)


class MessageResponse(BaseModel):
    message: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None


class DeleteAccountRequest(BaseModel):
    password: str


router = APIRouter()

@router.post("/signup", response_model=Token)
async def signup(user_data: UserCreate):
    """
    Register a new user and return an access token.
    @param user_data: UserCreate with name, email, password, and optional academic fields
    @return: Token containing a JWT access token and the created UserResponse
    """
    try:
        db = get_database()
        
        # Check if user already exists
        existing_user = await get_user_by_email(user_data.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        
        # Create new user
        hashed_password = get_password_hash(user_data.password)
        user = User(
            firstName=user_data.firstName,
            lastName=user_data.lastName,
            email=user_data.email,
            hashed_password=hashed_password,
            academicStage=user_data.academicStage,
            researchArea=user_data.researchArea,
            created_at=datetime.utcnow(),
            is_active=True
        )
        
        # Insert user into database
        result = await db.users.insert_one(user.dict(by_alias=True))
        user.id = result.inserted_id
        
        # Create access token
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user.id)}, 
            expires_delta=access_token_expires
        )
        
        return Token(
            access_token=access_token,
            token_type="bearer",
            user=create_user_response(user)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during signup: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create user account"
        )

@router.post("/login", response_model=Token)
async def login(user_credentials: UserLogin):
    """
    Authenticate a user and return an access token.
    @param user_credentials: UserLogin with email and password
    @return: Token containing a JWT access token and the authenticated UserResponse
    """
    try:
        # Authenticate user
        user = await authenticate_user(user_credentials.email, user_credentials.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Update last login time
        db = get_database()
        await db.users.update_one(
            {"_id": user.id},
            {"$set": {"last_login": datetime.utcnow()}}
        )
        user.last_login = datetime.utcnow()
        
        # Create access token
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": str(user.id)}, 
            expires_delta=access_token_expires
        )
        
        return Token(
            access_token=access_token,
            token_type="bearer",
            user=create_user_response(user)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during login: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        )

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(current_user: User = Depends(get_current_active_user)):
    """
    Retrieve the profile of the currently authenticated user.
    @param current_user: Authenticated user from dependency injection
    @return: UserResponse with the user's profile information
    """
    return create_user_response(current_user)

@router.post("/logout", response_model=MessageResponse)
async def logout():
    """
    Log out the current user (client should discard the token).
    @return: MessageResponse with a confirmation message
    """
    return MessageResponse(message="Successfully logged out")

@router.post("/verify-token", response_model=UserResponse)
async def verify_token(current_user: User = Depends(get_current_active_user)):
    """
    Validate the caller's JWT and return their profile.
    @param current_user: Authenticated user from dependency injection
    @return: UserResponse with the user's profile information
    """
    return create_user_response(current_user)

@router.post("/me/password", response_model=MessageResponse)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Change the authenticated user's password.
    @param body: ChangePasswordRequest with the current and new passwords
    @param current_user: Authenticated user from dependency injection
    @return: MessageResponse with a confirmation message
    """
    try:
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )
        if len(body.new_password) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be at least 8 characters",
            )
        db = get_database()
        await db.users.update_one(
            {"_id": current_user.id},
            {"$set": {"hashed_password": get_password_hash(body.new_password)}},
        )
        return MessageResponse(message="Password changed successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during password change: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not change password"
        )

@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Update the authenticated user's profile fields.
    @param body: UpdateProfileRequest with optional firstName and lastName
    @param current_user: Authenticated user from dependency injection
    @return: UserResponse with the updated profile information
    """
    try:
        updates = {}
        if body.firstName is not None:
            updates["firstName"] = body.firstName.strip()
        if body.lastName is not None:
            updates["lastName"] = body.lastName.strip()
        if not updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update",
            )
        db = get_database()
        await db.users.update_one({"_id": current_user.id}, {"$set": updates})
        updated_user = await db.users.find_one({"_id": current_user.id})
        return create_user_response(User(**updated_user))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during profile update: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update profile"
        )

@router.delete("/me", response_model=MessageResponse)
async def delete_account(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Permanently delete the authenticated user's account and all chat sessions.
    @param body: DeleteAccountRequest with the user's password for confirmation
    @param current_user: Authenticated user from dependency injection
    @return: MessageResponse with a confirmation message
    """
    try:
        if not verify_password(body.password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect password",
            )
        db = get_database()
        uid = current_user.id
        await db.chat_sessions.delete_many({"user_id": uid})
        await db.users.delete_one({"_id": uid})
        return MessageResponse(message="Account deleted")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during account deletion: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete account"
        )