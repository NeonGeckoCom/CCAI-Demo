import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { ADVISORS } from '../../data/canvasData';

/** Modal to toggle which advisors are active in chat. */
const AdvisorModal = ({ open, onClose, activeIds, onSave }) => {
  const [draft, setDraft] = useState(new Set(activeIds));

  useEffect(() => {
    if (open) setDraft(new Set(activeIds));
  }, [open, activeIds]);

  if (!open) return null;

  const toggle = (id) => {
    const next = new Set(draft);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Manage advisors</h2>
            <p>Pick which advisors respond in chat. You can change this anytime.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="X" size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="advisor-toggle-grid">
            {ADVISORS.map((a) => {
              const active = draft.has(a.id);
              return (
                <div
                  key={a.id}
                  className={`advisor-toggle ${active ? 'active' : ''}`}
                  onClick={() => toggle(a.id)}
                >
                  <div className="at-icon" style={{ background: a.color }}>
                    <Icon name={a.icon} size={20} color="#fff" />
                  </div>
                  <div>
                    <div className="at-name">{a.name}</div>
                    <div className="at-role" style={{ color: a.color }}>{a.role}</div>
                    <div className="at-sum">{a.summary}</div>
                  </div>
                  <div className="switch" />
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-foot">
          <div className="summary">
            <strong>{draft.size}</strong> of {ADVISORS.length} advisors active
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => onSave(draft)}>
              <Icon name="Check" size={14} color="#fff" /> Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvisorModal;
