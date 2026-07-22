"""Document library routes — the backend behind the Documents page.

Persists every uploaded file's extracted text per-user, exposes edit/delete,
and manages the accumulated per-user knowledge markdown that chat injects.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.auth import get_current_active_user
from app.core.library import (
    compare_documents,
    delete_document,
    get_document,
    get_knowledge,
    list_documents,
    save_document_record,
    schedule_document_analysis,
    set_knowledge,
    update_document,
)
from app.models.user import User
from app.parsing.document_extractor import extract_text_from_file, resolve_file_type

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_LIBRARY_FILE_BYTES = 10 * 1024 * 1024


class DocumentUpdateRequest(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    reanalyze: bool = False


class KnowledgeUpdateRequest(BaseModel):
    markdown: str = ""


class CompareRequest(BaseModel):
    against_id: Optional[str] = None


@router.post("/library/documents")
async def upload_library_document(
    file: UploadFile = File(...),
    source: str = Form("documents"),
    current_user: User = Depends(get_current_active_user),
):
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > MAX_LIBRARY_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10MB limit.")

    try:
        content = extract_text_from_file(file_bytes, file.content_type, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc))
    except Exception as exc:
        logger.info("Library parse failed for %s: %s", file.filename, exc)
        raise HTTPException(status_code=400, detail="Could not read this file.")

    doc = await save_document_record(
        user_id=str(current_user.id),
        filename=file.filename or "document.txt",
        content=content,
        source=source or "documents",
        file_type=resolve_file_type(file.content_type, file.filename),
        size=len(file_bytes),
    )
    if not doc:
        raise HTTPException(status_code=500, detail="Could not save the document.")
    return doc


@router.get("/library/documents")
async def list_library_documents(current_user: User = Depends(get_current_active_user)):
    return {"documents": await list_documents(str(current_user.id))}


@router.get("/library/documents/{doc_id}")
async def get_library_document(
    doc_id: str, current_user: User = Depends(get_current_active_user)
):
    doc = await get_document(str(current_user.id), doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.put("/library/documents/{doc_id}")
async def update_library_document(
    doc_id: str,
    body: DocumentUpdateRequest,
    current_user: User = Depends(get_current_active_user),
):
    doc = await update_document(
        str(current_user.id),
        doc_id,
        name=body.name,
        content=body.content,
        reanalyze=body.reanalyze,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.delete("/library/documents/{doc_id}")
async def delete_library_document(
    doc_id: str, current_user: User = Depends(get_current_active_user)
):
    ok = await delete_document(str(current_user.id), doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"deleted": True}


@router.post("/library/documents/{doc_id}/analyze")
async def reanalyze_library_document(
    doc_id: str, current_user: User = Depends(get_current_active_user)
):
    doc = await get_document(str(current_user.id), doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    schedule_document_analysis(str(current_user.id), doc_id)
    return {"status": "pending"}


@router.post("/library/documents/{doc_id}/compare")
async def compare_library_document(
    doc_id: str,
    body: Optional[CompareRequest] = None,
    current_user: User = Depends(get_current_active_user),
):
    """Diff this document against an earlier version (auto-detected unless
    an explicit against_id is given) and remember the changes."""
    comparison = await compare_documents(
        str(current_user.id), doc_id, against_id=body.against_id if body else None
    )
    if not comparison:
        raise HTTPException(
            status_code=404,
            detail="No earlier version of this document was found to compare against.",
        )
    return comparison


@router.get("/library/knowledge")
async def get_library_knowledge(current_user: User = Depends(get_current_active_user)):
    return await get_knowledge(str(current_user.id))


@router.put("/library/knowledge")
async def put_library_knowledge(
    body: KnowledgeUpdateRequest,
    current_user: User = Depends(get_current_active_user),
):
    return await set_knowledge(str(current_user.id), body.markdown)
