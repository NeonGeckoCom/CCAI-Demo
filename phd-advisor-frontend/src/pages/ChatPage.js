import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Home, MessageCircle, Reply, X, Sparkles, Users, Settings2, FileText, Menu, HelpCircle } from 'lucide-react';

import EnhancedChatInput from '../components/EnhancedChatInput';
import MessageBubble from '../components/MessageBubble';
import ThinkingIndicator from '../components/ThinkingIndicator';
import SuggestionsPanel from '../components/SuggestionsPanel';
import ThemeToggle from '../components/ThemeToggle';
import SettingsModal from '../components/SettingsModal';
import ExportButton from '../components/ExportButton';
import Sidebar from '../components/Sidebar';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/ChatPage.css';
import '../styles/EnhancedChatInput.css';
import AdvisorStatusDropdown from '../components/AdvisorStatusDropdown';
import AdvisorCarousel from '../components/AdvisorCarousel';
import OnboardingTour from '../components/OnboardingTour';

const ChatPage = ({ user, authToken, onNavigateToHome, onNavigateToCanvas, onSignOut, onUserUpdate }) => {
  const { config, advisors, getAdvisorColors } = useAppConfig();
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingAdvisors, setThinkingAdvisors] = useState([]);
  const [collectedInfo, setCollectedInfo] = useState({});
  const [replyingTo, setReplyingTo] = useState(null);
  const [llmConfig, setLlmConfig] = useState({
    mode: 'uniform',
    default_backend: null,
    orchestrator_backend: null,
    persona_backends: null,
  });
  const [availableBackends, setAvailableBackends] = useState([]);
  const [isProviderSwitching, setIsProviderSwitching] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const messagesEndRef = useRef(null);
  const { isDark } = useTheme();

  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState('');
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  // 'panel' | 'aggregated' — persisted so the choice survives reloads.
  const [responseMode, setResponseMode] = useState(() => {
    try { return localStorage.getItem('responseMode') === 'aggregated' ? 'aggregated' : 'panel'; }
    catch { return 'panel'; }
  });
  useEffect(() => {
    try { localStorage.setItem('responseMode', responseMode); } catch { /* non-fatal */ }
  }, [responseMode]);

  // Per-exchange view override: { [groupId]: 'panel' | 'aggregated' }.
  // Lets the user flip an individual exchange between the advisor panel and
  // the single combined answer, independently of the global default.
  const [groupViews, setGroupViews] = useState({});
  // Group ids currently running an on-demand synthesis pass (for lag UX).
  const [synthesizingGroups, setSynthesizingGroups] = useState({});



  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinkingAdvisors]);

  useEffect(() => {
    if (authToken) fetchCurrentProvider();
  }, [authToken]);

  const fetchCurrentProvider = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/current-provider`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.llm_config) setLlmConfig(data.llm_config);
        if (Array.isArray(data.available_backends)) setAvailableBackends(data.available_backends);
      }
    } catch (error) {
      console.error('Error fetching current provider:', error);
    }
  };

  

  const submitProviderConfig = async (payload, label) => {
    setIsProviderSwitching(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/switch-provider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.llm_config) {
          setLlmConfig(data.llm_config);
        } else {
          setLlmConfig(payload);
        }

        setMessages(prev => [...prev, {
          id: generateMessageId(),
          type: 'system',
          content: `✨ Switched to ${label}. Your advisors are now ready with the new configuration.`,
          timestamp: new Date()
        }]);
        return true;
      }

      const error = await response.json().catch(() => ({}));
      console.error('Failed to switch provider:', error);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'error',
        content: `Failed to switch to ${label}: ${error.detail || 'Unknown error'}`,
        timestamp: new Date()
      }]);
      return false;
    } catch (error) {
      console.error('Error switching provider:', error);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'error',
        content: `Error switching to ${label}. Please try again.`,
        timestamp: new Date()
      }]);
      return false;
    } finally {
      setIsProviderSwitching(false);
    }
  };

  const handleHybridSubmit = async (hybridConfig) => {
    const ok = await submitProviderConfig(
      { mode: 'hybrid', ...hybridConfig },
      'Hybrid configuration'
    );
    if (ok) setIsSettingsOpen(false);
    return ok;
  };

  const generateMessageId = () => {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  };

  const createNewSession = async (firstMessage = null) => {
    try {
      const title = firstMessage 
        ? `${firstMessage.substring(0, 30)}...` 
        : `Chat ${new Date().toLocaleDateString()}`;

      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title })
      });

      if (response.ok) {
        const newSession = await response.json();
        
        // Update state immediately
        setCurrentSessionId(newSession.id);
        setCurrentSessionTitle(newSession.title);
        
        console.log('MongoDB session created:', newSession.id);
        return newSession.id;
      } else {
        console.error('Failed to create new session');
        return null;
      }
    } catch (error) {
      console.error('Error creating new session:', error);
      return null;
    }
  };


// Load an existing chat session
const loadChatSession = async (sessionId) => {
  if (!sessionId || isLoadingSession) return;
  setIsLoadingSession(true);
  try {
    // Use the new switch-chat endpoint that syncs context
    const response = await fetch(`${process.env.REACT_APP_API_URL}/switch-chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_session_id: sessionId
      })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.status === 'success') {
        setCurrentSessionId(sessionId);
        setCurrentSessionTitle(''); // Will be set from MongoDB data
        
        // Load the messages from the synced context
        const formattedMessages = result.context.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          persona_id: msg.persona_id || msg.advisor || msg.advisorId
        }));
        
        setMessages(formattedMessages);
        setReplyingTo(null);
        setThinkingAdvisors([]);
        
        // Also get the session title from MongoDB
        const sessionResponse = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions/${sessionId}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          setCurrentSessionTitle(sessionData.title);
        }
      }
    }
  } catch (error) {
    console.error('Error loading session:', error);
  } finally {
    setIsLoadingSession(false);
  }
};

// Update session title based on first message
const updateSessionTitle = async (sessionId, newTitle) => {
  if (!sessionId || !authToken) return;

  try {
    await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions/${sessionId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: newTitle })
    });
    setCurrentSessionTitle(newTitle);
  } catch (error) {
    console.error('Error updating session title:', error);
  }
};

// Handle selecting a session from sidebar
const handleSelectSession = async (sessionId) => {
  if (sessionId === currentSessionId) return;
  await loadChatSession(sessionId);
};

// Sidebar deleted the currently-active chat. Clear local state without
// creating a replacement session.
const handleCurrentSessionDeleted = () => {
  setCurrentSessionId(null);
  setCurrentSessionTitle('');
  setMessages([]);
  setReplyingTo(null);
  setThinkingAdvisors([]);
  setUploadedDocuments([]);
};

// Handle creating new chat from sidebar
const handleNewChat = async (sessionId = null) => {
  if (sessionId) {
    // Loading existing session
    await loadChatSession(sessionId);
    return; // Return early for existing session loading
  } else {
    // Creating completely new chat with fresh context
    try {
      // Step 1: Reset memory session
      const response = await fetch(`${process.env.REACT_APP_API_URL}/new-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: `Chat ${new Date().toLocaleDateString()}`
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success') {
          // Step 2: Immediately create MongoDB session
          const newSessionId = await createNewSession(`Chat ${new Date().toLocaleDateString()}`);
          
          if (newSessionId) {
            // Reset all state to fresh with the new session
            setMessages([]);
            setCurrentSessionId(newSessionId); // Set the new session ID immediately
            setCurrentSessionTitle(`Chat ${new Date().toLocaleDateString()}`);
            setReplyingTo(null);
            setThinkingAdvisors([]);
            setUploadedDocuments([]);
            
            console.log('New chat created with MongoDB session:', newSessionId);
            
            // Wait a bit to ensure state has updated
            await new Promise(resolve => setTimeout(resolve, 100));
            return newSessionId; // Return the session ID for the sidebar
          } else {
            throw new Error('Failed to create MongoDB session');
          }
        } else {
          throw new Error('Failed to create memory session');
        }
      } else {
        throw new Error(`HTTP error: ${response.status}`);
      }
    } catch (error) {
      console.error('Error creating new chat:', error);
      
      // Fallback to local reset
      setMessages([]);
      setCurrentSessionId(null);
      setCurrentSessionTitle('');
      setReplyingTo(null);
      setThinkingAdvisors([]);
      setUploadedDocuments([]);
      
      // Re-throw the error so the sidebar knows something went wrong
      throw error;
    }
  }
};

  

  const handleFileUploaded = async (file, uploadResult) => {
    // FIXED: Use the upload result data for better messaging
    const documentMessage = {
      id: generateMessageId(),
      type: 'document_upload',
      content: `Document uploaded: ${uploadResult.filename || file.name} (${uploadResult.chunks_created || 0} sections processed)`,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, documentMessage]);
    setUploadedDocuments(prev => [...prev, file]);
    
    // FIXED: Log document access info
    console.log('File uploaded to session:', {
      filename: uploadResult.filename,
      session_id: uploadResult.session_id,
      chat_session_id: uploadResult.chat_session_id,
      current_session_id: currentSessionId
    });
    
  };


  // Reusable streaming call to /chat-stream. Lifted to component scope so the
  // on-demand "generalize" action can reuse it too.
  const streamChat = async (userInput, sessionId = null) => {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        user_input: userInput,
        response_length: 'medium',
        chat_session_id: sessionId || currentSessionId,
        response_mode: responseMode,
      }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response;
  };

  const handleToggleGroupView = (groupId, panelMessages, hasAggregated) => {
    const current = groupViews[groupId] || (hasAggregated ? 'aggregated' : 'panel');
    const next = current === 'panel' ? 'aggregated' : 'panel';
    if (next === 'aggregated' && !hasAggregated) return;
    setGroupViews(prev => ({ ...prev, [groupId]: next }));
  };

  const handleSendMessage = async (inputMessage) => {
    if (!inputMessage.trim()) return;

    // Create user message
    const userMessage = {
      id: generateMessageId(),
      type: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    // Add to local state immediately
    setMessages(prev => [...prev, userMessage]);

    // Create new session if we don't have one
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await createNewSession(inputMessage);
      if (!sessionId) {
        console.error('Failed to create session');
        return;
      }
    }

    // Update session title if this is the first message and title is generic
    if (messages.length === 0 && currentSessionTitle.includes('Chat ')) {
      const newTitle = inputMessage.length > 30 
        ? `${inputMessage.substring(0, 30)}...` 
        : inputMessage;
      await updateSessionTitle(sessionId, newTitle);
    }

    // Set loading state
    setIsLoading(true);
    setThinkingAdvisors(['system']);

    const groupId = 'grp_' + generateMessageId();
    // Always collect this exchange's advisor responses so the panel is stored
    // even when aggregated mode is the default — the user can toggle to it.
    const collectedAdvisorResponses = [];

    try {
      const response = await streamChat(inputMessage, sessionId);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let refreshedForUserMessage = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line);

          if (!refreshedForUserMessage) {
            setSidebarRefreshTrigger(prev => prev + 1);
            refreshedForUserMessage = true;
          }

          const d = payload.data || {};

          switch (payload.type) {
            case 'advisor': {
              const msg = {
                id: generateMessageId(),
                type: 'advisor',
                persona_id: d.persona_id,
                content: d.content,
                timestamp: new Date(),
                advisorName: d.persona_name || d.persona_id,
                used_documents: d.used_documents || false,
                document_chunks_used: d.document_chunks_used || 0,
                groupId,
                is_aggregated: d.is_aggregated || false,
                source_personas: d.source_personas || null,
              };
              // Persistence is handled by the /chat-stream backend endpoint.
              // The backend controls which events are sent: panel mode sends
              // individual advisor events, aggregated mode sends one synthesized event.
              collectedAdvisorResponses.push(msg);
              setThinkingAdvisors(prev => prev.filter(a => a !== d.persona_id));
              setMessages(prev => [...prev, msg]);
              break;
            }
            case 'clarification':
              setMessages(prev => [...prev, {
                id: generateMessageId(),
                type: 'clarification',
                content: d.message,
                suggestions: d.suggestions || [],
                timestamp: new Date(),
              }]);
              break;
            case 'progress':
              if (d.phase === 'complete') {
                break;
              }
              if (d.phase === 'synthesizing') {
                setSynthesizingGroups(prev => ({ ...prev, [groupId]: true }));
              }
              if (d.persona_id != null) {
                setThinkingAdvisors(prev => prev.filter(a => a !== d.persona_id));
              }
              break;
            case 'error':
              setMessages(prev => [...prev, {
                id: generateMessageId(),
                type: 'error',
                content: d.detail || 'An error occurred',
                timestamp: new Date(),
              }]);
              break;
            default:
              break;
          }
        }
      }

      const hasAggregated = collectedAdvisorResponses.some(m => m.is_aggregated);
      setGroupViews(prev => ({ ...prev, [groupId]: hasAggregated ? 'aggregated' : 'panel' }));
      setSynthesizingGroups(prev => { const n = { ...prev }; delete n[groupId]; return n; });

    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'error',
        content: `Failed to send message: ${error.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
      setThinkingAdvisors([]);
      setSidebarRefreshTrigger(prev => prev + 1);
    }
  };

  const handleReplyToAdvisor = async (inputMessage, replyContext) => {
  // Ensure we have a session before proceeding
  let sessionId = currentSessionId;
  if (!sessionId) {
    sessionId = await createNewSession(inputMessage);
    if (!sessionId) {
      console.error('Failed to create session for reply');
      return;
    }
  }

  const replyMessage = {
    id: generateMessageId(),
    type: 'user',
    content: inputMessage,
    replyTo: {
      advisorId: replyContext.persona_id,
      advisorName: replyContext.advisorName,
      messageId: replyContext.messageId
    },
    timestamp: new Date()
  };

  setMessages(prev => [...prev, replyMessage]);
  setSidebarRefreshTrigger(prev => prev + 1);

  setIsLoading(true);
  setThinkingAdvisors([replyContext.persona_id]);

  try {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/reply-to-advisor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        user_input: inputMessage,
        advisor_id: replyContext.advisorId,
        original_message_id: replyContext.messageId,
        chat_session_id: sessionId // Use confirmed session ID
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    if (data.type === 'advisor_reply') {
      const replyResponseMessage = {
        id: generateMessageId(),
        type: 'advisor',
        persona_id: data.persona_id,
        advisorName: data.persona,
        content: data.response,
        isReply: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, replyResponseMessage]);
    }

  } catch (error) {
    console.error('Error replying to advisor:', error);
    const errorMessage = {
      id: generateMessageId(),
      type: 'error',
      content: 'Sorry, I encountered an error with your reply. Please try again.',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, errorMessage]);
  }

  setIsLoading(false);
  setThinkingAdvisors([]);
  setSidebarRefreshTrigger(prev => prev + 1);
};

  const handleCopyMessage = (messageId, content) => {
    // Optional: Show a toast notification or add to message history
    console.log(`Copied message ${messageId}: ${content.substring(0, 50)}...`);
  };

  const handleExpandMessage = async (messageId, advisorId) => {
    const advisor = advisors[advisorId];
    if (!advisor) return;

    const originalMessage = messages.find(msg => msg.id === messageId);
    if (!originalMessage) return;

    const expandPrompt = `Please expand on your previous response: "${originalMessage.content.substring(0, 100)}..." Provide more detail and depth.`;
    
    const expandMessage = {
      id: generateMessageId(),
      type: 'user',
      content: expandPrompt,
      timestamp: new Date(),
      isExpandRequest: true,
      expandsMessageId: messageId
    };
    setMessages(prev => [...prev, expandMessage]);
    setSidebarRefreshTrigger(prev => prev + 1);

    setIsLoading(true);
    setThinkingAdvisors([advisorId]);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/chat/${advisorId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          user_input: expandPrompt,
          response_length: 'long',
          chat_session_id: currentSessionId
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.persona && data.response) {
        const expandedMessage = {
          id: generateMessageId(),
          type: 'advisor',
          persona_id: advisorId,
          advisorName: advisor.name,
          content: data.response,
          isExpansion: true,
          expandsMessageId: messageId,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, expandedMessage]);
      } else {
        const errorMessage = {
          id: generateMessageId(),
          type: 'error',
          content: 'Sorry, I received an unexpected response format. Please try again.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }

    } catch (error) {
      console.error('Error expanding message:', error);
      const errorMessage = {
        id: generateMessageId(),
        type: 'error',
        content: 'Sorry, I encountered an error while expanding the message. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setIsLoading(false);
    setThinkingAdvisors([]);
    setSidebarRefreshTrigger(prev => prev + 1);
  };

  const handleReplyToMessage = (message) => {
    const advisor = advisors[message.persona_id];
    setReplyingTo({
      advisorId: message.persona_id,
      messageId: message.id,
      advisorName: advisor?.name || message.advisorName || 'Advisor',
      persona_id: message.persona_id
    });
  };

  const handleMessageClick = (message) => {
    if (message.type === 'advisor') {
      const advisor = advisors[message.persona_id];
      setReplyingTo({
        advisorId: message.persona_id,
        messageId: message.id,
        advisorName: advisor?.name || message.advisorName || 'Advisor',
        persona_id: message.persona_id
      });
    }
  };

  /** Group consecutive advisor messages so we can render them in a horizontal carousel */
  const messageGroups = useMemo(() => {
    const groups = [];
    let i = 0;
    while (i < messages.length) {
      if (messages[i].type === 'advisor') {
        const advisorGroup = [];
        while (i < messages.length && messages[i].type === 'advisor') {
          advisorGroup.push(messages[i]);
          i++;
        }
        const aggregatedMessages = advisorGroup.filter(m => m.is_aggregated);
        const panelMessages = advisorGroup.filter(m => !m.is_aggregated);
        // Prefer the shared groupId stamped at creation; fall back to a stable
        // id derived from the message ids so historical/legacy exchanges
        // (saved before groupId existed) can still be toggled.
        const groupId =
          advisorGroup.find(m => m.groupId)?.groupId ||
          `legacy_${advisorGroup.map(m => m.id).join('_')}`;
        groups.push({
          type: 'advisor_group',
          groupId,
          messages: advisorGroup,
          panelMessages,
          aggregatedMessages,
        });
      } else {
        groups.push({ type: 'single', message: messages[i] });
        i++;
      }
    }
    return groups;
  }, [messages]);

  const handleInputSubmit = async (inputMessage) => {
  if (replyingTo) {
    // This is a reply to a specific message
    await handleReplyToAdvisor(inputMessage, replyingTo);
  } else {
    // This is a regular message
    await handleSendMessage(inputMessage);
  }
};

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleSidebarToggle = (isCollapsed) => {
    setIsSidebarCollapsed(isCollapsed);
  };

  const hasMessages = messages.length > 0;
  const hasConversationMessages = messages.filter(m => m.type !== 'system' && m.type !== 'document_upload').length > 0;

  const chatPlaceholder = config?.chat_page?.placeholder || "Ask your advisors anything...";

  return (
    <OnboardingTour>
    <div className="chat-page-with-sidebar">
      {/* Sidebar Component */}
      <Sidebar
        user={user}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onCurrentSessionDeleted={handleCurrentSessionDeleted}
        onSignOut={onSignOut}
        onUserUpdate={onUserUpdate}
        authToken={authToken}
        onSidebarToggle={handleSidebarToggle}
        isMobileOpen={isMobileMenuOpen}
        onMobileToggle={setIsMobileMenuOpen}
        onNavigateToCanvas={onNavigateToCanvas}
        refreshTrigger={sidebarRefreshTrigger}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      
      <div className={`main-chat-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="modern-chat-page">
          {/* Floating Header */}
          <div className="floating-header">
            <div className="header-left">
              <button 
                className="mobile-menu-button"
                onClick={handleMobileMenuToggle}
              >
                <Menu size={20} />
              </button>
              <button onClick={onNavigateToHome} className="modern-home-btn">
                <Home size={20} />
              </button>
              <div className="header-brand">
                <div className="brand-icon">
                  <Users size={24} />
                </div>
                <div className="brand-text">
                  <h1>{config?.app?.title || 'Advisory'}</h1>
                  <p>{config?.app?.subtitle || 'AI-Powered Guidance'}</p>
                </div>
              </div>
            </div>
            
            <div className="header-right">
              <AdvisorStatusDropdown
                advisors={Object.fromEntries(
                  Object.entries(advisors).filter(([id]) => id !== 'aggregated')
                )}
                thinkingAdvisors={thinkingAdvisors}
                getAdvisorColors={getAdvisorColors}
                isDark={isDark}
              />
              
              <div className="header-controls">
                {/* Export Button */}
                <ExportButton
                  hasMessages={hasConversationMessages}
                  currentSessionId={currentSessionId}
                  authToken={authToken}
                />

                {/* Theme Toggle */}
                <ThemeToggle />

                {/* Help / User Guide */}
                <button
                  className="header-help-btn"
                  onClick={() => window.dispatchEvent(new CustomEvent('open-user-guide'))}
                  title="Open user guide"
                >
                  <HelpCircle />
                </button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="chat-content">
            {!hasMessages ? (
              <div className="welcome-state">
                <AdvisorCarousel />
                <SuggestionsPanel onSuggestionClick={handleSendMessage} />
              </div>
            ) : (
              <div className="messages-container">
                {/* Add loading session indicator */}
                {isLoadingSession && (
                  <div className="loading-session">
                    <div className="loading-spinner"></div>
                    <span>Loading chat session...</span>
                  </div>
                )}
                
                <div className="messages-list">
                  <div className="messages-scroll">
                    {messageGroups.map((group) => (
                      group.type === 'advisor_group' ? (() => {
                        const hasAggregated = group.aggregatedMessages.length > 0;
                        const view = groupViews[group.groupId] || (hasAggregated ? 'aggregated' : 'panel');
                        const isSynth = !!synthesizingGroups[group.groupId];
                        const showAggregated = view === 'aggregated' && hasAggregated;
                        const shown = showAggregated ? group.aggregatedMessages : group.panelMessages;
                        const showToggle = group.panelMessages.length > 1 || hasAggregated || isSynth;
                        const switchTo = (target) => {
                          if ((target === 'aggregated') !== showAggregated) {
                            handleToggleGroupView(group.groupId, group.panelMessages, hasAggregated);
                          }
                        };
                        const segBtn = (active) => ({
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 12.5, padding: '5px 10px', border: 'none',
                          borderRadius: 6, cursor: isSynth ? 'default' : 'pointer',
                          fontFamily: 'inherit',
                          background: active ? 'var(--accent-primary, #6366f1)' : 'transparent',
                          color: active ? '#fff' : 'var(--text-secondary)',
                        });
                        return (
                          <div key={group.groupId} className="response-group">
                            {showToggle && (
                              <div
                                role="group"
                                aria-label="Response view"
                                style={{
                                  display: 'inline-flex', gap: 2, marginBottom: 8,
                                  background: 'var(--bg-secondary, rgba(0,0,0,0.04))',
                                  border: '1px solid var(--border-primary)',
                                  borderRadius: 8, padding: 2,
                                }}
                              >
                                <button type="button" style={segBtn(!showAggregated)} disabled={isSynth} onClick={() => switchTo('panel')}>
                                  <Users size={13} /> Panel
                                </button>
                                <button type="button" style={segBtn(showAggregated)} disabled={isSynth} onClick={() => switchTo('aggregated')}>
                                  <Sparkles size={13} /> Generalized
                                </button>
                              </div>
                            )}
                            {isSynth && (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                color: 'var(--text-secondary)', fontSize: 13, padding: '8px 4px',
                              }}>
                                <Sparkles size={16} />
                                <span>Combining advisor responses into one answer…</span>
                              </div>
                            )}
                            {shown.length > 0 && (
                              <AdvisorCarousel
                                key={shown.map(m => m.id).join('-')}
                                messages={shown}
                                onReply={handleReplyToMessage}
                                onExpand={handleExpandMessage}
                                onClick={handleMessageClick}
                              />
                            )}
                          </div>
                        );
                      })() : (
                      <div key={group.message.id}>
                        {group.message.type === 'user' && (
                          <div className="user-message-container">
                            <div className="user-message">
                              {group.message.replyTo && (
                                <div className="reply-indicator">
                                  <Reply size={12} />
                                  <span>Reply to {group.message.replyTo.advisorName}</span>
                                </div>
                              )}
                              <p>{group.message.content}</p>
                            </div>
                          </div>
                        )}

                        {group.message.type === 'error' && (
                          <div className="error-message-container">
                            <div className="error-message">
                              <p>{group.message.content}</p>
                            </div>
                          </div>
                        )}

                        {group.message.type === 'system' && (
                          <div className="system-message-container">
                            <div className="system-message">
                              <p>{group.message.content}</p>
                            </div>
                          </div>
                        )}

                        {group.message.type === 'document_upload' && (
                          <div className="system-message-container">
                            <div className="system-message document-upload">
                              <FileText size={16} />
                              <p>{group.message.content}</p>
                            </div>
                          </div>
                        )}

                        {group.message.type === 'clarification' && (
                          <div className="clarification-message-container">
                            <div className="clarification-message">
                              <div className="clarification-header">
                                <MessageCircle size={16} />
                                <span>I need a bit more information</span>
                              </div>
                              <p>{group.message.content}</p>
                              
                              {group.message.suggestions && group.message.suggestions.length > 0 && (
                                <div className="clarification-suggestions">
                                  <p className="suggestions-label">Here are some ways you could be more specific:</p>
                                  <div className="suggestions-list">
                                    {group.message.suggestions.map((suggestion, index) => (
                                      <button
                                        key={index}
                                        className="suggestion-button"
                                        onClick={() => handleSendMessage(suggestion)}
                                      >
                                        {suggestion}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      )
                    ))}

                    {thinkingAdvisors.includes('system') && (
                      <div className="orchestrator-thinking">
                        <div className="thinking-bubble">
                          <MessageCircle size={20} />
                        </div>
                        <div className="thinking-content">
                          <span className="thinking-label">Orchestrator is thinking...</span>
                          <div className="thinking-animation">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {thinkingAdvisors.filter(id => id !== 'system').map(advisorId => (
                      <ThinkingIndicator key={advisorId} advisorId={advisorId} />
                    ))}

                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="floating-input-area">
            {replyingTo && (
              <div className="reply-banner">
                <div className="reply-info">
                  <Reply size={16} />
                  <span>Replying to <strong>{replyingTo.advisorName}</strong></span>
                </div>
                <button onClick={cancelReply} className="cancel-reply">
                  <X size={16} />
                </button>
              </div>
            )}
            
            <EnhancedChatInput
              onSendMessage={handleInputSubmit}
              onFileUploaded={handleFileUploaded}
              uploadedDocuments={uploadedDocuments}
              isLoading={isLoading}
              currentChatSessionId={currentSessionId}
              authToken={authToken}
              responseMode={responseMode}
              onResponseModeChange={setResponseMode}
              placeholder={
                replyingTo
                  ? `Reply to ${replyingTo.advisorName}...`
                  : chatPlaceholder
              }
            />
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <SettingsModal
          user={user}
          authToken={authToken}
          onUserUpdate={onUserUpdate}
          onSignOut={onSignOut}
          advisors={advisors}
          availableBackends={availableBackends}
          llmConfig={llmConfig}
          isSaving={isProviderSwitching}
          onSubmitConfig={handleHybridSubmit}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
    </OnboardingTour>
  );
};

export default ChatPage;
