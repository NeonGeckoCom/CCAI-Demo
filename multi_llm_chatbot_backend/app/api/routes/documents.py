from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Body, Depends
from fastapi import Query
from app.utils.document_extractor import extract_text_from_file
from app.core.session_manager import get_session_manager
from app.core.rag_manager import get_rag_manager
from app.api.utils import get_or_create_session_for_request_async
from fastapi.responses import StreamingResponse
from app.utils.chat_summary import generate_summary_from_messages, parse_summary_to_blocks, format_summary_for_text_export
from app.utils.file_export import prepare_export_response, generate_pdf_file_from_blocks
from app.core.session_manager import get_session_manager
from app.core.bootstrap import chat_orchestrator
from app.api.routes.chat_sessions import persist_message
from app.core.auth import get_current_active_user
from app.core.database import get_database
from app.models.user import PersistMessage, User
from bson import ObjectId
import logging
import re
from html import unescape


logger = logging.getLogger(__name__)

router = APIRouter()

session_manager = get_session_manager()
get_rag_manager = get_rag_manager


def sanitize_html_content(content):
    """
    Clean up HTML content by removing or fixing malformed tags.
    This prevents PDF export errors caused by invalid HTML structure.
    """
    if not content:
        return content
    
    try:
        logger.debug(f"Sanitizing content (first 200 chars): {content[:200]}")
        
        # First, unescape HTML entities
        content = unescape(content)
        
        # More aggressive approach: Strip ALL HTML tags first, then apply simple formatting
        # This prevents malformed HTML from causing issues
        
        # Remove all HTML tags completely (most aggressive approach)
        content = re.sub(r'<[^>]*>', '', content)
        
        # Clean up multiple spaces and normalize whitespace
        content = re.sub(r'\s+', ' ', content)
        content = content.strip()
        
        # Remove any remaining HTML entities that might have been missed
        content = re.sub(r'&[a-zA-Z0-9#]+;', '', content)
        
        # Remove any remaining angle brackets that might cause issues
        content = content.replace('<', '').replace('>', '')
        
        logger.debug(f"Sanitized content (first 200 chars): {content[:200]}")
        return content
        
    except Exception as e:
        logger.error(f"Error sanitizing HTML content: {str(e)}")
        # Ultra-fallback: return only alphanumeric and basic punctuation
        try:
            import string
            allowed_chars = string.ascii_letters + string.digits + string.punctuation + ' \n\r\t'
            cleaned = ''.join(c for c in content if c in allowed_chars)
            return re.sub(r'\s+', ' ', cleaned).strip()
        except:
            return "Content could not be sanitized for export"

def convert_messages_for_export(messages):
    """
    Convert stored message format to export-compatible format.
    Stored format uses 'type', export functions expect 'role' and specific structure.
    """
    converted_messages = []
    
    for i, msg in enumerate(messages):
        try:
            # Get and sanitize content
            raw_content = msg.get('content', '')
            sanitized_content = sanitize_html_content(raw_content)
            
            # Debug logging for problematic content
            if i < 5 or '<' in raw_content or '>' in raw_content:  # Log first few messages and any with HTML
                logger.debug(f"Message {i}: Original length: {len(raw_content)}, Sanitized length: {len(sanitized_content)}")
                if raw_content != sanitized_content:
                    logger.debug(f"Content changed during sanitization for message {msg.get('id', 'unknown')}")
            
            # Create base converted message
            converted_msg = {
                'id': msg.get('id', 'unknown'),
                'timestamp': msg.get('timestamp', ''),
                'content': sanitized_content,
            }
            
            # Convert type to role and handle different message types
            msg_type = msg.get('type', 'unknown')
            
            if msg_type == 'user':
                converted_msg['role'] = 'user'
                # Add reply context if present
                if 'replyTo' in msg:
                    reply_to = msg['replyTo']
                    converted_msg['content'] = f"[Reply to {reply_to.get('advisorName', 'advisor')}] {converted_msg['content']}"
                
            elif msg_type == 'advisor':
                converted_msg['role'] = 'assistant'
                # Include advisor information
                advisor_name = msg.get('advisorName', msg.get('persona', 'Advisor'))
                converted_msg['advisor_name'] = advisor_name
                converted_msg['advisor_id'] = msg.get('advisorId', msg.get('persona_id', 'unknown'))
                
                # Mark special response types
                if msg.get('isReply'):
                    converted_msg['content'] = f"[{advisor_name} replies] {converted_msg['content']}"
                elif msg.get('isExpansion'):
                    converted_msg['content'] = f"[{advisor_name} expands] {converted_msg['content']}"
                else:
                    converted_msg['content'] = f"[{advisor_name}] {converted_msg['content']}"
                
            elif msg_type == 'system':
                converted_msg['role'] = 'system'
                
            elif msg_type == 'document_upload':
                converted_msg['role'] = 'system'
                converted_msg['content'] = f"📄 {converted_msg['content']}"
                
            elif msg_type == 'error':
                converted_msg['role'] = 'system'
                converted_msg['content'] = f"❌ Error: {converted_msg['content']}"
                
            else:
                # Unknown type, treat as system message
                converted_msg['role'] = 'system'
                converted_msg['content'] = f"[{msg_type}] {converted_msg['content']}"
            
            converted_messages.append(converted_msg)
            
        except Exception as e:
            logger.error(f"Error converting message {msg.get('id', 'unknown')}: {str(e)}")
            # Add a fallback message to maintain conversation flow
            converted_messages.append({
                'id': msg.get('id', 'unknown'),
                'role': 'system',
                'content': f"[Message conversion error: {str(e)}]",
                'timestamp': msg.get('timestamp', '')
            })
    
    logger.info(f"Converted {len(messages)} messages for export")
    return converted_messages


@router.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...), 
    request: Request = None,
    chat_session_id: str = Query(None, description="Chat session ID if uploading to specific chat"),
    current_user: User = Depends(get_current_active_user)  # ADDED: Require authentication
):
    try:
        if chat_session_id:
            # If uploading to a specific chat, use chat_{id} format
            session_id = f"chat_{chat_session_id}"
            logger.info(f"Uploading document to specific chat session: {session_id}")
        else:
            # For new/temporary chats, use regular session management
            session_id = await get_or_create_session_for_request_async(request)
            logger.info(f"Uploading document to new session: {session_id}")
        
        # Add debug logging to track session IDs
        logger.info(f"Document upload - chat_session_id parameter: {chat_session_id}")
        logger.info(f"Document upload - final session_id: {session_id}")
        logger.info(f"Document upload - user_id: {current_user.id}")
        
        session = session_manager.get_session(session_id)

        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        if file.size and file.size > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File size exceeds 10MB limit")

        file_bytes = await file.read()
        content = extract_text_from_file(file_bytes, file.content_type)
        if not content.strip():
            raise HTTPException(status_code=400, detail="Document is empty or unreadable.")

        rag_manager = get_rag_manager()
        file_type_map = {
            "application/pdf": "pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", 
            "text/plain": "txt"
        }
        file_type = file_type_map.get(file.content_type, "unknown")

        # Pass the consistent session_id to RAG manager
        logger.info(f"Adding document {file.filename} to session {session_id}")
        rag_result = rag_manager.add_document(
            content=content,
            filename=file.filename,
            session_id=session_id,
            file_type=file_type
        )

        if not rag_result["success"]:
            raise HTTPException(status_code=500, detail=f"Failed to process document: {rag_result.get('error', 'Unknown error')}")

        session.uploaded_files.append(file.filename)
        session.total_upload_size += len(file_bytes)

        doc_metadata = rag_result.get("document_metadata", {})
        doc_title = doc_metadata.get("title", file.filename)

        session.append_message(
            "system", 
            f"Document uploaded: '{doc_title}' ({file.filename}) - {rag_result['chunks_created']} sections processed, ~{rag_result['total_tokens']} tokens analyzed. You can now ask questions about this document by referencing it by name."
        )

        if chat_session_id:
            await persist_message(chat_session_id, PersistMessage(
                type="document_upload",
                content=f"Document uploaded: {file.filename} ({rag_result['chunks_created']} sections processed)",
            ))

        # Return session info for frontend tracking
        return {
            "message": f"Document '{file.filename}' uploaded and processed successfully.",
            "filename": file.filename,
            "document_title": doc_title,
            "chunks_created": rag_result['chunks_created'],
            "total_tokens": rag_result['total_tokens'],
            "file_type": file_type,
            "can_reference_by_name": True,
            "session_id": session_id,
            "chat_session_id": chat_session_id,
            "user_id": str(current_user.id)  # ADDED: Include user ID for debugging
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing document upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")


@router.post("/search-documents")
async def search_documents(request: Request, query: str = Body(..., embed=True), persona: str = Body("", embed=True)):
    try:
        session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
        rag_manager = get_rag_manager()

        persona_contexts = {
            "methodologist": "methodology research design analysis",
            "theorist": "theory theoretical framework conceptual",
            "pragmatist": "practical application implementation"
        }
        persona_context = persona_contexts.get(persona, "")

        results = rag_manager.search_documents(
            query=query,
            session_id=session_id,
            persona_context=persona_context,
            n_results=5
        )

        return {
            "query": query,
            "persona_filter": persona,
            "results_count": len(results),
            "results": results
        }

    except Exception as e:
        logger.error(f"Error searching documents: {str(e)}")
        return {"query": query, "results_count": 0, "results": [], "error": str(e)}


@router.get("/document-stats")
async def get_document_stats(request: Request):
    try:
        session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
        rag_manager = get_rag_manager()
        return rag_manager.get_document_stats(session_id)
    except Exception as e:
        logger.error(f"Error getting document stats: {str(e)}")
        return {"total_chunks": 0, "total_documents": 0, "documents": []}


@router.get("/uploaded-files")
async def get_uploaded_filenames(request: Request):
    try:
        session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
        session = session_manager.get_session(session_id)
        return {"files": session.uploaded_files}
    except Exception as e:
        logger.error(f"Error getting uploaded files: {str(e)}")
        return {"files": []}


@router.get("/document-insights/{filename}")
async def get_document_insights(filename: str, request: Request):
    try:
        session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
        rag_manager = get_rag_manager()
        stats = rag_manager.get_document_stats(session_id)
        document_info = next((doc for doc in stats.get("documents", []) if doc["filename"] == filename), None)

        if not document_info:
            raise HTTPException(status_code=404, detail=f"Document {filename} not found")

        results = rag_manager.collection.get(
            where={"session_id": session_id, "filename": filename},
            limit=3,
            include=["documents", "metadatas"]
        )

        sample_sections = []
        if results["documents"]:
            for doc, metadata in zip(results["documents"], results["metadatas"]):
                sample_sections.append({
                    "section": metadata.get("document_section", "unknown"),
                    "content_preview": doc[:200] + "..." if len(doc) > 200 else doc,
                    "keywords": metadata.get("keywords", "")
                })

        return {
            "filename": filename,
            "document_title": document_info.get("title", filename),
            "file_type": document_info.get("file_type", "unknown"),
            "statistics": {
                "total_chunks": document_info["chunks"],
                "estimated_tokens": document_info["estimated_tokens"],
                "sections_identified": document_info["sections"]
            },
            "content_analysis": {
                "has_methodology": document_info.get("has_methodology", False),
                "has_theory": document_info.get("has_theory", False),
                "has_references": document_info.get("has_references", False)
            },
            "sample_sections": sample_sections
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting document insights: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error analyzing document: {str(e)}")
    
@router.get("/export-chat")
async def export_chat(
    request: Request, 
    format: str = Query(..., regex="^(txt|pdf|docx)$"),
    chat_session_id: str = Query(None, description="Optional: specific chat session ID to export"),
    current_user: User = Depends(get_current_active_user)
):
    """
    Export chat messages. 
    If chat_session_id is provided, exports that specific stored chat session.
    Otherwise, exports the current in-memory session.
    """
    try:
        messages = []
        
        if chat_session_id:
            # Export specific stored chat session
            db = get_database()
            session_data = await db.chat_sessions.find_one({
                "_id": ObjectId(chat_session_id),
                "user_id": current_user.id,
                "is_active": True
            })
            
            if not session_data:
                raise HTTPException(
                    status_code=404, 
                    detail="Chat session not found or you don't have permission to access it"
                )
            
            raw_messages = session_data.get("messages", [])
            # Convert stored message format to export-compatible format
            messages = convert_messages_for_export(raw_messages)
        else:
            # Export current in-memory session (existing behavior)
            session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
            session = session_manager.get_session(session_id)
            # In-memory messages might already be in the right format, but convert to be safe
            messages = convert_messages_for_export(session.messages)

        if not messages:
            return {"error": "No messages in this session."}

        try:
            return prepare_export_response(messages, format)
        except Exception as export_error:
            logger.error(f"Error in prepare_export_response: {str(export_error)}")
            # Try with a simplified version of messages if the export fails
            try:
                # Create simplified messages with just basic text content
                simplified_messages = []
                for msg in messages:
                    simplified_msg = {
                        'id': msg.get('id', 'unknown'),
                        'role': msg.get('role', 'system'),
                        'content': str(msg.get('content', '')).replace('\n', ' ').strip(),
                        'timestamp': msg.get('timestamp', '')
                    }
                    if 'advisor_name' in msg:
                        simplified_msg['advisor_name'] = msg['advisor_name']
                    simplified_messages.append(simplified_msg)
                
                return prepare_export_response(simplified_messages, format)
            except Exception as fallback_error:
                logger.error(f"Fallback export also failed: {str(fallback_error)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Export failed due to content formatting issues. Please try a different format or contact support."
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting chat: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to export chat: {str(e)}"
        )

@router.get("/chat-summary")
async def chat_summary(
    request: Request,
    format: str = Query("text", regex="^(txt|pdf|docx)$"),
    chat_session_id: str = Query(None, description="Optional: specific chat session ID to summarize"),
    current_user: User = Depends(get_current_active_user)
):
    """
    Generate and return a summary of chat messages.
    If chat_session_id is provided, summarizes that specific stored chat session.
    Otherwise, summarizes the current in-memory session.
    Can return as plain txt, PDF, or DOCX.
    """
    try:
        messages = []
        
        if chat_session_id:
            # Summarize specific stored chat session
            db = get_database()
            session_data = await db.chat_sessions.find_one({
                "_id": ObjectId(chat_session_id),
                "user_id": current_user.id,
                "is_active": True
            })
            
            if not session_data:
                raise HTTPException(
                    status_code=404, 
                    detail="Chat session not found or you don't have permission to access it"
                )
            
            raw_messages = session_data.get("messages", [])
            # Convert stored message format for summary generation
            messages = convert_messages_for_export(raw_messages)
        else:
            # Summarize current in-memory session (existing behavior)
            session_id = await get_or_create_session_for_request_async(request)  # FIXED: Added await
            session = session_manager.get_session(session_id)
            # Convert in-memory messages
            messages = convert_messages_for_export(session.messages)

        if not messages:
            return {"error": "No messages in this session."}

        try:
            llm = next(iter(chat_orchestrator.personas.values())).llm
            summary_text = await generate_summary_from_messages(messages, llm)

            if format == "txt":
                # Use improved formatting for text export
                formatted_summary = format_summary_for_text_export(summary_text)
                return prepare_export_response(formatted_summary, "txt", filename_prefix="chat_summary")

            elif format == "docx":
                # Use improved formatting for DOCX export
                formatted_summary = format_summary_for_text_export(summary_text)
                return prepare_export_response(formatted_summary, "docx", filename_prefix="chat_summary")

            elif format == "pdf":
                # Parse and render using block formatting
                blocks = [{"type": "heading", "text": "Chat Summary"}] + parse_summary_to_blocks(summary_text)

                file_stream = generate_pdf_file_from_blocks(blocks)
                return StreamingResponse(
                    file_stream,
                    media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=chat_summary.pdf"}
                )
        except Exception as summary_error:
            logger.error(f"Error generating summary: {str(summary_error)}")
            # Try with simplified content
            try:
                # Create a basic text summary if AI summary fails
                basic_summary = "Chat Summary\n\n"
                for msg in messages:
                    if msg.get('role') == 'user':
                        basic_summary += f"User: {msg.get('content', '')[:200]}...\n\n"
                    elif msg.get('role') == 'assistant':
                        advisor_name = msg.get('advisor_name', 'Advisor')
                        basic_summary += f"{advisor_name}: {msg.get('content', '')[:200]}...\n\n"
                
                if format == "txt":
                    return prepare_export_response(basic_summary, "txt", filename_prefix="chat_summary")
                elif format == "docx":
                    return prepare_export_response(basic_summary, "docx", filename_prefix="chat_summary")
                elif format == "pdf":
                    blocks = [{"type": "heading", "text": "Chat Summary"}, {"type": "paragraph", "text": basic_summary}]
                    file_stream = generate_pdf_file_from_blocks(blocks)
                    return StreamingResponse(
                        file_stream,
                        media_type="application/pdf",
                        headers={"Content-Disposition": "attachment; filename=chat_summary.pdf"}
                    )
            except Exception as fallback_error:
                logger.error(f"Fallback summary export also failed: {str(fallback_error)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Summary generation failed due to content formatting issues. Please try a different format."
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat-summary endpoint: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Summary generation failed: {str(e)}"
        )