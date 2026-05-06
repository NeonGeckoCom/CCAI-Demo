import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Layers } from 'lucide-react';
import AdvisorConfigPanel from './AdvisorConfigPanel';

// Settings modal. On feat/UI-for-User-Account-updates this file also has
// Profile / Password / Delete Account tabs. When that branch merges, fold
// those tabs into the tabRow + body sections below — the "advisors" tab
// shipped on this branch is the only one not present there.

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 0, width: 640,
  maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden',
  boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column',
};

const header = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '20px 24px', borderBottom: '1px solid var(--border-primary)',
};

const tabRow = {
  display: 'flex', gap: 4, padding: '12px 16px 0',
  borderBottom: '1px solid var(--border-primary)',
};

const tabBtn = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px', background: 'transparent',
  border: 'none', borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 13.5, fontWeight: 500,
  marginBottom: -1,
});

const body = { padding: 24, overflowY: 'auto', flex: 1 };

const SettingsModal = ({
  user,
  advisors,
  availableBackends,
  llmConfig,
  isSaving,
  onSubmitConfig,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState('advisors');

  const personaIds = useMemo(() => Object.keys(advisors || {}), [advisors]);
  const [draft, setDraft] = useState(() => {
    const fallback = llmConfig?.default_backend || availableBackends?.[0] || 'gemini';
    const seed = llmConfig?.persona_backends || {};
    const personas = {};
    for (const id of personaIds) {
      personas[id] = seed[id] || fallback;
    }
    return {
      default_backend: fallback,
      orchestrator_backend: llmConfig?.orchestrator_backend || fallback,
      persona_backends: personas,
    };
  });

  const handleSave = () => {
    onSubmitConfig(draft);
  };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={header}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 18 }}>Settings</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={tabRow}>
          <button style={tabBtn(activeTab === 'advisors')} onClick={() => setActiveTab('advisors')}>
            <Layers size={15} /> Advisor Config
          </button>
        </div>

        <div style={body}>
          {activeTab === 'advisors' && (
            <>
              <AdvisorConfigPanel
                advisors={advisors}
                availableBackends={availableBackends || []}
                value={draft}
                onChange={setDraft}
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
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
