import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import Widget from './Widget';
import { WIDGET_CATALOG, WORKSPACE_PRESETS, WORKSPACE_KEY } from '../../data/canvasData';

function loadWorkspace() {
  try { return JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '[]'); } catch (e) { return []; }
}
function saveWorkspace(layout) {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(layout)); } catch (e) { /* ignore */ }
}

/**
 * Workspace dashboard. Widget add / preset / clear are driven by window
 * CustomEvents so the parent's "Add widget" button (in the page header /
 * palette) can talk to this view without prop drilling.
 */
const WorkspaceView = ({ onOpenPalette }) => {
  const [layout, setLayout] = useState(loadWorkspace);

  useEffect(() => { saveWorkspace(layout); }, [layout]);

  useEffect(() => {
    const addHandler = (e) => {
      const type = e.detail?.type;
      if (!type) return;
      const widget = WIDGET_CATALOG.find((w) => w.type === type);
      if (!widget) return;
      setLayout((prev) => [...prev, { id: `w-${type}-${Date.now()}`, type, size: 'M' }]);
    };
    const presetHandler = (e) => {
      const preset = WORKSPACE_PRESETS.find((p) => p.id === e.detail?.id);
      if (!preset) return;
      setLayout(preset.layout.map((type, i) => ({ id: `w-${type}-${Date.now()}-${i}`, type, size: 'M' })));
    };
    const clearHandler = () => setLayout([]);
    window.addEventListener('workspace:add-widget', addHandler);
    window.addEventListener('workspace:apply-preset', presetHandler);
    window.addEventListener('workspace:clear', clearHandler);
    return () => {
      window.removeEventListener('workspace:add-widget', addHandler);
      window.removeEventListener('workspace:apply-preset', presetHandler);
      window.removeEventListener('workspace:clear', clearHandler);
    };
  }, []);

  const removeWidget = (id) => setLayout((prev) => prev.filter((w) => w.id !== id));
  const cycleSize = (id) => setLayout((prev) => prev.map((w) => (
    w.id === id ? { ...w, size: w.size === 'S' ? 'M' : w.size === 'M' ? 'L' : 'S' } : w
  )));

  if (layout.length === 0) {
    return (
      <>
        <div className="preset-empty">
          <h2>Your workspace is a blank canvas.</h2>
          <p>
            Pick a starter preset, or add widgets one-by-one from the palette. Everything saves locally — drag the widget header to reorder, click S/M/L to resize.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
            <button className="btn primary" onClick={onOpenPalette}>
              <Icon name="Plus" size={14} color="#fff" /> <span>Add a widget</span>
            </button>
            <button className="btn">
              <Icon name="Command" size={14} /> <span>⌘K to search</span>
            </button>
          </div>
        </div>
        <div className="docs-section-label" style={{ textAlign: 'center' }}>Or start with a preset</div>
        <div className="preset-grid">
          {WORKSPACE_PRESETS.map((p) => (
            <button
              key={p.id}
              className="preset-card"
              onClick={() => window.dispatchEvent(new CustomEvent('workspace:apply-preset', { detail: { id: p.id } }))}
            >
              <div className="pc-icon"><Icon name={p.icon} size={20} /></div>
              <h3>{p.name}</h3>
              <p>{p.desc}</p>
              <div className="pc-foot">
                <div className="pc-chips">
                  {p.layout.slice(0, 4).map((type, i) => {
                    const w = WIDGET_CATALOG.find((c) => c.type === type);
                    // eslint-disable-next-line react/no-array-index-key
                    return <span key={i} className="pc-chip">{w?.name || type}</span>;
                  })}
                  {p.layout.length > 4 && <span className="pc-chip">+{p.layout.length - 4}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="workspace-toolbar">
        <div className="wt-l">
          <strong style={{ color: 'var(--text-primary)', fontSize: 14 }}>{layout.length}</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}> widget{layout.length === 1 ? '' : 's'} in your workspace</span>
        </div>
        <div className="wt-r">
          <button className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent('workspace:clear'))}>
            <Icon name="Eraser" size={14} /> <span>Clear all</span>
          </button>
          <button className="btn primary" onClick={onOpenPalette}>
            <Icon name="Plus" size={14} color="#fff" /> <span>Add widget</span>
          </button>
        </div>
      </div>

      <div className="widget-grid">
        {layout.map((w) => {
          const def = WIDGET_CATALOG.find((d) => d.type === w.type);
          if (!def) return null;
          return (
            <Widget
              key={w.id}
              widget={w}
              def={def}
              onRemove={() => removeWidget(w.id)}
              onCycleSize={() => cycleSize(w.id)}
            />
          );
        })}
      </div>
    </>
  );
};

export default WorkspaceView;
