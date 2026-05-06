import React, { useEffect, useMemo, useState } from 'react';

// Reusable per-advisor backend configuration panel.
//
// Used in two places:
//   - Welcome-state "Advanced" expander on ChatPage
//   - "Advisor Config" tab inside SettingsModal (lives on feat/UI-for-User-Account-updates;
//     drop this component in once branches merge)
//
// Controlled component. Parent owns the config object and decides when to persist.
//
// Shape of `value`:
//   { default_backend, orchestrator_backend, persona_backends: { [personaId]: backend } }

const rowStyle = {
  display: 'grid', gridTemplateColumns: '1fr 180px', alignItems: 'center',
  gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-primary)',
};

const selectStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)',
  background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13.5,
  width: '100%',
};

const buildInitial = (initialConfig, personaIds, availableBackends) => {
  const fallback = initialConfig?.default_backend || availableBackends[0] || 'gemini';
  const seed = initialConfig?.persona_backends || {};
  const personas = {};
  for (const id of personaIds) {
    personas[id] = seed[id] || fallback;
  }
  return {
    default_backend: fallback,
    orchestrator_backend: initialConfig?.orchestrator_backend || fallback,
    persona_backends: personas,
  };
};

const AdvisorConfigPanel = ({
  advisors,
  availableBackends,
  value,
  initialConfig,
  onChange,
  hideDefault = false,
  hideOrchestrator = false,
  description,
}) => {
  const personaIds = useMemo(() => Object.keys(advisors || {}), [advisors]);
  const isControlled = value !== undefined;

  const [internal, setInternal] = useState(() =>
    buildInitial(initialConfig, personaIds, availableBackends)
  );

  useEffect(() => {
    if (isControlled) return;
    setInternal(prev => {
      const next = { ...prev.persona_backends };
      let changed = false;
      const fallback = prev.default_backend || availableBackends[0] || 'gemini';
      for (const id of personaIds) {
        if (next[id] === undefined) {
          next[id] = fallback;
          changed = true;
        }
      }
      return changed ? { ...prev, persona_backends: next } : prev;
    });
  }, [personaIds, availableBackends, isControlled]);

  const config = isControlled ? value : internal;

  const update = (next) => {
    if (!isControlled) setInternal(next);
    if (onChange) onChange(next);
  };

  const setDefault = (val) => update({ ...config, default_backend: val });
  const setOrchestrator = (val) => update({ ...config, orchestrator_backend: val });
  const setPersona = (id, val) => update({
    ...config,
    persona_backends: { ...config.persona_backends, [id]: val },
  });

  return (
    <div>
      {description && (
        <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13.5 }}>
          {description}
        </p>
      )}

      {!hideDefault && (
        <div style={rowStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Default backend</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Used when no specific override is set.
            </div>
          </div>
          <select
            style={selectStyle}
            value={config.default_backend}
            onChange={(e) => setDefault(e.target.value)}
          >
            {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      {!hideOrchestrator && (
        <div style={rowStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Orchestrator</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Routes user input across advisors.
            </div>
          </div>
          <select
            style={selectStyle}
            value={config.orchestrator_backend}
            onChange={(e) => setOrchestrator(e.target.value)}
          >
            {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      {personaIds.map((id) => {
        const advisor = advisors[id];
        const locked = advisor?.backendLocked;
        const personaValue = locked && advisor?.defaultBackend
          ? advisor.defaultBackend
          : (config.persona_backends?.[id] || config.default_backend);
        return (
          <div style={rowStyle} key={id}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{advisor?.name || id}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {advisor?.role || id}{locked ? ' · backend locked' : ''}
              </div>
            </div>
            <select
              style={{ ...selectStyle, opacity: locked ? 0.6 : 1 }}
              value={personaValue}
              disabled={locked}
              onChange={(e) => setPersona(id, e.target.value)}
            >
              {availableBackends.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
};

export default AdvisorConfigPanel;
