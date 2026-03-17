import React, { useState, useEffect } from 'react';
import { Bot, ChevronDown } from 'lucide-react';

const AgentStatusDropdown = ({ agents, thinkingAdvisors, getAgentColors, isDark }) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('.agent-status-dropdown')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!agents || typeof agents !== 'object') return null;

  const agentEntries = Object.entries(agents);
  if (agentEntries.length === 0) return null;

  const thinkingCount = Array.isArray(thinkingAdvisors)
    ? thinkingAdvisors.filter(id => agents[id]).length
    : 0;

  return (
    <div className="agent-status-dropdown">
      <button
        className={`agent-status-button ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="agent-status-info">
          <Bot size={16} />
          <span className="agent-count">
            {agentEntries.length} Agent{agentEntries.length !== 1 ? 's' : ''}
          </span>
          {thinkingCount > 0 && (
            <div className="agent-thinking-badge">{thinkingCount} thinking</div>
          )}
        </div>
        <ChevronDown size={14} className={`agent-dropdown-arrow ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="agent-dropdown-panel">
          <div className="agent-list">
            {agentEntries.map(([id, agent]) => {
              const IconComponent = agent.icon;
              const colors = getAgentColors(id, isDark);
              const isThinking = Array.isArray(thinkingAdvisors) && thinkingAdvisors.includes(id);

              return (
                <div
                  key={id}
                  className={`agent-item ${isThinking ? 'thinking' : ''}`}
                  style={{
                    '--agent-color': colors.color,
                    '--agent-bg': colors.bgColor,
                  }}
                >
                  <div className="agent-icon">
                    {agent.avatar ? (
                      <img
                        src={agent.avatar}
                        alt={agent.name}
                        style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }}
                      />
                    ) : (
                      <IconComponent size={16} />
                    )}
                  </div>
                  <div className="agent-details">
                    <div className="agent-name">{agent.name}</div>
                    <div className="agent-description">{agent.description}</div>
                  </div>
                  <div className="agent-status-indicator">
                    {isThinking ? (
                      <div className="agent-thinking-dots">
                        <div className="dot"></div>
                        <div className="dot"></div>
                        <div className="dot"></div>
                      </div>
                    ) : (
                      <div className="agent-ready">Auto</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="agent-footer-note">
            Agents are invoked automatically when a matching query is detected.
          </div>
        </div>
      )}

      <style jsx>{`
        .agent-status-dropdown {
          position: relative;
          display: inline-block;
        }

        .agent-status-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 13px;
          min-width: 120px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          color: var(--text-primary);
        }

        .agent-status-button:hover {
          background: var(--bg-secondary);
          border-color: var(--accent-primary);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .agent-status-button.open {
          background: var(--bg-secondary);
          border-color: var(--accent-primary);
        }

        .agent-status-info {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
        }

        .agent-count {
          font-weight: 600;
          color: var(--text-primary);
        }

        .agent-thinking-badge {
          background: var(--accent-primary);
          color: white;
          padding: 2px 6px;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 600;
          animation: agent-pulse 2s ease-in-out infinite;
        }

        .agent-dropdown-arrow {
          color: var(--text-secondary);
          transition: transform 0.2s ease;
        }

        .agent-dropdown-arrow.rotated {
          transform: rotate(180deg);
        }

        .agent-dropdown-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 280px;
          max-width: 320px;
          background: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          overflow: hidden;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        [data-theme="dark"] .agent-dropdown-panel {
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        }

        .agent-list {
          max-height: 260px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-primary) transparent;
        }

        .agent-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-primary);
          transition: background-color 0.2s ease;
        }

        .agent-item:last-child {
          border-bottom: none;
        }

        .agent-item:hover {
          background: var(--bg-secondary);
        }

        .agent-item.thinking {
          background: var(--agent-bg);
        }

        .agent-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--agent-bg);
          color: var(--agent-color);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1px solid var(--agent-color);
        }

        .agent-details {
          flex: 1;
          min-width: 0;
        }

        .agent-name {
          font-weight: 600;
          color: var(--text-primary);
          font-size: 13px;
          margin-bottom: 2px;
        }

        .agent-description {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .agent-status-indicator {
          flex-shrink: 0;
        }

        .agent-ready {
          font-size: 11px;
          color: var(--text-tertiary);
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 6px;
          background: var(--bg-secondary);
        }

        .agent-thinking-dots {
          display: flex;
          gap: 2px;
        }

        .agent-thinking-dots .dot {
          width: 4px;
          height: 4px;
          background: var(--agent-color);
          border-radius: 50%;
          animation: agent-bounce 1.4s infinite ease-in-out both;
        }

        .agent-thinking-dots .dot:nth-child(1) { animation-delay: -0.32s; }
        .agent-thinking-dots .dot:nth-child(2) { animation-delay: -0.16s; }
        .agent-thinking-dots .dot:nth-child(3) { animation-delay: 0s; }

        .agent-footer-note {
          padding: 8px 16px;
          border-top: 1px solid var(--border-primary);
          font-size: 11px;
          color: var(--text-tertiary);
          font-style: italic;
        }

        @keyframes agent-bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }

        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @media (max-width: 768px) {
          .agent-status-dropdown {
            display: none;
          }
        }
      `}</style>
    </div>
  );
};

export default AgentStatusDropdown;
