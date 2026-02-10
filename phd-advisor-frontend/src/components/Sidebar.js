import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Search, 
  MoreVertical, 
  Trash2, 
  Edit3,
  LogOut,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  FileText
} from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import '../styles/Sidebar.css';

const Sidebar = ({ 
  user, 
  currentSessionId, 
  onSelectSession, 
  onNewChat, 
  onSignOut,
  authToken,
  onSidebarToggle,
  isMobileOpen = false,
  onMobileToggle,
  onNavigateToCanvas
}) => {
  const { config } = useAppConfig();
  const canvasLabel = config?.app?.title ? `${config.app.title} Canvas` : 'Canvas';
  const [chatSessions, setChatSessions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCreatingNewChat, setIsCreatingNewChat] = useState(false);

  useEffect(() => {
    if (authToken) {
      fetchChatSessions();
    }
  }, [authToken]);

  useEffect(() => {
    const handleOverlayClick = (e) => {
      // Only close if clicking the overlay itself, not the sidebar
      if (e.target.classList.contains('mobile-sidebar-overlay')) {
        onMobileToggle(false);
      }
    };

    if (isMobileOpen) {
      document.addEventListener('click', handleOverlayClick);
      return () => document.removeEventListener('click', handleOverlayClick);
    }
  }, [isMobileOpen, onMobileToggle]);

  // Notify parent when sidebar state changes
  useEffect(() => {
    if (onSidebarToggle) {
      onSidebarToggle(isCollapsed);
    }
  }, [isCollapsed, onSidebarToggle]);

  // Add effect to refresh when currentSessionId changes (new session created)
  useEffect(() => {
    if (currentSessionId && authToken) {
      // Small delay to ensure the session is saved to database
      const timer = setTimeout(() => {
        fetchChatSessions();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [currentSessionId, authToken]);


  const fetchChatSessions = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const sessions = await response.json();
        setChatSessions(sessions);
      } else {
        console.error('Failed to fetch chat sessions');
      }
    } catch (error) {
      console.error('Error fetching chat sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = async () => {
    setIsCreatingNewChat(true);
    
    try {
      // Call the parent's new chat handler and wait for it to complete
      await onNewChat();
      
      // Refresh the sessions list immediately after new chat is created
      // The parent should have updated currentSessionId by now
      await fetchChatSessions();
      
    } catch (error) {
      console.error('Error creating new chat:', error);
      // Optionally show an error message to the user
    } finally {
      setIsCreatingNewChat(false);
    }
  };

  const handleDeleteSession = async (sessionId, event) => {
    event.stopPropagation();
    
    if (window.confirm('Are you sure you want to delete this chat?')) {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions/${sessionId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          setChatSessions(prev => prev.filter(session => session.id !== sessionId));
          if (currentSessionId === sessionId) {
            onNewChat(); // Create new session if current one was deleted
          }
        }
      } catch (error) {
        console.error('Error deleting chat session:', error);
      }
    }
  };

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
    // Close user menu when collapsing
    if (!isCollapsed) {
      setShowUserMenu(false);
    }
  };

  const filteredSessions = chatSessions.filter(session =>
    session.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays - 1} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          {!isCollapsed && (
            <>
              <div className="user-section">
                <div className="user-info">
                  <div className="user-avatar">
                    <User size={20} />
                  </div>
                  <div className="user-details">
                    <span className="user-name">{user.firstName} {user.lastName}</span>
                    <span className="user-email">{user.email}</span>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {/* Toggle button next to user menu when expanded */}
                  <button 
                    className="sidebar-toggle"
                    onClick={toggleSidebar} 
                    title="Collapse sidebar"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  
                  <div className="user-menu-container">
                    <button 
                      className="user-menu-button"
                      onClick={() => setShowUserMenu(!showUserMenu)}
                    >
                      <MoreVertical size={16} />
                    </button>
                    
                    {showUserMenu && (
                      <div className="user-menu">
                        <button className="user-menu-item">
                          <Settings size={16} />
                          <span>Settings</span>
                        </button>
                        <button className="user-menu-item sign-out" onClick={onSignOut}>
                          <LogOut size={16} />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button 
                className="new-chat-button" 
                onClick={handleNewChat}
                disabled={isCreatingNewChat}
              >
                <Plus size={16} />
                <span>{isCreatingNewChat ? 'Creating...' : 'New Chat'}</span>
              </button>

              <button 
                className="sidebar-canvas-btn"
                onClick={onNavigateToCanvas}
                title={canvasLabel}
              >
                <FileText size={20} />
                {!isCollapsed && <span>{canvasLabel}</span>}
              </button>
            </>
          )}

          {isCollapsed && (
            <div className="collapsed-header">
              {/* Toggle button replaces user avatar when collapsed */}
              <button 
                className="collapsed-toggle-avatar"
                onClick={toggleSidebar} 
                title="Expand sidebar"
              >
                <ChevronRight size={20} />
              </button>
              <button 
                className="collapsed-new-chat" 
                onClick={handleNewChat} 
                title="New Chat"
                disabled={isCreatingNewChat}
              >
                <Plus size={20} />
              </button>
              <button 
                className="sidebar-canvas-btn"
                onClick={onNavigateToCanvas}
                title={canvasLabel}
              >
                <FileText size={20} />
                {!isCollapsed && <span>{canvasLabel}</span>}
              </button>
            </div>
          )}
        </div>

        {/* Search - only show when expanded */}
        {!isCollapsed && (
          <div className="sidebar-search">
            <div className="search-container">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
        )}

        {/* Chat Sessions */}
        <div className="chat-sessions">
          {isLoading ? (
            <div className="loading-sessions">
              <div className="loading-spinner"></div>
              {!isCollapsed && <span>Loading chats...</span>}
            </div>
          ) : isCreatingNewChat ? (
            <div className="loading-sessions">
              <div className="loading-spinner"></div>
              {!isCollapsed && <span>Creating new chat...</span>}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="no-sessions">
              {!isCollapsed && (searchTerm ? 'No chats found' : 'No chats yet')}
            </div>
          ) : (
            <div className="sessions-list">
              {filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-item ${currentSessionId === session.id ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                  title={isCollapsed ? session.title : ''}
                >
                  <div className="session-content">
                    <div className="session-icon">
                      <MessageSquare size={16} />
                    </div>
                    {!isCollapsed && (
                      <div className="session-details">
                        <div className="session-title">{session.title}</div>
                        <div className="session-meta">
                          <span className="session-date">{formatDate(session.updated_at)}</span>
                          <span className="session-messages">{session.message_count} messages</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {!isCollapsed && (
                    <button
                      className="session-menu-button"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {isMobileOpen && (
        <div 
          className="mobile-sidebar-overlay visible" 
          onClick={() => onMobileToggle(false)}
        />
      )}
    </>
  );
};

export default Sidebar;