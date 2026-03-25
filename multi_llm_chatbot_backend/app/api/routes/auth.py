from fastapi import APIRouter, HTTPException, Depends, status
from datetime import datetime, timedelta
from bson import ObjectId
from app.models.user import UserCreate, UserLogin, User, Token, UserResponse
from app.core.auth import (
    get_password_hash, 
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

router = APIRouter()

@router.post("/signup", response_model=Token)
async def signup(user_data: UserCreate):
    """Create a new user account"""
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
        hashed_password = get_password_hash(user_data.password_hash)
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
    """Login with email and password"""
    try:
        # Authenticate user
        user = await authenticate_user(user_credentials.email, user_credentials.password_hash)
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
    """Get current user profile"""
    return create_user_response(current_user)

@router.post("/logout")
async def logout():
    """Logout (client should discard token)"""
    return {"message": "Successfully logged out"}

@router.post("/verify-token", response_model=UserResponse)
async def verify_token(current_user: User = Depends(get_current_active_user)):
    """Verify token and return user info"""
    return create_user_response(current_user)