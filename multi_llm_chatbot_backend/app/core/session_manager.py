from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import uuid
from dataclasses import dataclass
from threading import Lock
from app.rag.manager import get_rag_manager

@dataclass
class ConversationContext:
    """Enhanced conversation context for RAG integration"""
    
    def __init__(self, session_id: str = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.messages: List[Dict[str, str]] = []
        self.uploaded_files: List[str] = []  # Now just stores filenames, not content
        self.total_upload_size: int = 0  # For tracking purposes only
        self.created_at = datetime.now()
        self.last_accessed = datetime.now()
        
        # New RAG-related attributes
        self.document_chunks_count: int = 0  # Track total chunks in vector DB
        self.last_retrieval_stats: Dict[str, Any] = {}  # Last RAG retrieval info

    def append_message(self, role: str, content: str):
        """Add a message to the conversation history"""
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        self.last_accessed = datetime.now()

    def clear_messages(self):
        """Clear conversation messages but keep document references"""
        self.messages.clear()
        self.last_accessed = datetime.now()

    def get_messages_by_role(self, role: str) -> List[Dict[str, str]]:
        """Get all messages by a specific role - ADDED METHOD"""
        return [msg for msg in self.messages if msg.get('role') == role]
    
    def get_recent_messages(self, count: int = 10) -> List[Dict[str, str]]:
        """Get the most recent N messages"""
        return self.messages[-count:] if len(self.messages) > count else self.messages
    
    def get_user_messages(self) -> List[Dict[str, str]]:
        """Get all user messages"""
        return self.get_messages_by_role('user')
    
    def get_latest_user_message(self) -> Optional[str]:
        """Get the content of the most recent user message"""
        user_messages = self.get_user_messages()
        return user_messages[-1]['content'] if user_messages else None

    def add_uploaded_file(self, filename: str, content: str, file_size: int):
        """
        Add uploaded file - MODIFIED FOR RAG
        
        Now we only track the filename and size in session context.
        The actual content goes to the vector database via RAG manager.
        """
        self.uploaded_files.append(filename)
        self.total_upload_size += file_size
        
        # Add a system message noting the upload (not the full content)
        self.append_message("system", f"Document '{filename}' uploaded and processed into vector database")
        
        # Update document chunk count from RAG manager
        try:
            rag_manager = get_rag_manager()
            stats = rag_manager.get_document_stats(self.session_id)
            self.document_chunks_count = stats.get("total_chunks", 0)
        except Exception as e:
            print(f"Warning: Could not update chunk count: {e}")

    def get_context_size(self) -> int:
        """Calculate conversation context size in characters (excluding vector DB documents)"""
        return sum(len(msg['content']) for msg in self.messages)
    
    def get_rag_stats(self) -> Dict[str, Any]:
        """Get statistics about documents in vector database for this session"""
        try:
            rag_manager = get_rag_manager()
            return rag_manager.get_document_stats(self.session_id)
        except Exception as e:
            return {"error": str(e), "total_chunks": 0, "total_documents": 0}

    def clear_all_data(self):
        """Clear both conversation and vector database documents"""
        # Clear conversation messages
        self.clear_messages()
        
        # Clear vector database documents
        try:
            rag_manager = get_rag_manager()
            success = rag_manager.delete_session_documents(self.session_id)
            if success:
                self.uploaded_files.clear()
                self.total_upload_size = 0
                self.document_chunks_count = 0
                self.append_message("system", "All conversation history and documents cleared")
            else:
                self.append_message("system", "Conversation cleared, but some documents may remain")
        except Exception as e:
            self.append_message("system", f"Conversation cleared, document cleanup failed: {str(e)}")

class SessionManager:
    """Thread-safe session manager for handling multiple user conversations"""
    
    def __init__(self, session_timeout_hours: int = 24, cleanup_interval_minutes: int = 60):
        self.sessions: Dict[str, ConversationContext] = {}
        self.session_timeout = timedelta(hours=session_timeout_hours)
        self.cleanup_interval = timedelta(minutes=cleanup_interval_minutes)
        self.lock = Lock()
        self.last_cleanup = datetime.now()
    
    def create_session(self) -> str:
        """Create a new session and return session ID"""
        session_id = str(uuid.uuid4())
        with self.lock:
            self.sessions[session_id] = ConversationContext(session_id=session_id)
        return session_id
    
    def get_session(self, session_id: Optional[str] = None) -> ConversationContext:
        """Get existing session or create new one"""
        if not session_id:
            session_id = self.create_session()
        
        with self.lock:
            if session_id not in self.sessions:
                self.sessions[session_id] = ConversationContext(session_id=session_id)
            
            session = self.sessions[session_id]
            session.last_accessed = datetime.now()
            
            # Trigger cleanup if needed
            self._cleanup_expired_sessions()
            
            return session
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a specific session"""
        with self.lock:
            if session_id in self.sessions:
                del self.sessions[session_id]
                return True
            return False
    
    def get_active_session_count(self) -> int:
        """Get number of active sessions"""
        with self.lock:
            return len(self.sessions)
    
    def _cleanup_expired_sessions(self):
        """Remove expired sessions (called periodically)"""
        now = datetime.now()
        
        # Only run cleanup periodically to avoid overhead
        if now - self.last_cleanup < self.cleanup_interval:
            return
        
        expired_sessions = []
        for session_id, session in self.sessions.items():
            if now - session.last_accessed > self.session_timeout:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            del self.sessions[session_id]
        
        self.last_cleanup = now
        
        if expired_sessions:
            print(f"Cleaned up {len(expired_sessions)} expired sessions")
    
    def reset_session_completely(self, session_id: str) -> bool:
        """
        Completely reset a session - both conversation and vector database documents
        """
        with self.lock:
            if session_id in self.sessions:
                session = self.sessions[session_id]
                session.clear_all_data()
                return True
            return False
    
    def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        """Get comprehensive session statistics including RAG data"""
        with self.lock:
            if session_id not in self.sessions:
                return {"error": "Session not found"}
            
            session = self.sessions[session_id]
            
            # Get basic session stats
            basic_stats = {
                "session_id": session_id,
                "message_count": len(session.messages),
                "uploaded_files": session.uploaded_files,
                "total_upload_size": session.total_upload_size,
                "context_size_chars": session.get_context_size(),
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed.isoformat()
            }
            
            # Get RAG stats
            rag_stats = session.get_rag_stats()
            
            # Combine stats
            return {**basic_stats, "rag_stats": rag_stats}

# Global session manager instance
session_manager = SessionManager()

def get_session_manager() -> SessionManager:
    """Get the global session manager instance"""
    return session_manager
