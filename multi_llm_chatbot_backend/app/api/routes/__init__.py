from fastapi import APIRouter
from .chat import router as chat_router
from .documents import router as document_router
from .sessions import router as session_router
from .provider import router as provider_router
from .debug import router as debug_router
from .root import router as root_router
from .phd_canvas import router as canvas_router
from .voice import router as voice_router

router = APIRouter()
router.include_router(chat_router)
router.include_router(document_router)
router.include_router(session_router)
router.include_router(provider_router)
router.include_router(debug_router)
router.include_router(root_router)
router.include_router(canvas_router)
router.include_router(voice_router, prefix="/api")