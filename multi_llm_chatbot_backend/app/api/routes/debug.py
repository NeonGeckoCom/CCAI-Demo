from fastapi import APIRouter, Request, Query
from app.core.session_manager import get_session_manager
from app.rag.manager import get_rag_manager
from app.core.bootstrap import chat_orchestrator
import logging

from app.api.utils import get_or_create_session_for_request_async

logger = logging.getLogger(__name__)

router = APIRouter()

session_manager = get_session_manager()

@router.get("/debug/personas")
async def debug_personas(request: Request):
    try:
        session_id = await get_or_create_session_for_request_async(request)
        session = session_manager.get_session(session_id)
        rag_manager = get_rag_manager()
        rag_stats = rag_manager.get_document_stats(session_id)

        return {
            "personas": {
                pid: {
                    "name": persona.name,
                    "prompt": persona.system_prompt[:100] + "...",
                } for pid, persona in chat_orchestrator.personas.items()
            },
            "session_info": {
                "context_length": len(session.messages),
                "uploaded_files": session.uploaded_files,
                "rag_stats": rag_stats
            }
        }
    except Exception as e:
        logger.error(f"Error in debug endpoint: {str(e)}")
        return {
            "personas": {},
            "session_info": {"context_length": 0},
            "error": str(e)
        }

@router.get("/debug/ranked-personas")
async def get_ranked_personas(request: Request, k: int = Query(3, ge=1, le=10)):
    try:
        session_id = await get_or_create_session_for_request_async(request)
        top_personas = await chat_orchestrator.get_top_personas(session_id=session_id, k=k)
        return {
            "ranked_personas": top_personas,
            "available_personas": list(chat_orchestrator.personas.keys()),
            "session_id": session_id
        }
    except Exception as e:
        logger.error(f"Error in /debug/ranked-personas: {e}")
        return {
            "ranked_personas": [],
            "error": str(e)
        }

@router.get("/debug/rag-status")
async def debug_rag_status(request: Request):
    try:
        session_id = await get_or_create_session_for_request_async(request)
        rag_manager = get_rag_manager()
        session_stats = session_manager.get_session_stats(session_id)

        test_search = rag_manager.search_documents_with_context(
            query="test methodology research",
            session_id=session_id,
            n_results=3
        )

        return {
            "rag_manager_healthy": True,
            "session_id": session_id,
            "session_stats": session_stats.get("rag_stats", {}),
            "test_search_results": len(test_search),
            "test_search_details": [
                {
                    "relevance": chunk.get("relevance_score", 0),
                    "distance": chunk.get("distance", "unknown"),
                    "text_length": len(chunk.get("text", "")),
                    "filename": chunk.get("metadata", {}).get("filename", "unknown")
                }
                for chunk in test_search[:3]
            ],
        }

    except Exception as e:
        logger.error(f"Error in RAG debug: {str(e)}")
        return {
            "rag_manager_healthy": False,
            "error": str(e),
            "session_id": session_id if 'session_id' in locals() else "unknown"
        }
