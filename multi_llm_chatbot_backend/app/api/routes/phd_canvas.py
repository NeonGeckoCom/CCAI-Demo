from fastapi import APIRouter, HTTPException, Depends, status, BackgroundTasks
import logging
from bson import ObjectId

from app.models.user import User
from app.models.phd_canvas import CanvasResponse, UpdateCanvasRequest, CanvasStatsResponse, PrintCanvasResponse
from app.core.auth import get_current_active_user
from app.core.database import get_database

logger = logging.getLogger(__name__)
router = APIRouter()


def get_canvas_manager():
    """Lazy import to avoid circular dependency"""
    from app.core.canvas_manager import get_canvas_manager
    return get_canvas_manager()

@router.get("/phd-canvas", response_model=CanvasResponse)
async def get_phd_canvas(
    current_user: User = Depends(get_current_active_user)
):
    """Get the user's PhD Canvas, creating it if it doesn't exist"""
    try:
        canvas_manager = get_canvas_manager()
        canvas = await canvas_manager.get_or_create_canvas(str(current_user.id))
        
        # Convert to response model
        return CanvasResponse(
            id=str(canvas.id),
            user_id=str(canvas.user_id),
            sections=canvas.sections,
            created_at=canvas.created_at,
            last_updated=canvas.last_updated,
            last_chat_processed=canvas.last_chat_processed,
            total_insights=canvas.total_insights,
            auto_update=canvas.auto_update,
            print_optimized=canvas.print_optimized
        )
        
    except Exception as e:
        logger.error(f"Error getting PhD canvas for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve PhD canvas"
        )

@router.post("/phd-canvas/update", response_model=CanvasResponse)
async def update_phd_canvas(
    request: UpdateCanvasRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user)
):
    """Update the PhD Canvas with latest insights from chat sessions"""
    try:
        canvas_manager = get_canvas_manager()
        
        # For large updates, run in background
        if request.force_full_update:
            logger.info(f"Queuing background canvas update for user {current_user.id}")
            background_tasks.add_task(
                _background_canvas_update,
                str(current_user.id),
                request
            )
            
            # Return current canvas immediately
            canvas = await canvas_manager.get_or_create_canvas(str(current_user.id))
        else:
            # For incremental updates, process immediately
            logger.info(f"Processing incremental canvas update for user {current_user.id}")
            canvas = await canvas_manager.update_canvas(str(current_user.id), request)
        
        return CanvasResponse(
            id=str(canvas.id),
            user_id=str(canvas.user_id),
            sections=canvas.sections,
            created_at=canvas.created_at,
            last_updated=canvas.last_updated,
            last_chat_processed=canvas.last_chat_processed,
            total_insights=canvas.total_insights,
            auto_update=canvas.auto_update,
            print_optimized=canvas.print_optimized
        )
        
    except Exception as e:
        logger.error(f"Error updating PhD canvas for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update PhD canvas"
        )

@router.get("/phd-canvas/stats", response_model=CanvasStatsResponse)
async def get_canvas_stats(
    current_user: User = Depends(get_current_active_user)
):
    """Get statistics about the user's PhD Canvas"""
    try:
        canvas_manager = get_canvas_manager()
        stats = await canvas_manager.get_canvas_stats(str(current_user.id))
        
        return CanvasStatsResponse(
            total_insights=stats.get("total_insights", 0),
            total_sections=stats.get("total_sections", 0),
            last_updated=stats.get("last_updated").isoformat() if stats.get("last_updated") else None,
            last_chat_processed=stats.get("last_chat_processed").isoformat() if stats.get("last_chat_processed") else None,
            created_at=stats.get("created_at").isoformat() if stats.get("created_at") else None,
            auto_update=stats.get("auto_update", True),
            sections_breakdown=stats.get("sections_breakdown", {})
        )
        
    except Exception as e:
        logger.error(f"Error getting canvas stats for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve canvas statistics"
        )

@router.get("/phd-canvas/print", response_model=PrintCanvasResponse)
async def get_print_canvas(
    current_user: User = Depends(get_current_active_user)
):
    """Get PhD Canvas formatted for printing"""
    try:
        canvas_manager = get_canvas_manager()
        print_data = await canvas_manager.export_canvas_for_printing(str(current_user.id))
        
        return PrintCanvasResponse(
            user_id=print_data["user_id"],
            generated_at=print_data["generated_at"].isoformat(),
            total_insights=print_data["total_insights"],
            last_updated=print_data["last_updated"].isoformat() if print_data["last_updated"] else None,
            sections=print_data["sections"],
            metadata=print_data["metadata"]
        )
        
    except Exception as e:
        logger.error(f"Error exporting print canvas for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export canvas for printing"
        )

@router.post("/phd-canvas/auto-update")
async def trigger_auto_update(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user)
):
    """Trigger automatic canvas update (typically called when user opens canvas page)"""
    try:
        canvas_manager = get_canvas_manager()
        db = get_database()
        
        # Get current canvas to check if auto-update is needed
        canvas = await canvas_manager.get_or_create_canvas(str(current_user.id))
        
        if not canvas.auto_update:
            return {"message": "Auto-update is disabled for this canvas"}
        
        # Check if this is a first-time canvas (never processed any chats)
        is_first_time_canvas = (
            canvas.last_chat_processed is None and 
            canvas.total_insights == 0
        )
        
        if is_first_time_canvas:
            logger.info(f"First-time canvas detected for user {current_user.id}, triggering full update")
            
            # For first-time canvas, always do full update to process all historical chats
            background_tasks.add_task(
                _background_canvas_update,
                str(current_user.id),
                UpdateCanvasRequest(force_full_update=True)
            )
            
            return {
                "message": "First-time canvas update initiated", 
                "status": "processing",
                "type": "full_update"
            }
        
        # For existing canvas, check if there are actually new chats
        user_object_id = ObjectId(str(current_user.id))
        
        # Count chats newer than last processed
        query_filter = {
            "user_id": user_object_id,
            "is_active": {"$ne": False},
            "deleted_at": {"$exists": False}
        }
        
        if canvas.last_chat_processed:
            query_filter["$or"] = [
                {"created_at": {"$gt": canvas.last_chat_processed}},
                {"updated_at": {"$gt": canvas.last_chat_processed}}
            ]
        
        new_chat_count = await db.chat_sessions.count_documents(query_filter)
        
        if new_chat_count > 0:
            logger.info(f"Found {new_chat_count} new/updated chats for user {current_user.id}, triggering incremental update")
            
            # Only update if there are actually new chats
            background_tasks.add_task(
                _background_canvas_update,
                str(current_user.id),
                UpdateCanvasRequest(force_full_update=False)
            )
            
            return {
                "message": f"Canvas update queued for {new_chat_count} new chats", 
                "status": "updating",
                "type": "incremental_update",
                "new_chats": new_chat_count
            }
        else:
            logger.info(f"No new chats found for user {current_user.id}, skipping update")
            return {
                "message": "Canvas is up to date", 
                "status": "current",
                "new_chats": 0
            }
            
    except Exception as e:
        logger.error(f"Error triggering auto-update for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to trigger canvas auto-update"
        )

@router.delete("/phd-canvas")
async def delete_canvas(
    current_user: User = Depends(get_current_active_user)
):
    """Delete the user's PhD Canvas"""
    try:
        canvas_manager = get_canvas_manager()
        deleted = await canvas_manager.delete_canvas(str(current_user.id))
        
        if deleted:
            return {"message": "PhD Canvas deleted successfully"}
        else:
            return {"message": "No canvas found to delete"}
            
    except Exception as e:
        logger.error(f"Error deleting canvas for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete PhD canvas"
        )

@router.get("/phd-canvas/refresh")
async def refresh_canvas_data(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user)
):
    """Force refresh canvas with full update from all chats"""
    try:
        logger.info(f"Force refreshing canvas for user {current_user.id}")
        
        # Queue full update in background
        background_tasks.add_task(
            _background_canvas_update,
            str(current_user.id),
            UpdateCanvasRequest(force_full_update=True)
        )
        
        return {
            "message": "Full canvas refresh initiated",
            "status": "processing",
            "estimated_completion": "2-3 minutes"
        }
        
    except Exception as e:
        logger.error(f"Error refreshing canvas for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to refresh PhD canvas"
        )

# Background task functions
async def _background_canvas_update(user_id: str, request: UpdateCanvasRequest):
    """Background task to update canvas without blocking the API response"""
    try:
        logger.info(f"Starting background canvas update for user {user_id}")
        canvas_manager = get_canvas_manager()
        
        updated_canvas = await canvas_manager.update_canvas(user_id, request)
        
        logger.info(f"Background canvas update completed for user {user_id}. Total insights: {updated_canvas.total_insights}")
        
    except Exception as e:
        logger.error(f"Error in background canvas update for user {user_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
