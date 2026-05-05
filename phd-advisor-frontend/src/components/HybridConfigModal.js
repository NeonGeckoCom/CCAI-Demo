import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { X, Layers } from 'lucide-react';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 24, width: 560,
  maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: 'var(--shadow-xl)', color: 'var(--text-primary)',
};

const row = {
  display: 'grid', gridTemplateColumns: '1fr 180px', alignItems: 'center',
  gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-primary)',
};

const select = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)',
  background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13.5,
  width: '100%',
};

const HybridConfigModal = ({
  advisors,
  availableBackends,
  initialConfig,
  isSaving,
  onSubmit,
  onClose,
}) => {
  const personaIds = useMemo(() => Object.keys(advisors || {}), [advisors]);

  const [defaultBackend, setDefaultBackend] = useState(
    initialConfig?.default_backend || availableBackends[0] || 'gemini'
  );
  const [orchestratorBackend, setOrchestratorBackend] = useState(
    initialConfig?.orchestrator_backend || initialConfig?.default_backend || availableBackends[0] || 'gemini'
  );
  const [personaBackends, setPersonaBackends] = useState(() => {
    const seed = initialConfig?.persona_backends || {};
    const out = {};
    for (const id of personaIds) {
      out[id] = seed[id] || initialConfig?.default_backend || availableBackends[0] || 'gemini';
    }
    return out;
  });

  const setPersona = (id, value) => {
    setPersonaBackends(prev => ({ ...prev, [id]: value }));
  };

  const handleSave = () => {
    onSubmit({
      default_backend: defaultBackend,
      orchestrator_backend: orchestratorBackend,
      persona_backends: personaBackends,
    });
  };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={20} />
            <h3 style={{ margin: 0, fontSize: 18 }}>Hybrid LLM Configuration</h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13.5 }}>
          Pick a backend for the orchestrator and each advisor. The default backend is used as a fallback.
        </p>

        <div style={row}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Default backend</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Used when no specific override is set.</div>
          </div>
          <select style={select} value={defaultBackend} onChange={(e) => setDefaultBackend(e.target.value)}>
            {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div style={row}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Orchestrator</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Routes user input across advisors.</div>
          </div>
          <select style={select} value={orchestratorBackend} onChange={(e) => setOrchestratorBackend(e.target.value)}>
            {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {personaIds.map((id) => {
          const advisor = advisors[id];
          const locked = advisor?.backendLocked;
          const value = locked && advisor?.defaultBackend ? advisor.defaultBackend : personaBackends[id];
          return (
            <div style={row} key={id}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{advisor?.name || id}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {advisor?.role || id}{locked ? ' · backend locked' : ''}
                </div>
              </div>
              <select
                style={{ ...select, opacity: locked ? 0.6 : 1 }}
                value={value}
                disabled={locked}
                onChange={(e) => setPersona(id, e.target.value)}
              >
                {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-primary)',
              background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13.5,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: 'var(--accent-primary)', color: '#fff',
              cursor: isSaving ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 600,
            }}
          >
            {isSaving ? 'Saving…' : 'Save configuration'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HybridConfigModal;
