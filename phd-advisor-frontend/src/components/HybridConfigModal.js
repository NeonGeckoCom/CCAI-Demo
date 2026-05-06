import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Layers } from 'lucide-react';
import AdvisorConfigPanel from './AdvisorConfigPanel';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 24, width: 560,
  maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: 'var(--shadow-xl)', color: 'var(--text-primary)',
};

const seedConfig = (initialConfig, personaIds, availableBackends) => {
  const fallback = initialConfig?.default_backend || availableBackends[0] || 'gemini';
  const seedPersonas = initialConfig?.persona_backends || {};
  const personas = {};
  for (const id of personaIds) {
    personas[id] = seedPersonas[id] || fallback;
  }
  return {
    default_backend: fallback,
    orchestrator_backend: initialConfig?.orchestrator_backend || fallback,
    persona_backends: personas,
  };
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
  const [config, setConfig] = useState(() => seedConfig(initialConfig, personaIds, availableBackends));

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

        <AdvisorConfigPanel
          advisors={advisors}
          availableBackends={availableBackends}
          value={config}
          onChange={setConfig}
          description="Pick a backend for the orchestrator and each advisor. The default backend is used as a fallback."
        />

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
            onClick={() => onSubmit(config)}
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
