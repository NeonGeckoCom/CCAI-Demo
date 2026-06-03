import React, { useState } from 'react';
import Icon from './Icon';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '../../data/canvasData';

/** Modal palette for adding widgets to the workspace. */
const WidgetPalette = ({ open, onClose, onAdd }) => {
  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');

  if (!open) return null;

  const filtered = WIDGET_CATALOG.filter((w) => {
    if (cat !== 'all' && w.cat !== cat) return false;
    if (search && !`${w.name} ${w.desc}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2>Add widgets</h2>
            <p>30+ widgets to build your research workspace. Pick a category or search.</p>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="X" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 14 }}>
            <div className="field-input">
              <span className="fi-icon"><Icon name="Search" size={14} /></span>
              <input
                placeholder="Search widgets…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="cat-chips">
            {WIDGET_CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`cat-chip ${cat === c.id ? 'active' : ''} ${c.critic ? 'critic' : ''}`}
                onClick={() => setCat(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="widget-palette-grid">
            {filtered.map((w) => (
              <button
                key={w.type}
                className={`widget-tile ${w.critic ? 'critic' : ''}`}
                onClick={() => { onAdd(w.type); onClose(); }}
              >
                <div className="wt-icon"><Icon name={w.icon} size={18} /></div>
                <div>
                  <div className="wt-name">{w.name}</div>
                  <div className="wt-desc">{w.desc}</div>
                </div>
                {w.stub && <span className="wt-stub">soon</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 13 }}>
                No widgets match "<strong>{search}</strong>" in <em>{cat}</em>.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WidgetPalette;
