import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { DOC_TEMPLATES, SECTION_DEFINITIONS, DOCS_KEY } from '../../data/canvasData';

function loadDocs() {
  try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '{}'); } catch (e) { return { projects: {}, activeId: null }; }
}
function saveDocs(s) {
  try { localStorage.setItem(DOCS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

function sectionsFor(templateId) {
  if (SECTION_DEFINITIONS[templateId]) return SECTION_DEFINITIONS[templateId];
  const tpl = DOC_TEMPLATES.find((t) => t.id === templateId);
  const n = tpl?.sections || 4;
  return Array.from({ length: n }, (_, i) => ({
    id: `s-${i}`,
    name: `Section ${i + 1}`,
    target: 300,
    hint: 'Replace with section guidance from the production data.'
  }));
}

const wordCount = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;

const DocumentsPicker = ({ projects, onCreate, onOpen, onDelete }) => (
  <>
    <div className="docs-empty">
      <h2>Your deliverable center.</h2>
      <p>
        {projects.length > 0
          ? `${projects.length} draft${projects.length === 1 ? '' : 's'} in flight. Open one below, or pick a template to start a new draft.`
          : 'Drafts auto-save. Versions kept for rollback. Pick a template to start your first draft.'}
      </p>
    </div>

    {projects.length > 0 && (
      <>
        <div className="docs-section-label">Continue working</div>
        <div className="docs-grid">
          {projects.map((p) => {
            const tpl = DOC_TEMPLATES.find((t) => t.id === p.templateId);
            if (!tpl) return null;
            const wc = Object.values(p.sections || {}).reduce((sum, t) => sum + wordCount(t), 0);
            return (
              <div key={p.id} className="doc-card" onClick={() => onOpen(p.id)}>
                <div className="dc-icon"><Icon name={tpl.icon} size={18} /></div>
                <div className="dc-body">
                  <h3>{p.name}</h3>
                  <p>{tpl.name} · {wc} words</p>
                  <div className="dc-meta">opened {new Date(p.createdAt).toLocaleDateString()}</div>
                </div>
                <button
                  className="ih-pin"
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  title="Delete"
                >
                  <Icon name="Trash2" size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </>
    )}

    <div className="docs-section-label">
      {projects.length > 0 ? 'Or start a new draft' : 'Pick a template'}
    </div>
    <div className="docs-grid">
      {DOC_TEMPLATES.map((t) => (
        <button key={t.id} className="doc-card" onClick={() => onCreate(t.id)}>
          <div className="dc-icon"><Icon name={t.icon} size={18} /></div>
          <div className="dc-body">
            <h3>{t.name}</h3>
            <p>{t.desc}</p>
            <div className="dc-meta">{t.sections} sections · {t.mode}</div>
          </div>
        </button>
      ))}
    </div>
  </>
);

const DocumentEditor = ({ project, onClose, onDelete, onUpdate, projects, onSwitchProject }) => {
  const tpl = DOC_TEMPLATES.find((t) => t.id === project.templateId);
  const sections = sectionsFor(project.templateId);
  const [activeSecId, setActiveSecId] = useState(sections[0].id);

  const totalWords = sections.reduce((sum, s) => sum + wordCount(project.sections?.[s.id]), 0);
  const totalTarget = sections.reduce((sum, s) => sum + s.target, 0);

  const updateSection = (sid, value) => {
    onUpdate({ sections: { ...(project.sections || {}), [sid]: value } });
  };

  return (
    <>
      <div className="docs-tabs-row">
        {projects.map((p) => {
          const t = DOC_TEMPLATES.find((x) => x.id === p.templateId);
          return (
            <button
              key={p.id}
              className={`docs-tab ${p.id === project.id ? 'active' : ''}`}
              onClick={() => onSwitchProject(p.id)}
            >
              <Icon name={t?.icon || 'FileText'} size={12} />
              <span>{p.name}</span>
            </button>
          );
        })}
        <button className="docs-tab" onClick={onClose}>
          <Icon name="Plus" size={12} /> <span>All drafts</span>
        </button>
      </div>

      <div className="project-header">
        <div className="ph-top">
          <div>
            <input
              className="page-title-editable"
              value={project.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              style={{ background: 'transparent', border: 'none', font: 'inherit', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', padding: 0, marginBottom: 4, width: '100%', outline: 'none' }}
            />
            <div className="ph-meta">
              {tpl.name} · {totalWords} / {totalTarget} words · ~{Math.max(1, Math.round(totalWords / 220))} min read · {sections.length} sections
            </div>
          </div>
          <div className="ph-actions">
            <button className="btn ghost"><Icon name="Sparkles" size={14} /> <span>AI check</span></button>
            <button className="btn"><Icon name="History" size={14} /> <span>History</span></button>
            <button className="btn primary"><Icon name="Download" size={14} color="#fff" /> <span>Export</span></button>
            <button className="btn danger icon-only" onClick={onDelete} title="Delete"><Icon name="Trash2" size={14} /></button>
          </div>
        </div>
      </div>

      <div className="doc-editor">
        <aside className="doc-toc">
          <div className="doc-toc-label">On this page</div>
          {sections.map((s) => {
            const w = wordCount(project.sections?.[s.id]);
            return (
              <button
                key={s.id}
                className={`doc-toc-link ${activeSecId === s.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveSecId(s.id);
                  document.getElementById(`sec-${s.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
              >
                <span>{s.name}</span>
                {w > 0 && <span className="count">{w}</span>}
              </button>
            );
          })}
        </aside>
        <div className="doc-page">
          <h1>{project.name}</h1>
          <div className="doc-page-meta">
            {totalWords} words · ~{Math.max(1, Math.round(totalWords / 220))} min read · {sections.length} sections
          </div>
          {sections.map((s) => {
            const text = project.sections?.[s.id] || '';
            const w = wordCount(text);
            const passTarget = s.target > 0 && w >= s.target * 0.7;
            return (
              <section key={s.id} id={`sec-${s.id}`} className="doc-section">
                <h2>{s.name}</h2>
                <textarea
                  placeholder={s.hint}
                  value={text}
                  onChange={(e) => updateSection(s.id, e.target.value)}
                />
                <div className="check-row">
                  {s.target > 0 && (
                    <span className={`check-pill ${passTarget ? 'passed' : ''}`}>
                      {passTarget && <Icon name="Check" size={10} />} {w} / {s.target} words
                    </span>
                  )}
                  {/\d/.test(text) && <span className="check-pill passed"><Icon name="Check" size={10} /> Mentions a number</span>}
                  {/@\w+/.test(text) && <span className="check-pill passed"><Icon name="Check" size={10} /> Cites a source</span>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
};

const DocumentsView = () => {
  const [store, setStore] = useState(() => {
    const s = loadDocs();
    return s.projects ? s : { projects: {}, activeId: null };
  });
  useEffect(() => saveDocs(store), [store]);

  const projects = Object.values(store.projects || {});
  const active = store.activeId ? store.projects[store.activeId] : null;

  const createProject = (templateId) => {
    const id = `p-${Date.now()}`;
    const tpl = DOC_TEMPLATES.find((t) => t.id === templateId);
    setStore((s) => ({
      activeId: id,
      projects: {
        ...s.projects,
        [id]: { id, name: `${tpl.name} draft`, templateId, sections: {}, createdAt: Date.now() }
      }
    }));
  };
  const closeProject = () => setStore((s) => ({ ...s, activeId: null }));
  const switchProject = (id) => setStore((s) => ({ ...s, activeId: id }));
  const deleteProject = (id) => {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!window.confirm('Delete this draft?')) return;
    setStore((s) => {
      const { [id]: _removed, ...rest } = s.projects;
      return { activeId: s.activeId === id ? null : s.activeId, projects: rest };
    });
  };

  if (!active) {
    return (
      <DocumentsPicker
        projects={projects}
        onCreate={createProject}
        onOpen={switchProject}
        onDelete={deleteProject}
      />
    );
  }

  return (
    <DocumentEditor
      project={active}
      onClose={closeProject}
      onDelete={() => deleteProject(active.id)}
      onUpdate={(updates) => setStore((s) => ({
        ...s,
        projects: { ...s.projects, [active.id]: { ...s.projects[active.id], ...updates } }
      }))}
      projects={projects}
      onSwitchProject={switchProject}
    />
  );
};

export default DocumentsView;
