import React from 'react';
import Icon from './Icon';

const TABS = [
  { id: 'insights', label: 'Insights', icon: 'Sparkles' },
  { id: 'workspace', label: 'Workspace', icon: 'LayoutDashboard' },
  { id: 'documents', label: 'Documents', icon: 'FileText' }
];

const SubTabs = ({ value, onChange }) => (
  <div className="canvas-subtabs" role="tablist">
    {TABS.map((t) => (
      <button
        key={t.id}
        role="tab"
        className={`canvas-subtab ${value === t.id ? 'active' : ''}`}
        onClick={() => onChange(t.id)}
      >
        <Icon name={t.icon} size={14} /> {t.label}
      </button>
    ))}
  </div>
);

export default SubTabs;
