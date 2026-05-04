import React, { useState, useEffect } from 'react';
import { Users, ChevronDown, Pencil } from 'lucide-react';
import AvatarPickerModal from './AvatarPickerModal';

const AdvisorStatusDropdown = ({ advisors, thinkingAdvisors, getAdvisorColors, isDark }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState(null);
  const [pickerAdvisor, setPickerAdvisor] = useState(null);
  
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
  const totalAdvisors = advisorEntries.length;

  const handleToggle = () => {
    setIsOpen(!isOpen);
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
            {totalAdvisors} Advisor{totalAdvisors !== 1 ? 's' : ''}
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
      {isOpen && (
        <div className="advisor-dropdown-panel">
          <div className="advisor-list">
            {advisorEntries.map(([id, advisor]) => {
              const IconComponent = advisor.icon;
              const colors = getAdvisorColors(id, isDark);
              const isThinking = Array.isArray(thinkingAdvisors) && thinkingAdvisors.includes(id);
              
              return (
                <div
                  key={id}
                  className={`advisor-item ${isThinking ? 'thinking' : ''}`}
                  style={{ '--advisor-color': colors.color, '--advisor-bg': colors.bgColor }}
                >
                  <div
                    className="advisor-icon"
                    style={{ position: 'relative', cursor: 'pointer', overflow: 'hidden', width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setPickerAdvisor({ id, name: advisor.name })}
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
                    <div className="advisor-description">{advisor.description}</div>
                  </div>
                  <div className="advisor-status">
                    {isThinking ? (
                      <div className="status-thinking">
                        <div className="thinking-dots">
                          <div className="dot"></div>
                          <div className="dot"></div>
                          <div className="dot"></div>
                        </div>
                      </div>
                    ) : (
                      <div className="status-ready">Ready</div>
                    )}
                  </div>
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