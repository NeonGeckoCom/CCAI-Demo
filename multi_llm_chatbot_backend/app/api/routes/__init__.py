from fastapi import APIRouter
from .chat import router as chat_router
from .documents import router as document_router
from .sessions import router as session_router
from .provider import router as provider_router
from .debug import router as debug_router
from .root import router as root_router
from .voice import router as voice_router

router = APIRouter()
router.include_router(root_router, tags=["meta"])
router.include_router(chat_router, tags=["chat"])
router.include_router(document_router, tags=["documents"])
router.include_router(session_router, tags=["sessions"])
router.include_router(provider_router, tags=["provider"])
router.include_router(voice_router, tags=["voice"])
router.include_router(debug_router, tags=["debug"])
