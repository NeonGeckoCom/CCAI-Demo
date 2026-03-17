import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Reply, Copy, Check, Maximize2, FileText, Hash, Target, Volume2, VolumeX, Search, X, Loader2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { useVoiceStatus } from '../contexts/VoiceStatusContext';
import LemonSliceAvatar from './LemonSliceAvatar';

const stripMarkdown = (md) => {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s?/g, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[-*+]\s/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
};

const MessageBubble = ({ 
  message, 
  onReply, 
  onCopy, 
  onExpand,
  onSearchReferences,
  showReplyButton = false,
  inlineAvatar = false,
  userAvatarId,
  userAvatarOptions
}) => {
  const { isDark } = useTheme();
  const { allPersonas: advisors, getAllPersonaColors: getAdvisorColors } = useAppConfig();
  const voiceStatus = useVoiceStatus();
  const [showTooltip, setShowTooltip] = useState(null);
  const [copiedStates, setCopiedStates] = useState({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [searchPopover, setSearchPopover] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const overlayRef = useRef(null);
  const tooltipTimer = useRef(null);
  const audioRef = useRef(null);

  const handleSpeak = useCallback(async (content) => {
    if (isSpeaking || isLoadingTTS) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setIsSpeaking(false);
      setIsLoadingTTS(false);
      return;
    }
    if (voiceStatus && !voiceStatus.ensureReady('tts')) return;

    const text = (content || '').trim();
    if (!text) return;
    setIsLoadingTTS(true);
    try {
      const token = localStorage.getItem('authToken');
      const resp = await fetch(`${process.env.REACT_APP_API_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error('TTS failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setIsLoadingTTS(false);
      setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.play();
    } catch (e) {
      console.error('TTS error:', e);
      setIsLoadingTTS(false);
      setIsSpeaking(false);
    }
  }, [isSpeaking, isLoadingTTS, voiceStatus]);

  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  const handleCopy = async (messageId, content) => {
    try {
      await navigator.clipboard.writeText(content || '');
      setCopiedStates(prev => ({ ...prev, [messageId]: true }));
      if (onCopy) onCopy(messageId, content || '');
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [messageId]: false }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleExpand = (messageId, persona_id) => {
    if (onExpand) onExpand(messageId, persona_id);
  };

  const handleSearch = async () => {
    setSearchPopover(true);
    setSearchLoading(true);
    const content = message?.compact_markdown || message?.content || '';
    try {
      const token = localStorage.getItem('authToken');
      const resp = await fetch(`${process.env.REACT_APP_API_URL}/api/search-references`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: content.substring(0, 500) }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSearchQuery(data.search_query || content.substring(0, 100));
      } else {
        setSearchQuery(content.substring(0, 100));
      }
    } catch {
      setSearchQuery(content.substring(0, 100));
    } finally {
      setSearchLoading(false);
    }
  };

  const showTooltipWithDelay = (tooltipType) => {
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setShowTooltip(tooltipType), 500);
  };

  const hideTooltip = () => {
    clearTimeout(tooltipTimer.current);
    setShowTooltip(null);
  };

  // Minimal, safe preprocessing (keep Markdown structure intact)
  const preprocessMarkdown = (content) => {
    const input = (content || '').toString();

    // 1) Strip trailing sentinel
    let processed = input.replace(/\s*<\/END>\s*$/i, '');

    // 2) Normalize EOL and trim right spaces (preserve newlines)
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    processed = processed.split('\n').map(ln => ln.replace(/\s+$/, '')).join('\n');

    // 3) Unicode bullets -> '-' (so GFM parses lists)
    processed = processed.replace(/^\s*[•●▪◦]\s+/gm, '- ');

    // 4) Merge orphan numbered items: "1.\nText" => "1. Text"
    processed = processed.replace(/(^\s*(\d+)\.\s*$)\n^\s*(\S.*)$/gm, (_m, _a, num, next) => `${num}. ${next}`);

    // 5) Collapse 3+ blank lines to 2
    processed = processed.replace(/\n{3,}/g, '\n\n');

    return processed.trim();
  };

  // ENHANCED MARKDOWN COMPONENTS WITH BETTER STYLING
  const markdownComponents = {
    // Keep <strong> INLINE to avoid breaking paragraphs/lists
    strong: ({ children }) => (
      <strong style={{ 
        fontWeight: '700',
        color: isDark ? '#ffffff' : '#1f2937'
      }}>
        {children}
      </strong>
    ),
    
    // Italic text styling
    em: ({ children }) => (
      <em style={{ 
        fontStyle: 'italic',
        color: isDark ? '#93c5fd' : '#3b82f6',
        fontWeight: '500'
      }}>
        {children}
      </em>
    ),
    
    // Paragraph styling with proper spacing
    p: ({ children }) => (
      <p style={{ 
        marginBottom: '0.75rem',
        lineHeight: '1.7',
        color: isDark ? '#e5e7eb' : '#111827'
      }}>
        {children}
      </p>
    ),

    // Unordered list styling
    ul: ({ children }) => (
      <ul style={{ 
        listStyleType: 'disc',
        paddingLeft: '1.5rem',
        marginBottom: '1rem',
        marginTop: '0.5rem',
        color: isDark ? '#e5e7eb' : '#374151'
      }}>
        {children}
      </ul>
    ),
    
    // Ordered list styling with better spacing
    ol: ({ children }) => (
      <ol style={{ 
        listStyleType: 'decimal',
        paddingLeft: '1.5rem',
        marginBottom: '1rem',
        marginTop: '0.5rem',
        color: isDark ? '#e5e7eb' : '#374151',
        counterReset: 'list-counter'
      }}>
        {children}
      </ol>
    ),
    
    // List item styling with proper spacing
    li: ({ children }) => (
      <li style={{ 
        marginBottom: '0.75rem',
        lineHeight: '1.6',
      }}>
        {children}
      </li>
    ),
    
    // Inline code styling
    code: ({ inline, children }) => (
      inline ? (
        <code style={{ 
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          padding: '0.2rem 0.35rem',
          borderRadius: '4px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '0.875rem'
        }}>
          {children}
        </code>
      ) : (
        <pre style={{ 
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          padding: '0.85rem',
          borderRadius: '8px',
          overflowX: 'auto',
          margin: '0.5rem 0 1rem'
        }}>
          <code>
            {children}
          </code>
        </pre>
      )
    )
  };

  // USER MESSAGE
  if (message.type === 'user') {
    const uAvatar = userAvatarOptions?.find(a => a.id === userAvatarId);
    const UserIcon = uAvatar
      ? (LucideIcons[uAvatar.icon] || LucideIcons.User)
      : null;

    return (
      <div className="user-message-container">
        <div className="user-message">
          {message.replyTo && (
            <div className="reply-indicator">
              <Reply size={14} />
              <span>to {message.replyTo.advisorName}</span>
            </div>
          )}
          <p>{message.content}</p>
        </div>
        {UserIcon && (
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginLeft: 8,
            backgroundColor: uAvatar.bg, color: uAvatar.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <UserIcon size={16} />
          </div>
        )}
      </div>
    );
  }

  // ADVISOR MESSAGE
  if (message.type === 'advisor') {
    const personaId =
      message?.persona_id ||
      message?.personaId ||
      message?.advisor_id ||
      message?.advisorId ||
      (typeof message?.advisor === 'string' ? message.advisor : undefined) ||
      'methodologist';

    const advisor = advisors[personaId] || advisors[message.persona_id] || {};
    const Icon = advisor.icon;
    const colors = getAdvisorColors(personaId, isDark);
    const isCopied = copiedStates[message.id];

    const avatarElement = (size = 40) => (
      advisor.avatarUrl ? (
        <img 
          src={advisor.avatarUrl} 
          alt={advisor.name || 'Advisor'} 
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} 
        />
      ) : Icon ? (
        <div
          style={{
            width: size, height: size, borderRadius: '50%', backgroundColor: colors.bgColor || 'var(--bg-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden'
          }}
        >
          <Icon style={{ color: colors.color || 'var(--text-secondary)', width: size * 0.5, height: size * 0.5 }} />
        </div>
      ) : (
        <div
          style={{
            width: size, height: size, borderRadius: '50%', backgroundColor: colors.bgColor || 'var(--bg-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            color: colors.color || 'var(--text-secondary)', fontWeight: 600, fontSize: size * 0.4
          }}
        >
          {advisor.name ? advisor.name.charAt(0) : 'A'}
        </div>
      )
    );

    return (
      <div className={`advisor-message-container ${inlineAvatar ? 'inline-avatar-mode' : ''}`}>
        {!inlineAvatar && (
          <div 
            className="advisor-avatar" 
            style={{ backgroundColor: colors.bgColor || 'var(--bg-muted)', overflow: 'hidden' }}
          >
            <LemonSliceAvatar agentId={advisor.lemonsliceAgentId} active={isSpeaking || isLoadingTTS} size={40}>
              {avatarElement(40)}
            </LemonSliceAvatar>
          </div>
        )}

        <div 
          className="advisor-message-bubble"
          style={{ 
            backgroundColor: colors.bgColor || 'var(--bg-primary)',
            borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)'),
            position: 'relative'
          }}
        >
          <div className="advisor-message-header">
            {inlineAvatar && avatarElement(32)}
            <h4 
              className="advisor-message-name" 
              style={{ color: colors.color || 'var(--text-primary)' }}
            >
              {advisor.name || message.advisorName || 'Advisor'}
              {message.isReply && <span className="reply-badge">↳ Reply</span>}
              {message.isExpansion && <span className="expansion-badge">⤴ Expanded</span>}
            </h4>
            <span 
              className="message-time"
              style={{ 
                color: colors.color || 'var(--text-secondary)',
                opacity: 0.7 
              }}
            >
              {message.timestamp?.toLocaleTimeString
                ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''}
            </span>
          </div>
          
          {/* Enhanced markdown rendering with preprocessing */}
          <div 
            className="advisor-message-text"
            style={{ color: colors.textColor || (isDark ? '#e5e7eb' : '#111827') }}
          >
            <ReactMarkdown 
              components={markdownComponents}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[]}
            >
              {preprocessMarkdown(message?.compact_markdown || message?.content || message?.text)}
            </ReactMarkdown>
          </div>
          
          {showReplyButton && (
            <div className="message-actions">
              <div className="message-action-buttons">
                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={() => onReply && onReply(message)}
                    onMouseEnter={() => showTooltipWithDelay('reply')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: colors.color || 'var(--text-secondary)',
                      borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)')
                    }}
                  >
                    <Reply size={14} stroke="currentColor" fill="none" />
                  </button>
                  {showTooltip === 'reply' && (
                    <div className="tooltip">Reply to this message</div>
                  )}
                </div>

                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={() => handleCopy(message.id, message?.compact_markdown || message?.content || '')}
                    onMouseEnter={() => showTooltipWithDelay('copy')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: isCopied ? '#10B981' : (colors.color || 'var(--text-secondary)'),
                      borderColor: isCopied ? '#10B98140' : (colors.color ? colors.color + '40' : 'var(--border-muted)')
                    }}
                  >
                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  {showTooltip === 'copy' && (
                    <div className="tooltip">
                      {isCopied ? 'Copied!' : 'Copy to clipboard'}
                    </div>
                  )}
                </div>

                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={() => handleExpand(message.id, personaId)}
                    onMouseEnter={() => showTooltipWithDelay('expand')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: colors.color || 'var(--text-secondary)',
                      borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)')
                    }}
                  >
                    <Maximize2 size={14} />
                  </button>
                  {showTooltip === 'expand' && (
                    <div className="tooltip">More</div>
                  )}
                </div>

                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={() => handleSpeak(message?.compact_markdown || message?.content || '')}
                    onMouseEnter={() => showTooltipWithDelay('speak')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: isLoadingTTS ? (colors.color || 'var(--text-secondary)') : isSpeaking ? '#EF4444' : (colors.color || 'var(--text-secondary)'),
                      borderColor: isSpeaking ? '#EF444440' : (colors.color ? colors.color + '40' : 'var(--border-muted)'),
                      opacity: isLoadingTTS ? 0.7 : 1,
                    }}
                  >
                    {isLoadingTTS ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  {showTooltip === 'speak' && (
                    <div className="tooltip">{isLoadingTTS ? 'Loading audio...' : isSpeaking ? 'Stop speaking' : 'Speak it'}</div>
                  )}
                </div>

                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={handleSearch}
                    onMouseEnter={() => showTooltipWithDelay('search')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: colors.color || 'var(--text-secondary)',
                      borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)')
                    }}
                  >
                    <Search size={14} />
                  </button>
                  {showTooltip === 'search' && (
                    <div className="tooltip">Search for references</div>
                  )}
                </div>

              </div>
            </div>
          )}

          {searchPopover && (
            <div style={{
              marginTop: 8, background: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)', borderRadius: 12,
              padding: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>Search for References</span>
                <button onClick={() => setSearchPopover(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  <X size={14} />
                </button>
              </div>
              {searchLoading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Generating search query...</div>
              ) : (
                <>
                  <div style={{
                    background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 10px',
                    fontSize: 12, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.4,
                  }}>{searchQuery}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => window.open(`https://www.perplexity.ai/?q=${encodeURIComponent(searchQuery)}`, '_blank')} style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                    }}>Open in Perplexity</button>
                    <button onClick={() => {
                      navigator.clipboard.writeText(searchQuery).then(() => {
                        setPromptCopied(true);
                        setTimeout(() => setPromptCopied(false), 2000);
                      }).catch(() => {});
                    }} style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: promptCopied ? '#10B98120' : 'var(--bg-secondary)',
                      color: promptCopied ? '#10B981' : 'var(--text-primary)',
                      border: `1px solid ${promptCopied ? '#10B98140' : 'var(--border-primary)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}>{promptCopied ? '✓ Copied!' : 'Copy Prompt'}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ERROR MESSAGE
  if (message.type === 'error') {
    return (
      <div className="error-message-container">
        <div className="error-message">
          <p>{message.content}</p>
        </div>
      </div>
    );
  }

  return null;
};

export default MessageBubble;

/** RAG Info overlay kept as-is from your original file */
const RagInfoOverlay = ({ ragMetadata, colors }) => {
  const overlayRef = useRef(null);
  const [documentChunks, setDocumentChunks] = useState([]);

  useEffect(() => {
    if (ragMetadata?.documentChunks) {
      setDocumentChunks(ragMetadata.documentChunks);
    }
  }, [ragMetadata]);

  const hasDocuments = documentChunks.length > 0;

  return (
    <div className="rag-info-overlay" ref={overlayRef}>
      <div className="rag-overlay-content">
        <div className="rag-header">
          <div className="rag-title">
            <FileText size={14} />
            <span>Response Details</span>
          </div>
        </div>

        <div className="rag-section">
          <div className="rag-metrics">
            <div className="metric-item">
              <Hash size={14} />
              <span className="metric-label">Model</span>
              <span className="metric-value">{ragMetadata?.model || 'unknown'}</span>
            </div>
            <div className="metric-item">
              <Hash size={14} />
              <span className="metric-label">Tokens</span>
              <span className="metric-value">{ragMetadata?.tokens ?? '—'}</span>
            </div>
          </div>
        </div>

        {hasDocuments && documentChunks.length > 0 && (
          <div className="rag-documents-section">
            <div className="rag-section-title">
              <FileText size={12} />
              Referenced Sources
            </div>
            
            {documentChunks.map((chunk, index) => (
              <div key={index} className="rag-document-item">
                <div className="rag-document-header">
                  <span className="rag-filename">
                    {chunk.metadata?.filename || 'Unknown file'}
                  </span>
                  <span className="rag-relevance">
                    <Target size={10} />
                    {Math.round((chunk.relevance_score || 0) * 100)}%
                  </span>
                </div>
                
                {chunk.text && (
                  <div className="rag-chunk-preview">
                    {chunk.text.substring(0, 120)}
                    {chunk.text.length > 120 && '...'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
