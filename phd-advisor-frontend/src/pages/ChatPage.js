import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Home, MessageCircle, Reply, X, Users, FileText, Menu, HelpCircle, Pencil, Check } from 'lucide-react';

import EnhancedChatInput from '../components/EnhancedChatInput';
import ThinkingIndicator from '../components/ThinkingIndicator';
import SuggestionsPanel from '../components/SuggestionsPanel';
import ThemeToggle from '../components/ThemeToggle';
import ProviderDropdown from '../components/ProviderDropdown';
import ExportButton from '../components/ExportButton';
import Sidebar from '../components/Sidebar';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/ChatPage.css';
import '../styles/EnhancedChatInput.css';
import AdvisorStatusDropdown from '../components/AdvisorStatusDropdown';
import AdvisorCarousel from '../components/AdvisorCarousel';
import OnboardingTour from '../components/OnboardingTour';

const responseStageText = (phase, data = {}) => {
  switch (phase) {
    case 'received':
      return 'Sending your question...';
    case 'checking_clarification':
      return 'Checking whether one more detail would help...';
    case 'preparing_clarification':
      return 'Preparing a quick follow-up question...';
    case 'checking_tools':
      return 'Checking whether a lookup can answer this directly...';
    case 'routing_request':
      return 'Reading your question...';
    case 'selecting_response_style':
      return 'Reading your question...';
    case 'classified':
      return data.advisor_skill_name
        ? `Using ${data.advisor_skill_name} for this answer...`
        : 'Shaping the answer plan...';
    case 'advisor_selected':
      return data.persona_name
        ? `Sending this to ${data.persona_name}...`
        : 'Sending this to your advisor...';
    case 'rag_checking_documents':
      return 'Checking uploaded documents...';
    case 'rag_rewriting_query':
      return 'Finding document search keywords...';
    case 'rag_retrieving':
      return 'Searching uploaded documents...';
    case 'rag_building_context':
      return 'Reading the relevant passages...';
    default:
      return 'Preparing your response...';
  }
};

const ChatPage = ({ user, authToken, onNavigateToHome, onNavigateToCanvas, onSignOut, onUserUpdate }) => {
  const { config, advisors, getAdvisorColors, disabledAdvisors } = useAppConfig();
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingAdvisors, setThinkingAdvisors] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [currentProvider, setCurrentProvider] = useState('gemini');
  const [isProviderSwitching, setIsProviderSwitching] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [editingMessage, setEditingMessage] = useState(null);
  const [currentAdvisorSkill, setCurrentAdvisorSkill] = useState(null);
  const [currentResponseStage, setCurrentResponseStage] = useState('');
  const [selectedAdvisorId, setSelectedAdvisorId] = useState(() => {
    try { return localStorage.getItem('selectedAdvisorId') || ''; }
    catch { return ''; }
  });
  const messagesEndRef = useRef(null);
  const { isDark } = useTheme();

  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState('');
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);

  

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinkingAdvisors, currentResponseStage]);

  useEffect(() => {
    fetchCurrentProvider();
  }, []);

  const enabledAdvisorIds = useMemo(() => (
    Object.keys(advisors || {}).filter(id => !disabledAdvisors?.[id])
  ), [advisors, disabledAdvisors]);

  useEffect(() => {
    if (!enabledAdvisorIds.length) {
      setSelectedAdvisorId('');
      return;
    }

    if (!selectedAdvisorId || !enabledAdvisorIds.includes(selectedAdvisorId)) {
      setSelectedAdvisorId(enabledAdvisorIds[0]);
    }
  }, [enabledAdvisorIds, selectedAdvisorId]);

  useEffect(() => {
    try {
      if (selectedAdvisorId) {
        localStorage.setItem('selectedAdvisorId', selectedAdvisorId);
      } else {
        localStorage.removeItem('selectedAdvisorId');
      }
    } catch {
      // localStorage is optional; chat still works with the in-memory choice.
    }
  }, [selectedAdvisorId]);

  const handleSelectAdvisor = (advisorId) => {
    setSelectedAdvisorId(advisorId);
  };

  const fetchCurrentProvider = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/current-provider`);
      if (response.ok) {
        const data = await response.json();
        setCurrentProvider(data.current_provider);
        console.log('Loaded provider:', data.current_provider, 'Available:', data.available_providers);
      }
    } catch (error) {
      console.error('Error fetching current provider:', error);
    }
  };

  

  const handleProviderSwitch = async (newProvider) => {
    if (newProvider === currentProvider || isProviderSwitching) return;

    setIsProviderSwitching(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/switch-provider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: newProvider
        }),
      });

      if (response.ok) {
        await response.json();
        setCurrentProvider(newProvider);
        
        const switchMessage = {
          id: generateMessageId(),
          type: 'system',
          content: `✨ Switched to ${newProvider.charAt(0).toUpperCase() + newProvider.slice(1)} provider. Your advisors are now ready with the new AI model.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, switchMessage]);
      } else {
        const error = await response.json();
        console.error('Failed to switch provider:', error);
        const errorMessage = {
          id: generateMessageId(),
          type: 'error',
          content: `Failed to switch to ${newProvider}: ${error.detail || 'Unknown error'}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Error switching provider:', error);
      const errorMessage = {
        id: generateMessageId(),
        type: 'error',
        content: `Error switching to ${newProvider}. Please try again.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProviderSwitching(false);
    }
  };

  const generateMessageId = () => {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  };

  const upsertAdvisorMessage = (data, buildPatch) => {
    const id = data.message_id || data.id;
    setMessages(prev => {
      const existingIndex = prev.findIndex(msg => (
        (id && msg.id === id) ||
        (!id && msg.isStreaming && msg.persona_id === data.persona_id)
      ));
      const existing = existingIndex >= 0 ? prev[existingIndex] : null;
      const messageId = id || existing?.id || generateMessageId();
      const baseMessage = {
        id: messageId,
        type: 'advisor',
        persona_id: data.persona_id,
        content: '',
        thoughts: '',
        timestamp: new Date(),
        advisorName: data.persona_name || data.persona_id,
        advisor_skill: data.advisor_skill,
        advisor_skill_name: data.advisor_skill_name,
      };
      const patch = buildPatch(existing || baseMessage);
      const nextMessage = {
        ...(existing || baseMessage),
        ...patch,
        id: messageId,
        type: 'advisor',
        persona_id: data.persona_id || existing?.persona_id,
        advisorName: data.persona_name || existing?.advisorName || data.persona_id,
      };

      if (existingIndex === -1) {
        return [...prev, nextMessage];
      }

      const next = [...prev];
      next[existingIndex] = nextMessage;
      return next;
    });
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
        setEditingMessage(null);
        const latestSkillMessage = [...formattedMessages].reverse().find(msg => msg.advisor_skill || msg.advisor_skill_name);
        setCurrentAdvisorSkill(latestSkillMessage ? {
          id: latestSkillMessage.advisor_skill,
          name: latestSkillMessage.advisor_skill_name || latestSkillMessage.advisor_skill
        } : null);
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
  setEditingMessage(null);
  setCurrentAdvisorSkill(null);
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
            setEditingMessage(null);
            setCurrentAdvisorSkill(null);
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
      setEditingMessage(null);
      setCurrentAdvisorSkill(null);
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

    const advisorForRequest = selectedAdvisorId || enabledAdvisorIds[0] || '';

    // Set loading state
    setIsLoading(true);
    setThinkingAdvisors(['system']);
    setCurrentResponseStage('Sending your question...');
    setCurrentAdvisorSkill(null);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/chat-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          user_input: inputMessage,
          user_message_id: userMessage.id,
          response_length: 'medium',
          chat_session_id: sessionId,
          active_advisors: advisorForRequest ? [advisorForRequest] : []
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

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
            case 'advisor_start':
              upsertAdvisorMessage(d, existing => ({
                content: existing.content || '',
                thoughts: existing.thoughts || '',
                isStreaming: true,
                timestamp: existing.timestamp || new Date(),
                advisor_skill: d.advisor_skill,
                advisor_skill_name: d.advisor_skill_name,
              }));
              if (d.advisor_skill || d.advisor_skill_name) {
                setCurrentAdvisorSkill({
                  id: d.advisor_skill,
                  name: d.advisor_skill_name || d.advisor_skill
                });
              }
              setCurrentResponseStage(
                d.persona_name
                  ? `${d.persona_name} is drafting your answer...`
                  : 'Your advisor is drafting your answer...'
              );
              setThinkingAdvisors(d.persona_id ? [d.persona_id] : ['system']);
              break;
            case 'advisor_delta':
              upsertAdvisorMessage(d, existing => ({
                content: `${existing.content || ''}${d.delta || ''}`,
                isStreaming: true,
              }));
              setCurrentResponseStage('');
              setThinkingAdvisors(prev => prev.filter(a => a !== d.persona_id));
              break;
            case 'advisor_thought_delta':
              upsertAdvisorMessage(d, existing => ({
                thoughts: `${existing.thoughts || ''}${d.delta || ''}`,
                isStreaming: true,
              }));
              setCurrentResponseStage('Working through the answer...');
              break;
            case 'advisor': {
              if (d.advisor_skill || d.advisor_skill_name) {
                setCurrentAdvisorSkill({
                  id: d.advisor_skill,
                  name: d.advisor_skill_name || d.advisor_skill
                });
              }
              upsertAdvisorMessage(d, existing => ({
                content: d.content || existing.content || '',
                thoughts: d.thoughts ?? existing.thoughts,
                timestamp: existing.timestamp || new Date(),
                used_documents: d.used_documents || false,
                document_chunks_used: d.document_chunks_used || 0,
                advisor_skill: d.advisor_skill,
                advisor_skill_name: d.advisor_skill_name,
                isStreaming: false,
              }));
              setCurrentResponseStage('');
              setThinkingAdvisors(prev => prev.filter(a => a !== d.persona_id && a !== 'system'));
              break;
            }
            case 'clarification':
              setCurrentResponseStage('');
              setThinkingAdvisors([]);
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
                setCurrentResponseStage('');
                setThinkingAdvisors([]);
                break;
              }
              setCurrentResponseStage(responseStageText(d.phase, d));
              if (d.phase === 'classified' && (d.advisor_skill || d.advisor_skill_name)) {
                setCurrentAdvisorSkill({
                  id: d.advisor_skill,
                  name: d.advisor_skill_name || d.advisor_skill
                });
              }
              if (d.phase === 'advisor_selected' && d.persona_id) {
                setThinkingAdvisors([d.persona_id]);
                break;
              }
              if (d.persona_id != null) {
                setThinkingAdvisors(prev => prev.filter(a => a !== d.persona_id));
              }
              break;
            case 'error':
              setCurrentResponseStage('');
              setThinkingAdvisors([]);
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
      setCurrentResponseStage('');
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
  setCurrentResponseStage(`Sending your follow-up to ${replyContext.advisorName || 'your advisor'}...`);

  try {
    const response = await fetch(`${process.env.REACT_APP_API_URL}/reply-to-advisor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
                advisor_skill: data.advisor_skill,
                advisor_skill_name: data.advisor_skill_name,
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
  setCurrentResponseStage('');
  setSidebarRefreshTrigger(prev => prev + 1);
};

  // eslint-disable-next-line no-unused-vars
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
    setCurrentResponseStage(`Asking ${advisor.name} to expand that answer...`);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/chat/${advisorId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
    setCurrentResponseStage('');
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

  const handleStartRegenerate = (message) => {
    if (isLoading || !message || message.replyTo) return;
    setReplyingTo(null);
    setEditingMessage({
      id: message.id,
      content: message.content || ''
    });
  };

  const handleCancelRegenerate = () => {
    setEditingMessage(null);
  };

  const handleSubmitRegenerate = async () => {
    if (!currentSessionId || isLoading) return;

    const nextContent = editingMessage?.content?.trim();
    if (!editingMessage?.id || !nextContent) return;

    setIsLoading(true);
    setThinkingAdvisors(['system']);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions/${currentSessionId}/messages/truncate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from_message_id: editingMessage.id
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      const truncateIndex = messages.findIndex(msg => msg.id === editingMessage.id);
      const retainedMessages = Array.isArray(result.messages)
        ? result.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          persona_id: msg.persona_id || msg.advisor || msg.advisorId
        }))
        : truncateIndex === -1 ? messages : messages.slice(0, truncateIndex);

      setMessages(retainedMessages);
      setReplyingTo(null);
      setEditingMessage(null);
      setThinkingAdvisors([]);
      await handleSendMessage(nextContent);
    } catch (error) {
      console.error('Error regenerating message:', error);
      setMessages(prev => [...prev, {
        id: generateMessageId(),
        type: 'error',
        content: `Failed to regenerate response: ${error.message}`,
        timestamp: new Date()
      }]);
      setIsLoading(false);
      setThinkingAdvisors([]);
    }
  };

  const ensureCurrentSessionId = async () => {
    if (currentSessionId) {
      return currentSessionId;
    }
    return await createNewSession(`Chat ${new Date().toLocaleDateString()}`);
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
        groups.push({ type: 'advisor_group', messages: advisorGroup });
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
                advisors={advisors}
                thinkingAdvisors={thinkingAdvisors}
                getAdvisorColors={getAdvisorColors}
                isDark={isDark}
                selectedAdvisorId={selectedAdvisorId}
                onSelectAdvisor={handleSelectAdvisor}
              />
              
              <div className="header-controls">
                {/* Add session title display */}
                {currentSessionTitle && (
                  <div className="session-title-display">
                    <span>{currentSessionTitle}</span>
                  </div>
                )}

                {currentAdvisorSkill?.name && (
                  <button
                    className="current-skill-chip"
                    onClick={() => onNavigateToCanvas && onNavigateToCanvas('skills')}
                    title={currentAdvisorSkill.name ? `Current advisor skill: ${currentAdvisorSkill.name}` : 'Current advisor skill'}
                    type="button"
                  >
                    <span>Skill:</span> {currentAdvisorSkill.name}
                  </button>
                )}

                {/* Export Button */}
                <ExportButton
                  hasMessages={hasConversationMessages}
                  currentSessionId={currentSessionId}
                  authToken={authToken}
                />

                {/* Provider Dropdown */}
                <ProviderDropdown
                  currentProvider={currentProvider}
                  onProviderChange={handleProviderSwitch}
                  isLoading={isProviderSwitching}
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
                      group.type === 'advisor_group' ? (
                        <AdvisorCarousel
                          key={group.messages.map(m => m.id).join('-')}
                          messages={group.messages}
                          onReply={handleReplyToMessage}
                          onExpand={handleExpandMessage}
                          onClick={handleMessageClick}
                        />
                      ) : (
                      <div key={group.message.id}>
                        {group.message.type === 'user' && (
                          <div className="user-message-container">
                            <div className="user-message-stack">
                              {editingMessage?.id === group.message.id ? (
                                <div className="user-edit-panel">
                                  <textarea
                                    className="user-edit-textarea"
                                    value={editingMessage.content}
                                    onChange={(event) => setEditingMessage(prev => ({ ...prev, content: event.target.value }))}
                                    disabled={isLoading}
                                    autoFocus
                                  />
                                  <div className="user-edit-actions">
                                    <button
                                      className="user-edit-action-button"
                                      onClick={handleCancelRegenerate}
                                      disabled={isLoading}
                                      title="Cancel"
                                      aria-label="Cancel edit"
                                    >
                                      <X size={14} />
                                    </button>
                                    <button
                                      className="user-edit-action-button user-edit-submit"
                                      onClick={handleSubmitRegenerate}
                                      disabled={isLoading || !editingMessage.content.trim()}
                                      title="Send again"
                                      aria-label="Send edited question again"
                                    >
                                      <Check size={14} />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="user-message">
                                    {group.message.replyTo && (
                                      <div className="reply-indicator">
                                        <Reply size={12} />
                                        <span>Reply to {group.message.replyTo.advisorName}</span>
                                      </div>
                                    )}
                                    <p>{group.message.content}</p>
                                  </div>
                                  {!group.message.replyTo && (
                                    <button
                                      className="user-regenerate-button"
                                      onClick={() => handleStartRegenerate(group.message)}
                                      disabled={isLoading || !currentSessionId}
                                      title="Edit and regenerate"
                                      aria-label="Edit and regenerate this question"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  )}
                                </>
                              )}
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
                          <span className="thinking-label">
                            {currentResponseStage || 'Preparing your response...'}
                          </span>
                          <div className="thinking-animation">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {thinkingAdvisors.filter(id => id !== 'system').map(advisorId => (
                      <ThinkingIndicator
                        key={advisorId}
                        advisorId={advisorId}
                        statusText={currentResponseStage}
                      />
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
              ensureSessionId={ensureCurrentSessionId}
              placeholder={
                replyingTo 
                  ? `Reply to ${replyingTo.advisorName}...`
                  : chatPlaceholder
              }
            />
          </div>
        </div>
      </div>
    </div>
    </OnboardingTour>
  );
};

export default ChatPage;
