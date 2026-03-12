import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Reply, Copy, Check, Maximize2, Info, FileText, Hash, Target } from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';

const MessageBubble = ({ 
  message, 
  onReply, 
  onCopy, 
  onExpand,
  showReplyButton = false 
}) => {
  const { isDark } = useTheme();
  const { advisors, getAdvisorColors } = useAppConfig();
  const [showTooltip, setShowTooltip] = useState(null);
  const [copiedStates, setCopiedStates] = useState({});
  const [showInfoOverlay, setShowInfoOverlay] = useState(false);
  const overlayRef = useRef(null);

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

  const handleInfoToggle = () => {
    setShowInfoOverlay(!showInfoOverlay);
  };

  const showTooltipWithDelay = (tooltipType) => {
    setTimeout(() => setShowTooltip(tooltipType), 500);
  };

  const hideTooltip = () => setShowTooltip(null);

  // Close overlay when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (overlayRef.current && !overlayRef.current.contains(event.target)) {
        setShowInfoOverlay(false);
      }
    };

    if (showInfoOverlay) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showInfoOverlay]);

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

    return (
      <div className="advisor-message-container">
        <div 
          className="advisor-avatar" 
          style={{ backgroundColor: colors.bgColor || 'var(--bg-muted)' }}
        >
          {Icon ? <Icon style={{ color: colors.color || 'var(--text-secondary)' }} /> : (advisor.name ? advisor.name.charAt(0) : 'A')}
        </div>

        <div 
          className="advisor-message-bubble"
          style={{ 
            backgroundColor: colors.bgColor || 'var(--bg-primary)',
            borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)'),
            position: 'relative'
          }}
        >
          <div className="advisor-message-header">
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
                    <div className="tooltip">Expand</div>
                  )}
                </div>

                <div className="tooltip-container">
                  <button 
                    className="message-action-button"
                    onClick={handleInfoToggle}
                    onMouseEnter={() => showTooltipWithDelay('info')}
                    onMouseLeave={hideTooltip}
                    style={{ 
                      color: colors.color || 'var(--text-secondary)',
                      borderColor: (colors.color ? colors.color + '40' : 'var(--border-muted)')
                    }}
                  >
                    <Info size={14} />
                  </button>
                  {showTooltip === 'info' && (
                    <div className="tooltip">Info</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {showInfoOverlay && (
            <RagInfoOverlay 
              ragMetadata={message.ragMetadata} 
              colors={colors}
            />
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
