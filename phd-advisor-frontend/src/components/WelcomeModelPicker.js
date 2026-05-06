import React, { useMemo, useState } from 'react';
import { Cloud, Cpu, Server, ChevronDown, Settings2 } from 'lucide-react';
import AdvisorConfigPanel from './AdvisorConfigPanel';

// Welcome-state model picker. Lets a new user pick a uniform default backend
// (Gemini / Ollama / vLLM) and optionally drill into per-advisor overrides.
//
// Primary picker → POSTs uniform mode.
// Advanced expander → renders AdvisorConfigPanel; saving from here POSTs hybrid mode.

const PROVIDER_META = {
  gemini: { label: 'Gemini',  description: "Google's hosted Gemini",   icon: Cloud,  badge: 'Cloud' },
  ollama: { label: 'Ollama',  description: 'Local LLM via Ollama',     icon: Cpu,    badge: 'Local' },
  vllm:   { label: 'vLLM',    description: 'vLLM inference endpoint',  icon: Server, badge: 'API'   },
};

const card = {
  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
  borderRadius: 16, padding: 20, boxShadow: 'var(--shadow-md)',
  width: 'min(720px, 100%)', margin: '24px auto',
};

const optionGrid = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12, marginTop: 12,
};

const optionStyle = (selected, disabled) => ({
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
  padding: '14px 14px', borderRadius: 12,
  border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
  background: selected ? 'var(--feature-bg, var(--bg-secondary))' : 'var(--bg-secondary)',
  color: 'var(--text-primary)', textAlign: 'left',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
  transition: 'border-color 0.15s ease, background 0.15s ease',
});

const advancedHeader = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 20,
  padding: '10px 12px', borderRadius: 10,
  background: 'transparent', border: '1px dashed var(--border-primary)',
  color: 'var(--text-secondary)', cursor: 'pointer', width: '100%',
  fontSize: 13.5, fontWeight: 500,
};

const WelcomeModelPicker = ({
  advisors,
  availableBackends,
  llmConfig,
  isSwitching,
  onSelectUniform,
  onSubmitHybrid,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(llmConfig?.mode === 'hybrid');
  const [draft, setDraft] = useState(() => ({
    default_backend: llmConfig?.default_backend || availableBackends[0] || 'gemini',
    orchestrator_backend: llmConfig?.orchestrator_backend || llmConfig?.default_backend || availableBackends[0] || 'gemini',
    persona_backends: llmConfig?.persona_backends || {},
  }));

  const providers = useMemo(
    () => availableBackends.filter(b => PROVIDER_META[b]),
    [availableBackends]
  );

  const isHybrid = llmConfig?.mode === 'hybrid';
  const activeUniform = !isHybrid ? llmConfig?.default_backend : null;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Choose your model</h3>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          {isHybrid ? 'Hybrid configuration active' : `Active: ${PROVIDER_META[activeUniform]?.label || activeUniform || '—'}`}
        </span>
      </div>
      <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
        Pick the backend that powers every advisor by default. You can mix and match in Advanced.
      </p>

      <div style={optionGrid}>
        {providers.map(id => {
          const meta = PROVIDER_META[id];
          const Icon = meta.icon;
          const selected = !isHybrid && activeUniform === id;
          return (
            <button
              key={id}
              type="button"
              style={optionStyle(selected, isSwitching)}
              disabled={isSwitching}
              onClick={() => onSelectUniform(id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <Icon size={18} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</span>
                <span
                  style={{
                    marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    background: 'var(--bg-tertiary, var(--bg-primary))',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {meta.badge}
                </span>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{meta.description}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        style={advancedHeader}
        onClick={() => setAdvancedOpen(o => !o)}
        aria-expanded={advancedOpen}
      >
        <Settings2 size={15} />
        <span>Advanced — pick a different backend per advisor</span>
        <ChevronDown
          size={16}
          style={{
            marginLeft: 'auto',
            transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {advancedOpen && (
        <div style={{ marginTop: 16 }}>
          <AdvisorConfigPanel
            advisors={advisors}
            availableBackends={availableBackends}
            value={draft}
            onChange={setDraft}
            hideDefault
            description="Default falls through to your selection above. Override the orchestrator or any advisor here."
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => onSubmitHybrid(draft)}
              disabled={isSwitching}
              style={{
                padding: '8px 14px', borderRadius: 8, border: 'none',
                background: 'var(--accent-primary)', color: '#fff',
                cursor: isSwitching ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 600,
              }}
            >
              {isSwitching ? 'Saving…' : 'Save advanced configuration'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WelcomeModelPicker;
