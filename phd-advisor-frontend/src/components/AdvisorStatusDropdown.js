import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Users, ChevronDown, Pencil, AlertTriangle, X, Check } from 'lucide-react';
import AvatarPickerModal from './AvatarPickerModal';
import Toggle from './Toggle';
import { useAppConfig } from '../contexts/AppConfigContext';

const AdvisorStatusDropdown = ({
  advisors,
  thinkingAdvisors,
  getAdvisorColors,
  isDark,
  selectedAdvisorId,
  onSelectAdvisor,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState(null);
  const [pickerAdvisor, setPickerAdvisor] = useState(null);
  const [pendingDisableId, setPendingDisableId] = useState(null);
  const { isAdvisorEnabled, setAdvisorEnabled } = useAppConfig();
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('.advisor-status-dropdown')) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!advisors || typeof advisors !== 'object') {
    return null;
  }
  
  const advisorEntries = Object.entries(advisors);
  const thinkingCount = Array.isArray(thinkingAdvisors)
    ? thinkingAdvisors.filter(id => id !== 'system').length
    : 0;
  const enabledCount = advisorEntries.filter(([id]) => isAdvisorEnabled(id)).length;
  const selectedAdvisor = selectedAdvisorId ? advisors[selectedAdvisorId] : null;

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleAdvisorToggle = (id, next) => {
    if (!next && enabledCount === 1 && isAdvisorEnabled(id)) {
      setPendingDisableId(id);
      return;
    }
    setAdvisorEnabled(id, next);
  };

  const handleAdvisorSelect = (id, enabled) => {
    if (!enabled) return;
    onSelectAdvisor?.(id);
    setIsOpen(false);
  };

  const confirmDisable = () => {
    if (pendingDisableId) setAdvisorEnabled(pendingDisableId, false);
    setPendingDisableId(null);
  };

  return (
    <div className="advisor-status-dropdown">
      <button 
        className={`advisor-status-button ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
      >
        <div className="advisor-status-info">
          <Users size={16} />
          <span className="advisor-count">
            {selectedAdvisor ? selectedAdvisor.name : 'Choose Advisor'}
          </span>
          {thinkingCount > 0 && (
            <div className="thinking-badge">
              {thinkingCount} thinking
            </div>
          )}
        </div>
        <ChevronDown size={14} className={`dropdown-arrow ${isOpen ? 'rotated' : ''}`} />
      </button>
      
      {pickerAdvisor && (
        <AvatarPickerModal
          advisorId={pickerAdvisor.id}
          advisorName={pickerAdvisor.name}
          onClose={() => setPickerAdvisor(null)}
        />
      )}

      {pendingDisableId && ReactDOM.createPortal(
        <div
          className="disable-all-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPendingDisableId(null); }}
        >
          <div className="disable-all-modal">
            <div className="disable-all-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={18} style={{ color: '#dc2626' }} />
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 16 }}>Disable all advisors?</h3>
              </div>
              <button
                onClick={() => setPendingDisableId(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="disable-all-body">
              Disabling all advisors makes it so chat won't work. You'll need to re-enable at least one advisor before you can have a conversation.
            </div>
            <div className="disable-all-actions">
              <button onClick={() => setPendingDisableId(null)} className="disable-all-secondary">Go back</button>
              <button onClick={confirmDisable} className="disable-all-danger">Continue</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {isOpen && (
        <div className="advisor-dropdown-panel">
          <div className="advisor-list">
            {advisorEntries.map(([id, advisor]) => {
              const IconComponent = advisor.icon;
              const colors = getAdvisorColors(id, isDark);
              const isThinking = Array.isArray(thinkingAdvisors) && thinkingAdvisors.includes(id);
              const enabled = isAdvisorEnabled(id);
              const selected = id === selectedAdvisorId;

              return (
                <div
                  key={id}
                  className={`advisor-item ${isThinking ? 'thinking' : ''} ${enabled ? '' : 'disabled'} ${selected ? 'selected' : ''}`}
                  style={{ '--advisor-color': colors.color, '--advisor-bg': colors.bgColor }}
                  onClick={() => handleAdvisorSelect(id, enabled)}
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <div
                    className="advisor-icon"
                    style={{ position: 'relative', cursor: 'pointer', overflow: 'hidden', width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPickerAdvisor({ id, name: advisor.name });
                    }}
                  >
                    {advisor.avatarUrl
                      ? <img src={advisor.avatarUrl} alt={advisor.name} style={{ width: 32, height: 32, objectFit: 'cover', display: 'block' }} />
                      : <IconComponent size={16} />
                    }
                    {hoveredId === id && (
                      <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Pencil size={10} color="#fff" />
                      </div>
                    )}
                  </div>
                  <div className="advisor-details">
                    <div className="advisor-name">{advisor.name}</div>
                    <div className="advisor-description">
                      {!enabled
                        ? <span className="advisor-off-label">Off — won't reply</span>
                        : isThinking
                          ? <span className="advisor-thinking-label">Thinking...</span>
                          : selected
                            ? <span className="advisor-selected-label">Selected for chat</span>
                            : advisor.description}
                    </div>
                  </div>
                  {selected && (
                    <Check
                      size={16}
                      className="advisor-selected-icon"
                      aria-label={`${advisor.name} selected`}
                    />
                  )}
                  <Toggle
                    checked={enabled}
                    onChange={(next) => handleAdvisorToggle(id, next)}
                    size="sm"
                    label={`Toggle ${advisor.name}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      <style>{`
        .advisor-status-dropdown {
          position: relative;
          display: inline-block;
        }
        
        .advisor-status-button {
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
          min-width: 140px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          color: var(--text-primary);
        }
        
        .advisor-status-button:hover {
          background: var(--bg-secondary);
          border-color: var(--accent-primary);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .advisor-status-button.open {
          background: var(--bg-secondary);
          border-color: var(--accent-primary);
        }
        
        .advisor-status-info {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
        }
        
        .advisor-count {
          font-weight: 600;
          color: var(--text-primary);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .thinking-badge {
          background: var(--accent-primary);
          color: white;
          padding: 2px 6px;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 600;
          animation: pulse 2s ease-in-out infinite;
        }
        
        .dropdown-arrow {
          color: var(--text-secondary);
          transition: transform 0.2s ease;
        }
        
        .dropdown-arrow.rotated {
          transform: rotate(180deg);
        }
        
        .advisor-dropdown-panel {
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
        
        [data-theme="dark"] .advisor-dropdown-panel {
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        }
        
        .advisor-list {
          max-height: 300px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-primary) transparent;
        }
        
        .advisor-list::-webkit-scrollbar {
          width: 6px;
        }
        
        .advisor-list::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .advisor-list::-webkit-scrollbar-thumb {
          background: var(--border-primary);
          border-radius: 3px;
        }
        
        .advisor-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-primary);
          transition: background-color 0.2s ease;
          cursor: pointer;
        }
        
        .advisor-item:last-child {
          border-bottom: none;
        }
        
        .advisor-item:hover {
          background: var(--bg-secondary);
        }
        
        .advisor-item.thinking {
          background: var(--advisor-bg);
        }

        .advisor-item.selected {
          background: var(--advisor-bg);
        }

        .advisor-item.disabled {
          cursor: not-allowed;
        }

        .advisor-item.disabled .advisor-icon,
        .advisor-item.disabled .advisor-name {
          opacity: 0.45;
        }

        .advisor-item.disabled .advisor-description {
          opacity: 0.7;
        }

        .advisor-off-label {
          color: var(--text-tertiary, #9ca3af);
          font-style: italic;
        }

        .advisor-thinking-label {
          color: var(--advisor-color);
          font-weight: 500;
        }

        .advisor-selected-label,
        .advisor-selected-icon {
          color: var(--advisor-color);
          font-weight: 600;
        }
        
        .advisor-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--advisor-bg);
          color: var(--advisor-color);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1px solid var(--advisor-color);
        }
        
        .advisor-details {
          flex: 1;
          min-width: 0;
        }
        
        .advisor-name {
          font-weight: 600;
          color: var(--text-primary);
          font-size: 13px;
          margin-bottom: 2px;
        }
        
        .advisor-description {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .advisor-status {
          flex-shrink: 0;
        }
        
        .status-thinking {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .thinking-dots {
          display: flex;
          gap: 2px;
        }
        
        .thinking-dots .dot {
          width: 4px;
          height: 4px;
          background: var(--advisor-color);
          border-radius: 50%;
          animation: thinking-bounce 1.4s infinite ease-in-out both;
        }
        
        .thinking-dots .dot:nth-child(1) { animation-delay: -0.32s; }
        .thinking-dots .dot:nth-child(2) { animation-delay: -0.16s; }
        .thinking-dots .dot:nth-child(3) { animation-delay: 0s; }
        
        .status-ready {
          font-size: 11px;
          color: var(--text-tertiary);
          font-weight: 500;
        }
        
        @keyframes thinking-bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .disable-all-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
        }

        .disable-all-modal {
          background: var(--bg-primary);
          border-radius: 16px;
          width: 420px;
          max-width: 95vw;
          box-shadow: var(--shadow-xl, 0 24px 48px rgba(0,0,0,0.25));
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .disable-all-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-primary);
        }

        .disable-all-body {
          padding: 20px;
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.5;
        }

        .disable-all-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 0 20px 20px;
        }

        .disable-all-secondary {
          background: transparent;
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          font-size: 13px;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
        }

        .disable-all-danger {
          background: #dc2626;
          color: #fff;
          border: none;
          font-size: 13px;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
          font-weight: 500;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
          .advisor-status-dropdown {
            display: none;
          }
          .advisor-dropdown-panel {
            right: -20px;
            left: -20px;
            min-width: unset;
            max-width: unset;
          }
          
          .advisor-status-button {
            min-width: 120px;
            font-size: 12px;
          }
          
          .advisor-item {
            padding: 10px 12px;
          }
          
          .advisor-icon {
            width: 28px;
            height: 28px;
          }
          
          .advisor-name {
            font-size: 12px;
          }
          
          .advisor-description {
            font-size: 10px;
          }
        }
      `}</style>
    </div>
  );
};

export default AdvisorStatusDropdown;
