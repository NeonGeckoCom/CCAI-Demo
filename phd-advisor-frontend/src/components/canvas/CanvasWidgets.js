import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from './CanvasIcon';
import { MOD } from './platform';

const fireToast = (msg, kind = 'success') =>
  window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg, kind } }));
const fireActivity = (source, msg) =>
  window.dispatchEvent(new CustomEvent('canvas-activity', { detail: { source, msg } }));

// Shared empty-state block — every widget uses this so the look stays consistent.
function EmptyState({ icon = 'sparkles', title, hint, action }) {
  return (
    <div className="widget-empty">
      <div className="widget-empty-icon"><Icon name={icon} size={20}/></div>
      <div className="widget-empty-title">{title}</div>
      {hint && <div className="widget-empty-hint">{hint}</div>}
      {action && <div className="widget-empty-action">{action}</div>}
    </div>
  );
}

// Cross-widget drag-drop helpers — one mime type, JSON payload tagged by `kind`.
const X_MIME = 'application/x-canvas-item';
const setDragPayload = (e, kind, payload) => {
  e.dataTransfer.setData(X_MIME, JSON.stringify({ kind, payload }));
  e.dataTransfer.effectAllowed = 'copy';
};
const readDragPayload = (e) => {
  try { return JSON.parse(e.dataTransfer.getData(X_MIME)); } catch { return null; }
};

// ===== Bibliography =====
export function BibliographyWidget({ state, setState, openModal }) {
  const formats = ['APA', 'MLA', 'Chicago', 'BibTeX'];
  const fmt = state.format || 'APA';
  const [sortBy, setSortBy] = useState('year');
  const [dropOver, setDropOver] = useState(false);

  const onDrop = async (e) => {
    e.preventDefault();
    setDropOver(false);
    const data = readDragPayload(e);
    if (!data || data.kind !== 'paper') return;
    const p = data.payload;
    // If we have a DOI, hit CrossRef and build a real citation; else stub from title.
    const titleStr = p.title || 'Untitled';
    let entry = {
      key: 'cite' + Date.now(),
      authors: 'Unknown',
      title: titleStr.replace(/^.*?— /, ''),
      journal: '',
      year: new Date().getFullYear(),
      cited: 0,
      doi: p.doi || '',
    };
    if (p.doi) {
      try {
        const cleaned = p.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleaned)}`);
        if (res.ok) {
          const json = await res.json();
          const w = json.message;
          entry.authors = (w.author || []).map(a => `${a.family || ''}, ${(a.given || '').charAt(0)}.`).join('; ') || entry.authors;
          entry.title = (w.title && w.title[0]) || entry.title;
          entry.journal = (w['container-title'] && w['container-title'][0]) || '';
          entry.year = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0]) || entry.year;
          const firstAuthor = (entry.authors.split(',')[0] || 'cite').toLowerCase().replace(/[^a-z]/g, '');
          entry.key = firstAuthor + entry.year;
        }
      } catch { /* fall through with stub */ }
    }
    setState({ ...state, entries: [...state.entries, entry] });
    fireToast(`@${entry.key} added from Reading Queue`);
    fireActivity('Bibliography', `Added @${entry.key} (from Reading Queue)`);
  };

  const setFmt = (f) => setState({ ...state, format: f });

  const formatEntry = (e) => {
    if (fmt === 'APA') return `${e.authors} (${e.year}). ${e.title}. <em>${e.journal}</em>.`;
    if (fmt === 'MLA') return `${e.authors.split(',')[0]}, et al. "${e.title}." <em>${e.journal}</em>, ${e.year}.`;
    if (fmt === 'Chicago') return `${e.authors}. "${e.title}." <em>${e.journal}</em> (${e.year}).`;
    return `@article{${e.key},\n  author = {${e.authors}},\n  title = {${e.title}},\n  journal = {${e.journal}},\n  year = {${e.year}}\n}`;
  };

  const sorted = useMemo(() => {
    const arr = [...state.entries];
    if (sortBy === 'year') arr.sort((a, b) => b.year - a.year);
    if (sortBy === 'author') arr.sort((a, b) => a.authors.localeCompare(b.authors));
    if (sortBy === 'cited') arr.sort((a, b) => b.cited - a.cited);
    return arr;
  }, [state.entries, sortBy]);

  const copy = () => {
    const out = sorted.map(formatEntry).map(s => s.replace(/<[^>]+>/g, '')).join('\n\n');
    navigator.clipboard?.writeText(out);
    fireToast(`${sorted.length} citations copied as ${fmt}`);
  };

  const remove = (key) => {
    const e = state.entries.find(x => x.key === key);
    setState({ ...state, entries: state.entries.filter(x => x.key !== key) });
    fireToast(`Removed @${e.key}`);
  };

  const edit = (entry) => openModal('add-citation', {
    initial: entry,
    onAdd: (next) => setState({ ...state, entries: state.entries.map(e => e.key === entry.key ? next : e) }),
  });

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes(X_MIME)) { e.preventDefault(); setDropOver(true); } }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', flex: 1 }}
      className={dropOver ? 'canvas-drop-active' : ''}
    >
      {dropOver && (
        <div className="canvas-drop-overlay">
          <Icon name="plus" size={18}/>
          <span>Drop to add citation</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div className="format-tabs">
          {formats.map(f => (
            <button key={f} className={`format-tab ${fmt === f ? 'active' : ''}`} onClick={() => setFmt(f)}>{f}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 11, fontFamily: 'var(--canvas-mono)' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="year">↓ year</option>
            <option value="author">A–Z</option>
            <option value="cited">↓ cited</option>
          </select>
          <button className="icon-btn" onClick={copy} title="Copy all"><Icon name="copy" size={14}/></button>
          <button className="icon-btn" onClick={() => openModal('add-citation', { onAdd: (entry) => setState({ ...state, entries: [...state.entries, entry] }) })} title="Add"><Icon name="plus" size={14}/></button>
        </div>
      </div>
      <div className="bib-list">
        {sorted.map(e => (
          <div key={e.key} className="note-row" style={{ padding: '8px 10px' }}>
            <div className="bib-cite" style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: formatEntry(e) }}/>
            <div className="bib-meta">
              <span className="key">@{e.key}</span>
              <span>cited {e.cited.toLocaleString()}x</span>
            </div>
            <div className="row-actions">
              <button className="icon-btn" onClick={() => edit(e)} title="Edit"><Icon name="pencil" size={11}/></button>
              <button className="icon-btn" onClick={() => remove(e.key)} title="Delete"><Icon name="trash" size={11}/></button>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <EmptyState
            icon="book"
            title="No citations yet"
            hint="Add one with the + button, paste a DOI, or drag a paper here from the Reading Queue."
          />
        )}
      </div>
    </div>
  );
}

// ===== Kanban (with priority filter chips + due-date sort) =====
const PRI_RANK = { high: 0, med: 1, low: 2 };
export function KanbanWidget({ state, setState, openModal }) {
  const [dragId, setDragId] = useState(null);
  const [dragCol, setDragCol] = useState(null);
  const [editId, setEditId] = useState(null);
  const [priFilter, setPriFilter] = useState('all');
  const [sortBy, setSortBy] = useState('manual');

  const move = (id, toCol) => setState({ ...state, cards: state.cards.map(c => c.id === id ? { ...c, col: toCol } : c) });
  const remove = (id) => setState({ ...state, cards: state.cards.filter(c => c.id !== id) });
  const updateTitle = (id, title) => setState({ ...state, cards: state.cards.map(c => c.id === id ? { ...c, title } : c) });

  const addCard = (col) => openModal('add-task', {
    onAdd: (card) => setState({ ...state, cards: [...state.cards, { ...card, id: 'k' + Date.now(), col }] }),
  });

  const editCard = (card) => openModal('add-task', {
    initial: card,
    onAdd: (next) => setState({ ...state, cards: state.cards.map(c => c.id === card.id ? { ...c, ...next } : c) }),
  });

  const visibleCards = (state.cards || []).filter(c => priFilter === 'all' || c.priority === priFilter);
  const sortCards = (cards) => {
    if (sortBy === 'priority') return [...cards].sort((a, b) => (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9));
    if (sortBy === 'due') {
      const parseDue = (m) => {
        if (!m) return Infinity;
        const d = new Date(m);
        return isNaN(d) ? Infinity : d.getTime();
      };
      return [...cards].sort((a, b) => parseDue(a.meta) - parseDue(b.meta));
    }
    return cards;
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Filter</span>
        {[['all', 'All'], ['high', 'High'], ['med', 'Med'], ['low', 'Low']].map(([v, l]) => (
          <button key={v} className={`palette-cat ${priFilter === v ? 'active' : ''}`}
            onClick={() => setPriFilter(v)} style={{ padding: '3px 9px', fontSize: 11 }}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Sort</span>
        <select className="select" style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="manual">Manual</option>
          <option value="priority">Priority</option>
          <option value="due">Due date</option>
        </select>
      </div>
    <div className="kanban">
      {state.cols.map(col => {
        const cards = sortCards(visibleCards.filter(c => c.col === col.id));
        return (
          <div key={col.id}
            className={`kan-col ${dragCol === col.id ? 'drag-target' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragCol(col.id); }}
            onDragLeave={() => setDragCol(null)}
            onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, col.id); setDragCol(null); setDragId(null); }}>
            <div className="kan-col-head">
              <span>{col.label}</span>
              <span className="count">{cards.length}</span>
            </div>
            {cards.map(card => (
              <div key={card.id}
                className={`kan-card ${card.priority} ${dragId === card.id ? 'dragging' : ''}`}
                draggable={editId !== card.id}
                onDragStart={(e) => { setDragId(card.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragId(null); setDragCol(null); }}
                onDoubleClick={() => editCard(card)}>
                <span className="priority-bar"/>
                {editId === card.id ? (
                  <input
                    className="inline-input"
                    style={{ marginLeft: 6, width: 'calc(100% - 6px)' }}
                    autoFocus
                    defaultValue={card.title}
                    onBlur={(e) => { updateTitle(card.id, e.target.value); setEditId(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditId(null); }}
                  />
                ) : (
                  <div className="kan-title" onClick={() => setEditId(card.id)}>{card.title}</div>
                )}
                <div className="kan-meta">
                  <span>{card.priority.toUpperCase()}</span>
                  <span>·</span>
                  <span>{card.meta}</span>
                  <span style={{ flex: 1 }}/>
                  <button className="icon-btn" style={{ width: 16, height: 16, opacity: 0.5 }} onClick={(e) => { e.stopPropagation(); remove(card.id); }} title="Delete"><Icon name="x" size={10}/></button>
                </div>
              </div>
            ))}
            <button className="add-tiny" onClick={() => addCard(col.id)}>+ Add</button>
          </div>
        );
      })}
    </div>
    </>
  );
}

// ===== Pomodoro =====
export function PomodoroWidget({ state, setState }) {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState('focus');
  const [secs, setSecs] = useState(state.focus * 60);
  const [editing, setEditing] = useState(false);
  const total = (mode === 'focus' ? state.focus : state.brk) * 60;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          const next = mode === 'focus' ? 'break' : 'focus';
          setMode(next);
          if (mode === 'focus') {
            setState({ ...state, sessionsToday: state.sessionsToday + 1 });
            fireToast('Focus session complete — 5 min break');
          }
          return (next === 'focus' ? state.focus : state.brk) * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, mode, state, setState]);

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const r = 56, c = 2 * Math.PI * r;
  const dash = c * (1 - secs / total);
  const reset = () => { setRunning(false); setMode('focus'); setSecs(state.focus * 60); };

  return (
    <div className="pomo">
      <div className={`pomo-ring ${mode === 'break' ? 'break' : ''}`}>
        <svg width="130" height="130">
          <circle className="track" cx="65" cy="65" r={r} strokeWidth="6" fill="none"/>
          <circle className="fill" cx="65" cy="65" r={r} strokeWidth="6" fill="none" strokeDasharray={c} strokeDashoffset={dash}/>
        </svg>
        <div className="pomo-time">
          <div className="t">{mm}:{ss}</div>
          <div className="l">{mode === 'focus' ? 'focus' : 'break'}</div>
        </div>
      </div>
      <div className="pomo-controls">
        <button className="btn btn-primary" onClick={() => setRunning(r => !r)}>
          <Icon name={running ? 'pause' : 'play'} size={13}/>{running ? 'Pause' : 'Start'}
        </button>
        <button className="btn" onClick={reset} title="Reset"><Icon name="reset" size={13}/></button>
        <button className="btn" onClick={() => setEditing(e => !e)} title="Edit durations"><Icon name="settings" size={13}/></button>
      </div>
      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--canvas-text-3)' }}>
          <span>focus</span>
          <input type="number" min="1" max="90" className="input" style={{ width: 50, padding: '4px 6px', fontFamily: 'var(--canvas-mono)' }}
            value={state.focus} onChange={e => { const v = +e.target.value || 25; setState({ ...state, focus: v }); if (!running) setSecs(v*60); }}/>
          <span>break</span>
          <input type="number" min="1" max="30" className="input" style={{ width: 50, padding: '4px 6px', fontFamily: 'var(--canvas-mono)' }}
            value={state.brk} onChange={e => setState({ ...state, brk: +e.target.value || 5 })}/>
          <span>min</span>
        </div>
      ) : (
        <div className="pomo-stats">
          <span>today <b>{state.sessionsToday}</b></span><span>·</span>
          <span>{state.focus}/{state.brk} min</span>
        </div>
      )}
    </div>
  );
}

// ===== Writing tracker =====
// Inline writing pad with multi-chapter targets, live word count, and 28-day heatmap.
const todayKey = () => new Date().toISOString().slice(0, 10);
const countWords = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export function WritingWidget({ state, setState }) {
  const chapters = state.chapters || [];
  const activeId = state.activeChapterId || chapters[0]?.id;
  const active = chapters.find(c => c.id === activeId) || chapters[0];
  const dailyTotals = state.dailyTotals || {};
  const today = todayKey();
  const todayWords = dailyTotals[today] || 0;
  const target = active?.target ?? state.target ?? 500;
  const pct = target > 0 ? Math.min(100, Math.round((todayWords / target) * 100)) : 0;

  // Streak: count consecutive days back from today with words > 0
  const streak = (() => {
    let s = 0;
    const d = new Date();
    while (true) {
      const k = d.toISOString().slice(0, 10);
      if ((dailyTotals[k] || 0) > 0) { s++; d.setDate(d.getDate() - 1); } else break;
      if (s > 365) break;
    }
    return s;
  })();

  const updateChapter = (id, patch) => setState({
    ...state,
    chapters: chapters.map(c => c.id === id ? { ...c, ...patch } : c),
  });

  const onDraftChange = (text) => {
    const words = countWords(text);
    updateChapter(active.id, { draft: text });
    // Track per-day session word count keyed off the active chapter's last-saved baseline
    const sessionBaseline = active.savedAt === today ? (active.savedWords || 0) : 0;
    const delta = Math.max(0, words - sessionBaseline);
    setState({
      ...state,
      chapters: chapters.map(c => c.id === active.id ? { ...c, draft: text } : c),
      dailyTotals: { ...dailyTotals, [today]: (dailyTotals[today] || 0) - (state._sessionDelta || 0) + delta },
      _sessionDelta: delta,
    });
  };

  const saveSession = () => {
    const words = countWords(active.draft || '');
    setState({
      ...state,
      chapters: chapters.map(c => c.id === active.id ? { ...c, savedAt: today, savedWords: words } : c),
      _sessionDelta: 0,
    });
    fireToast(`Saved · ${words} words in ${active.name}`);
    fireActivity('Writing', `Saved ${words} words to "${active.name}"`);
  };

  const addChapter = () => {
    const id = 'c-' + Date.now();
    setState({
      ...state,
      chapters: [...chapters, { id, name: 'New chapter', target: 500, draft: '' }],
      activeChapterId: id,
    });
  };

  const deleteChapter = (id) => {
    if (chapters.length === 1) return fireToast('Need at least one chapter', 'danger');
    const next = chapters.filter(c => c.id !== id);
    setState({ ...state, chapters: next, activeChapterId: next[0].id });
  };

  // 28-day heatmap
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (27 - i));
    return d.toISOString().slice(0, 10);
  });
  const allCounts = Object.values(dailyTotals);
  const maxDay = Math.max(target, ...allCounts, 1);
  const intensity = (n) => {
    if (!n) return 0;
    const ratio = n / maxDay;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  };

  const draftWords = countWords(active?.draft || '');
  const totalWritten = chapters.reduce((sum, c) => sum + countWords(c.draft || ''), 0);
  const totalTarget = chapters.reduce((sum, c) => sum + (c.target || 0), 0);

  return (
    <>
      {/* Chapter switcher */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {chapters.map(c => (
          <button key={c.id}
            onClick={() => setState({ ...state, activeChapterId: c.id })}
            className={`format-tab ${c.id === active?.id ? 'active' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11, fontFamily: 'var(--canvas-sans)', textTransform: 'none', letterSpacing: 0 }}>
            {c.name}
          </button>
        ))}
        <button className="add-tiny" onClick={addChapter} style={{ padding: '4px 8px' }}>+ Chapter</button>
      </div>

      {/* Active chapter editing */}
      {active && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="inline-input"
              style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}
              value={active.name}
              onChange={e => updateChapter(active.id, { name: e.target.value })}
            />
            <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11, color: 'var(--canvas-text-3)' }}>target</span>
            <input
              type="number"
              className="inline-input"
              style={{ width: 70, fontFamily: 'var(--canvas-mono)' }}
              value={active.target ?? 500}
              onChange={e => updateChapter(active.id, { target: +e.target.value || 0 })}
            />
            {chapters.length > 1 && (
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => deleteChapter(active.id)} title="Delete chapter">
                <Icon name="trash" size={11}/>
              </button>
            )}
          </div>

          <textarea
            className="textarea"
            placeholder="Start writing here. Word count tracks live."
            style={{ minHeight: 110, fontFamily: 'var(--canvas-sans)', fontSize: 13, lineHeight: 1.55 }}
            value={active.draft || ''}
            onChange={e => onDraftChange(e.target.value)}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--canvas-mono)', fontSize: 11, color: 'var(--canvas-text-3)' }}>
            <span style={{ color: 'var(--canvas-accent)', fontWeight: 600 }}>{draftWords}</span>
            <span>/</span>
            <span>{active.target ?? 500} words</span>
            <div className="progress" style={{ flex: 1, height: 4 }}>
              <i style={{ width: Math.min(100, (draftWords / Math.max(1, active.target ?? 500)) * 100) + '%' }}/>
            </div>
            <button className="btn" style={{ padding: '4px 9px', fontSize: 11 }} onClick={saveSession}>
              <Icon name="check" size={11}/>Save session
            </button>
          </div>
        </>
      )}

      {/* Today/streak/total stats */}
      <div className="write-stats">
        <div className="stat">
          <div className="stat-label">Today</div>
          <div className="stat-value accent">{todayWords}</div>
          <div className="stat-sub">{pct}% of {target}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Streak</div>
          <div className="stat-value">{streak}<span style={{ fontSize: 13, color: 'var(--canvas-text-3)', marginLeft: 3 }}>d</span></div>
          <div className="stat-sub">days writing</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total</div>
          <div className="stat-value">{totalWritten}</div>
          <div className="stat-sub">/ {totalTarget} all chapters</div>
        </div>
      </div>

      {/* 28-day heatmap */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
          Last 28 days
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(28, 1fr)', gap: 2 }}>
          {days.map(d => {
            const n = dailyTotals[d] || 0;
            const lvl = intensity(n);
            const bg = ['var(--canvas-surface-2)', 'var(--canvas-accent-glow)', 'rgba(99,102,241,0.45)', 'rgba(99,102,241,0.7)', 'var(--canvas-accent)'][lvl];
            return (
              <div key={d}
                title={`${d}: ${n} words`}
                style={{ aspectRatio: '1', borderRadius: 2, background: bg, border: '1px solid var(--canvas-border)' }}/>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ===== Deadlines (with .ics calendar export) =====
const toICSDate = (d) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}T${z(d.getUTCHours())}${z(d.getUTCMinutes())}00Z`;
};
const downloadICS = (deadline) => {
  const start = new Date(deadline.date + 'T09:00:00Z');
  const end = new Date(deadline.date + 'T10:00:00Z');
  const escape = (s) => (s || '').replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Canvas//Deadlines//EN',
    'BEGIN:VEVENT',
    `UID:${deadline.id}@canvas`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escape(deadline.title)}`,
    `DESCRIPTION:Tag: ${escape(deadline.tag || '')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${deadline.title.replace(/[^\w\d-]/g, '_')}.ics`;
  a.click();
  fireToast(`Calendar event downloaded for "${deadline.title}"`);
};

export function DeadlinesWidget({ state, setState, openModal }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const enriched = state.map(d => {
    const date = new Date(d.date);
    const days = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    return { ...d, days, date };
  }).sort((a, b) => a.days - b.days);

  const remove = (id) => {
    const dl = state.find(x => x.id === id);
    setState(state.filter(x => x.id !== id));
    fireToast(`Removed "${dl.title}"`);
  };
  const edit = (dl) => openModal('add-deadline', {
    initial: dl,
    onAdd: (next) => setState(state.map(x => x.id === dl.id ? { ...x, ...next } : x)),
  });

  return (
    <>
      <div className="dl-list">
        {enriched.map(d => {
          const cls = d.days <= 7 ? 'urgent' : d.days <= 21 ? 'warn' : '';
          return (
            <div key={d.id} className="dl-row" style={{ position: 'relative' }}>
              <div className={`dl-day ${cls}`}>
                <span className="num">{d.days}</span>
                <span className="lbl">days</span>
              </div>
              <div className="dl-info">
                <div className="dl-title">{d.title}</div>
                <div className="dl-sub">{d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {d.tag}</div>
              </div>
              <div className="row-actions">
                <button className="icon-btn" onClick={() => downloadICS(d)} title="Add to calendar (.ics)"><Icon name="download" size={11}/></button>
                <button className="icon-btn" onClick={() => edit(d)} title="Edit"><Icon name="pencil" size={11}/></button>
                <button className="icon-btn" onClick={() => remove(d.id)} title="Delete"><Icon name="trash" size={11}/></button>
              </div>
            </div>
          );
        })}
        {enriched.length === 0 && (
          <EmptyState
            icon="calendar"
            title="No deadlines yet"
            hint="Track due dates and download them straight into your calendar as .ics files."
          />
        )}
      </div>
      <button className="add-tiny" onClick={() => openModal('add-deadline', {
        onAdd: (dl) => setState([...state, { ...dl, id: 'd' + Date.now() }]),
      })}>+ Add deadline</button>
    </>
  );
}

// ===== Budget =====
export function BudgetWidget({ state, setState, openModal }) {
  const total = state.items.reduce((a, b) => a + b.spent, 0);
  const pct = (total / state.cap) * 100;
  const [editingCap, setEditingCap] = useState(false);

  const editItem = (item, idx) => openModal('budget-item', {
    initial: item,
    onSave: (next) => setState({ ...state, items: state.items.map((x, i) => i === idx ? next : x) }),
    onDelete: () => setState({ ...state, items: state.items.filter((_, i) => i !== idx) }),
  });
  const addItem = () => openModal('budget-item', {
    onSave: (next) => setState({ ...state, items: [...state.items, next] }),
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>${total.toLocaleString()}</span>
          {editingCap ? (
            <input type="number" autoFocus className="inline-input" style={{ width: 80, marginLeft: 6, fontFamily: 'var(--canvas-mono)' }}
              defaultValue={state.cap}
              onBlur={(e) => { setState({ ...state, cap: +e.target.value || state.cap }); setEditingCap(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}/>
          ) : (
            <span onClick={() => setEditingCap(true)} style={{ color: 'var(--canvas-text-3)', fontFamily: 'var(--canvas-mono)', fontSize: 12, marginLeft: 4, cursor: 'pointer', textDecoration: 'underline dashed', textDecorationColor: 'var(--canvas-text-4)', textUnderlineOffset: 2 }}>/ ${state.cap.toLocaleString()}</span>
          )}
        </div>
        <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11, color: pct > 80 ? 'var(--canvas-warn)' : 'var(--canvas-text-3)' }}>{pct.toFixed(0)}% used</span>
      </div>
      <div className="budget-bar">
        {state.items.map(item => (
          <i key={item.label} style={{ background: item.color, width: (item.spent / state.cap * 100) + '%' }}/>
        ))}
      </div>
      <div className="budget-list">
        {state.items.map((item, i) => (
          <div key={item.label} className="budget-row" style={{ cursor: 'pointer' }} onClick={() => editItem(item, i)}>
            <span className="swatch" style={{ background: item.color }}/>
            <span>{item.label}</span>
            <span className="amt">${item.spent.toLocaleString()}</span>
            <span className="pct">{((item.spent/state.cap)*100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <button className="add-tiny" onClick={addItem}>+ Add category</button>
    </>
  );
}

// ===== Reading queue =====
export function ReadingQueueWidget({ state, setState, openModal }) {
  const colors = { high: 'var(--canvas-danger)', med: 'var(--canvas-warn)', low: 'var(--canvas-text-4)' };
  const remove = (i, p) => {
    setState(state.filter((_, j) => j !== i));
    fireToast(`Marked "${p.title.slice(0, 30)}…" as read`);
  };
  const add = () => openModal('reading-paper', { onAdd: (p) => setState([...state, p]) });
  const edit = (p, i) => openModal('reading-paper', {
    initial: p,
    onAdd: (next) => setState(state.map((x, j) => i === j ? next : x)),
  });

  return (
    <>
      <div className="dl-list">
        {state.map((p, i) => (
          <div key={i} className="dl-row"
            draggable
            onDragStart={(e) => setDragPayload(e, 'paper', p)}
            title="Drag to Bibliography to add as citation"
            style={{ padding: '7px 9px', position: 'relative', cursor: 'grab' }}>
            <span style={{ width: 4, height: 28, borderRadius: 2, background: colors[p.priority], flexShrink: 0 }}/>
            <div className="dl-info" onClick={() => edit(p, i)} style={{ cursor: 'pointer' }}>
              <div className="dl-title" style={{ fontSize: 12 }}>{p.title}</div>
              <div className="dl-sub">{p.priority} · ~{p.time}{p.doi ? ' · ' + p.doi : ''}</div>
            </div>
            <button className="icon-btn" style={{width:24,height:24}} title="Mark read" onClick={() => remove(i, p)}>
              <Icon name="check" size={13}/>
            </button>
          </div>
        ))}
      </div>
      <button className="add-tiny" onClick={add}>+ Add paper</button>
    </>
  );
}

// ===== Notes / Scratchpad — Markdown rendering + full-text search =====
export function NotesWidget({ state, setState, openModal }) {
  const notes = state.items || [];
  const [search, setSearch] = useState('');
  const add = () => openModal('note', { onSave: (n) => setState({ ...state, items: [{ ...n, id: 'n' + Date.now(), at: Date.now() }, ...notes] }) });
  const edit = (note) => openModal('note', {
    initial: note,
    onSave: (next) => setState({ ...state, items: notes.map(x => x.id === note.id ? { ...x, ...next, at: Date.now() } : x) }),
    onDelete: () => setState({ ...state, items: notes.filter(x => x.id !== note.id) }),
  });

  const fmt = (t) => {
    const d = Date.now() - t;
    if (d < 60_000) return 'just now';
    if (d < 3600_000) return Math.floor(d / 60_000) + 'm';
    if (d < 86400_000) return Math.floor(d / 3600_000) + 'h';
    return Math.floor(d / 86400_000) + 'd';
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(n =>
      (n.text || '').toLowerCase().includes(q) ||
      (n.tag || '').toLowerCase().includes(q) ||
      (n.linkTo || '').toLowerCase().includes(q)
    );
  }, [notes, search]);

  return (
    <>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--canvas-text-3)' }}>
          <Icon name="search" size={12}/>
        </span>
        <input
          className="input"
          placeholder="Search notes (text, tag, link)…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 28, fontSize: 12 }}
        />
      </div>
      <div className="note-list">
        {filtered.map(n => (
          <div key={n.id} className="note-row" onClick={() => edit(n)} style={{ cursor: 'pointer' }}>
            <div className="note-text canvas-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.text || ''}</ReactMarkdown>
            </div>
            <div className="note-meta">
              {n.tag && <span className="tag-pill">{n.tag}</span>}
              <span>{fmt(n.at)}</span>
              {n.linkTo && <span>→ {n.linkTo}</span>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          notes.length === 0 ? (
            <EmptyState icon="notes" title="No notes yet" hint="Capture quick thoughts. Markdown supported. Type @ to mention citations, chapters, or tasks."/>
          ) : (
            <EmptyState icon="search" title={`No notes match "${search}"`} hint="Try a shorter query or clear the search box."/>
          )
        )}
      </div>
      <button className="add-tiny" onClick={add}>+ New note</button>
    </>
  );
}

// ===== Habit tracker =====
export function HabitsWidget({ state, setState, openModal }) {
  const habits = state.items || [];
  const days = 7;
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const toggle = (id, day) => {
    setState({
      ...state,
      items: habits.map(h => h.id === id
        ? { ...h, log: { ...h.log, [day]: !h.log?.[day] } }
        : h),
    });
  };
  const add = () => openModal('habit', { onSave: (h) => setState({ ...state, items: [...habits, { ...h, id: 'h' + Date.now(), log: {} }] }) });
  const edit = (h) => openModal('habit', {
    initial: h,
    onSave: (next) => setState({ ...state, items: habits.map(x => x.id === h.id ? { ...x, ...next } : x) }),
    onDelete: () => setState({ ...state, items: habits.filter(x => x.id !== h.id) }),
  });

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(7, 22px)', gap: 4, fontSize: 9.5, color: 'var(--canvas-text-4)', fontFamily: 'var(--canvas-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 2px' }}>
          <span/>
          {dayLabels.map((d, i) => <span key={i} style={{ textAlign: 'center' }}>{d}</span>)}
        </div>
        {habits.map(h => {
          const checked = Array.from({length: days}, (_, i) => h.log?.[i]).filter(Boolean).length;
          return (
            <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr repeat(7, 22px)', gap: 4, alignItems: 'center' }}>
              <div onClick={() => edit(h)} style={{ cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={h.icon || 'flame'} size={12} style={{ color: 'var(--canvas-accent)' }}/>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
                <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 9.5, color: 'var(--canvas-text-3)' }}>{checked}/{days}</span>
              </div>
              {Array.from({length: days}).map((_, i) => (
                <button key={i}
                  onClick={() => toggle(h.id, i)}
                  style={{
                    width: 20, height: 20, borderRadius: 4,
                    background: h.log?.[i] ? 'var(--canvas-accent)' : 'var(--canvas-surface-2)',
                    border: `1px solid ${h.log?.[i] ? 'var(--canvas-accent)' : 'var(--canvas-border)'}`,
                    color: h.log?.[i] ? 'var(--canvas-bg)' : 'transparent',
                    display: 'grid', placeItems: 'center', cursor: 'pointer',
                    transition: 'all .12s',
                  }}>
                  {h.log?.[i] && <Icon name="check" size={10}/>}
                </button>
              ))}
            </div>
          );
        })}
        {habits.length === 0 && (
          <EmptyState icon="flame" title="No habits yet" hint="Track daily research practices. Read 1 paper, write 30 min, lab notebook entry."/>
        )}
      </div>
      <button className="add-tiny" onClick={add}>+ New habit</button>
    </>
  );
}

// ===== Goals =====
export function GoalsWidget({ state, setState, openModal }) {
  const goals = state.items || [];
  const add = () => openModal('goal', { onSave: (g) => setState({ ...state, items: [...goals, { ...g, id: 'g' + Date.now() }] }) });
  const edit = (g) => openModal('goal', {
    initial: g,
    onSave: (next) => setState({ ...state, items: goals.map(x => x.id === g.id ? { ...x, ...next } : x) }),
    onDelete: () => setState({ ...state, items: goals.filter(x => x.id !== g.id) }),
  });
  const updateProgress = (id, pct) => setState({ ...state, items: goals.map(g => g.id === id ? { ...g, progress: pct } : g) });

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {goals.map(g => (
          <div key={g.id} className="note-row" style={{ padding: '10px 12px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => edit(g)}>
              <Icon name="bullseye" size={13} style={{ color: 'var(--canvas-accent)' }}/>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{g.label}</span>
              <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11, color: 'var(--canvas-accent)' }}>{g.progress}%</span>
            </div>
            <div className="progress" style={{ height: 5, marginTop: 2 }}>
              <i style={{ width: g.progress + '%' }}/>
            </div>
            <input type="range" min="0" max="100" step="5" value={g.progress}
              onChange={e => updateProgress(g.id, +e.target.value)}
              style={{ width: '100%', accentColor: 'var(--canvas-accent)', marginTop: 2, height: 12 }}/>
            {g.due && <div className="note-meta"><span>due {g.due}</span></div>}
          </div>
        ))}
        {goals.length === 0 && (
          <EmptyState icon="bullseye" title="No goals yet" hint="Quarterly OKRs, dissertation milestones, anything you want to track."/>
        )}
      </div>
      <button className="add-tiny" onClick={add}>+ New goal</button>
    </>
  );
}

// ===== Meeting log =====
export function MeetingsWidget({ state, setState, openModal }) {
  const meetings = state.items || [];
  const add = () => openModal('meeting', { onSave: (m) => setState({ ...state, items: [{ ...m, id: 'm' + Date.now() }, ...meetings] }) });
  const edit = (m) => openModal('meeting', {
    initial: m,
    onSave: (next) => setState({ ...state, items: meetings.map(x => x.id === m.id ? { ...x, ...next } : x) }),
    onDelete: () => setState({ ...state, items: meetings.filter(x => x.id !== m.id) }),
  });

  return (
    <>
      <div className="note-list">
        {meetings.map(m => (
          <div key={m.id} className="note-row" onClick={() => edit(m)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="user" size={12} style={{ color: 'var(--canvas-accent)' }}/>
              <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{m.who}</span>
              <span className="note-meta"><span>{m.date}</span></span>
            </div>
            {m.notes && <div className="note-text" style={{ fontSize: 12, color: 'var(--canvas-text-2)' }}>{m.notes}</div>}
            {m.actions && <div className="note-meta"><span className="tag-pill">{(m.actions.match(/\n/g)?.length ?? 0) + 1} action(s)</span></div>}
          </div>
        ))}
        {meetings.length === 0 && (
          <EmptyState icon="message" title="No meetings logged" hint="Capture decisions, action items, and last contact for each stakeholder."/>
        )}
      </div>
      <button className="add-tiny" onClick={add}>+ Log meeting</button>
    </>
  );
}

// ===== Outline Builder — nested collapsible tree, drag-reorder, indent/outdent =====
export function OutlineWidget({ state, setState }) {
  const items = state.items || [];
  const expanded = state.expanded || {};
  const [editingId, setEditingId] = useState(null);

  const toggle = (id) => setState({ ...state, expanded: { ...expanded, [id]: !expanded[id] } });
  const update = (id, patch) => setState({
    ...state,
    items: items.map(it => it.id === id ? { ...it, ...patch } : it),
  });
  const addItem = (afterId, depth = 0) => {
    const id = 'o' + Date.now();
    const idx = afterId ? items.findIndex(it => it.id === afterId) : items.length - 1;
    const next = [...items];
    next.splice(idx + 1, 0, { id, text: '', depth });
    setState({ ...state, items: next });
    setTimeout(() => setEditingId(id), 0);
  };
  const remove = (id) => setState({ ...state, items: items.filter(it => it.id !== id) });
  const indent = (id) => {
    const idx = items.findIndex(it => it.id === id);
    if (idx <= 0) return;
    const max = items[idx - 1].depth + 1;
    if (items[idx].depth >= max) return;
    update(id, { depth: items[idx].depth + 1 });
  };
  const outdent = (id) => {
    const it = items.find(x => x.id === id);
    if (!it || it.depth === 0) return;
    update(id, { depth: it.depth - 1 });
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.length === 0 ? (
          <EmptyState icon="list" title="Empty outline" hint="Click + Node below. Use Tab/Shift+Tab to indent, Enter for a sibling."/>
        ) : items.map((it, i) => {
          const hasChildren = items[i + 1] && items[i + 1].depth > it.depth;
          const isCollapsed = !!expanded[it.id] && hasChildren;
          // Hide rows that are descendants of a collapsed node
          let parentCollapsed = false;
          for (let j = i - 1; j >= 0; j--) {
            if (items[j].depth < it.depth) {
              if (expanded[items[j].id] && hasDescendantsAt(items, j, items[j].depth)) { parentCollapsed = true; break; }
            }
            if (items[j].depth === 0) break;
          }
          if (parentCollapsed) return null;
          return (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              paddingLeft: it.depth * 18,
              fontSize: 13, lineHeight: 1.5,
            }}>
              <button className="icon-btn" style={{ width: 18, height: 18 }}
                onClick={() => hasChildren && toggle(it.id)}
                title={hasChildren ? (isCollapsed ? 'Expand' : 'Collapse') : ''}>
                {hasChildren ? (
                  <Icon name="chevron" size={11} style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }}/>
                ) : <span style={{ color: 'var(--canvas-text-4)', fontSize: 8 }}>•</span>}
              </button>
              {editingId === it.id ? (
                <input
                  className="inline-input"
                  autoFocus
                  defaultValue={it.text}
                  onBlur={(e) => { update(it.id, { text: e.target.value }); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); addItem(it.id, it.depth); }
                    if (e.key === 'Escape') setEditingId(null);
                    if (e.key === 'Tab') { e.preventDefault(); update(it.id, { text: e.target.value }); e.shiftKey ? outdent(it.id) : indent(it.id); }
                  }}
                />
              ) : (
                <span onClick={() => setEditingId(it.id)} style={{ flex: 1, cursor: 'text', color: it.text ? 'var(--canvas-text)' : 'var(--canvas-text-4)' }}>
                  {it.text || 'Click to edit'}
                </span>
              )}
              <button className="icon-btn" style={{ width: 18, height: 18, opacity: 0.5 }} onClick={() => remove(it.id)}>
                <Icon name="x" size={10}/>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 4, fontSize: 11, color: 'var(--canvas-text-3)' }}>
        <button className="add-tiny" onClick={() => addItem(items[items.length - 1]?.id, 0)}>+ Node</button>
        <span style={{ color: 'var(--canvas-text-4)', fontFamily: 'var(--canvas-mono)' }}>· Tab/Shift+Tab to indent · Enter to add sibling</span>
      </div>
    </>
  );
}
function hasDescendantsAt(items, idx, depth) {
  return items[idx + 1] && items[idx + 1].depth > depth;
}

// ===== Highlights & Quotes — paste a quote, attach citation, copy formatted =====
export function HighlightsWidget({ state, setState }) {
  const items = state.items || [];
  const [text, setText] = useState('');
  const [citeKey, setCiteKey] = useState('');
  const [page, setPage] = useState('');

  const add = () => {
    if (!text.trim()) return;
    const id = 'q' + Date.now();
    setState({ ...state, items: [{ id, text: text.trim(), citeKey: citeKey.trim(), page: page.trim(), at: Date.now() }, ...items] });
    setText(''); setCiteKey(''); setPage('');
    fireToast('Quote saved');
  };

  const copy = (q) => {
    const formatted = `"${q.text}" (${q.citeKey || 'unknown'}${q.page ? ', p. ' + q.page : ''})`;
    navigator.clipboard?.writeText(formatted);
    fireToast('Copied to clipboard');
  };

  const remove = (id) => setState({ ...state, items: items.filter(x => x.id !== id) });

  return (
    <>
      <div className="form-grid">
        <textarea
          className="textarea"
          placeholder="Paste a quote or excerpt…"
          rows={3}
          style={{ minHeight: 60, fontSize: 12.5 }}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" placeholder="@citeKey" value={citeKey} onChange={e => setCiteKey(e.target.value)} style={{ flex: 1, fontFamily: 'var(--canvas-mono)' }}/>
          <input className="input" placeholder="page" value={page} onChange={e => setPage(e.target.value)} style={{ width: 60, fontFamily: 'var(--canvas-mono)' }}/>
          <button className="btn btn-primary" onClick={add} disabled={!text.trim()}>
            <Icon name="plus" size={13}/>Add
          </button>
        </div>
      </div>
      <div className="note-list">
        {items.map(q => (
          <div key={q.id} className="note-row">
            <div className="note-text" style={{ fontStyle: 'italic' }}>"{q.text}"</div>
            <div className="note-meta">
              {q.citeKey && <span className="tag-pill">@{q.citeKey}</span>}
              {q.page && <span>p. {q.page}</span>}
              <span style={{ flex: 1 }}/>
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => copy(q)} title="Copy formatted"><Icon name="copy" size={11}/></button>
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => remove(q.id)} title="Delete"><Icon name="trash" size={11}/></button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <EmptyState icon="cite" title="No quotes yet" hint="Paste a quote above with citation key and page; copy formatted with one click."/>
        )}
      </div>
    </>
  );
}

// ===== LaTeX Scratchpad — live KaTeX rendering (loaded from CDN) =====
const KATEX_CDN_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
const KATEX_CDN_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
let katexLoadingPromise = null;
const ensureKatex = () => {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoadingPromise) return katexLoadingPromise;
  katexLoadingPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = KATEX_CDN_CSS;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = KATEX_CDN_JS;
    script.onload = () => resolve(window.katex);
    script.onerror = () => reject(new Error('KaTeX CDN failed to load'));
    document.head.appendChild(script);
  });
  return katexLoadingPromise;
};

export function LatexWidget({ state, setState }) {
  const source = state.source ?? '';
  const displayMode = state.displayMode ?? true;
  const containerRef = useRef(null);
  const [error, setError] = useState('');
  const [katexReady, setKatexReady] = useState(!!window.katex);

  useEffect(() => {
    ensureKatex().then(() => setKatexReady(true)).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!katexReady || !containerRef.current) return;
    try {
      window.katex.render(source || '\\text{Type LaTeX above…}', containerRef.current, {
        displayMode,
        throwOnError: false,
        errorColor: '#DC2626',
      });
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [source, displayMode, katexReady]);

  const insertSnippet = (snippet) => {
    setState({ ...state, source: (source || '') + snippet });
  };

  const copyOut = () => {
    navigator.clipboard?.writeText(source);
    fireToast('LaTeX copied');
  };

  return (
    <>
      <textarea
        className="textarea"
        placeholder="\frac{1}{n}\sum_{i=1}^{n} x_i"
        style={{ minHeight: 70, fontFamily: 'var(--canvas-mono)', fontSize: 12.5 }}
        value={source}
        onChange={e => setState({ ...state, source: e.target.value })}
      />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ color: 'var(--canvas-text-4)', fontFamily: 'var(--canvas-mono)' }}>insert:</span>
        {[
          ['frac', '\\frac{a}{b}'],
          ['sum', '\\sum_{i=1}^{n}'],
          ['int', '\\int_{a}^{b}'],
          ['sqrt', '\\sqrt{x}'],
          ['vec', '\\vec{x}'],
          ['α', '\\alpha'],
          ['β', '\\beta'],
          ['Σ', '\\Sigma'],
        ].map(([label, snip]) => (
          <button key={label} className="chip" onClick={() => insertSnippet(snip)}>{label}</button>
        ))}
        <span style={{ flex: 1 }}/>
        <button className="chip" onClick={() => setState({ ...state, displayMode: !displayMode })}>
          {displayMode ? 'inline' : 'display'}
        </button>
        <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={copyOut} title="Copy LaTeX source">
          <Icon name="copy" size={11}/>
        </button>
      </div>
      <div
        style={{
          background: 'var(--canvas-bg-2)',
          border: '1px solid var(--canvas-border)',
          borderRadius: 7,
          padding: 14,
          minHeight: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--canvas-text)',
          overflowX: 'auto',
        }}
      >
        {!katexReady && !error && <span className="spinner"/>}
        {error && <span style={{ fontSize: 11, color: 'var(--canvas-danger)', fontFamily: 'var(--canvas-mono)' }}>{error}</span>}
        <div ref={containerRef} style={{ width: '100%', textAlign: 'center' }}/>
      </div>
    </>
  );
}

// ===== Calendar — month grid with deadlines (red) and writing days (green) =====
export function CalendarWidget({ state, setState, allStates = {} }) {
  const monthStr = state.viewMonth || new Date().toISOString().slice(0, 7);
  const [year, month] = monthStr.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay(); // Sunday-indexed
  const daysInMonth = new Date(year, month, 0).getDate();

  // Source data from cross-widget state
  const deadlines = (allStates.deadlines || []).reduce((m, d) => {
    const k = d.date.slice(0, 10);
    (m[k] ||= []).push({ kind: 'deadline', ...d });
    return m;
  }, {});
  const writing = ((allStates.writing && allStates.writing.dailyTotals) || {});
  const kanbanCards = (allStates.kanban && allStates.kanban.cards) || [];

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ d, dateStr });
  }
  while (cells.length % 7) cells.push(null);

  const shiftMonth = (delta) => {
    const next = new Date(year, month - 1 + delta, 1);
    setState({ ...state, viewMonth: next.toISOString().slice(0, 7) });
  };
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  const goToToday = () => setState({ ...state, viewMonth: new Date().toISOString().slice(0, 7) });
  const isCurrentMonth = monthStr === new Date().toISOString().slice(0, 7);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="icon-btn" onClick={() => shiftMonth(-1)} title="Previous month"><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }}/></button>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{monthLabel}</div>
        {!isCurrentMonth && (
          <button className="chip" onClick={goToToday} title="Jump to today" style={{ fontSize: 10.5 }}>Today</button>
        )}
        <button className="icon-btn" onClick={() => shiftMonth(1)} title="Next month"><Icon name="chevron" size={14}/></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, fontSize: 10, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', fontFamily: 'var(--canvas-mono)' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells.map((c, i) => {
          if (!c) return <div key={i} style={{ aspectRatio: '1' }}/>;
          const dls = deadlines[c.dateStr] || [];
          const words = writing[c.dateStr] || 0;
          const dueCards = kanbanCards.filter(card => (card.meta || '').includes(c.dateStr));
          const isToday = c.dateStr === today;
          return (
            <div key={i}
              title={[
                ...dls.map(d => `Deadline: ${d.title}`),
                ...(words ? [`${words} words written`] : []),
                ...dueCards.map(d => `Task: ${d.title}`),
              ].join('\n') || c.dateStr}
              style={{
                aspectRatio: '1',
                border: `1px solid ${isToday ? 'var(--canvas-accent)' : 'var(--canvas-border)'}`,
                background: isToday ? 'var(--canvas-accent-glow)' : 'var(--canvas-bg-2)',
                borderRadius: 4,
                padding: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                fontSize: 10,
                position: 'relative',
              }}
            >
              <span style={{ fontFamily: 'var(--canvas-mono)', color: isToday ? 'var(--canvas-accent)' : 'var(--canvas-text-2)', fontWeight: isToday ? 700 : 500 }}>
                {c.d}
              </span>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 'auto' }}>
                {dls.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--canvas-danger)' }}/>}
                {words > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--canvas-ok)' }}/>}
                {dueCards.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--canvas-warn)' }}/>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--canvas-text-3)', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--canvas-danger)', marginRight: 4 }}/>Deadlines</span>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--canvas-ok)', marginRight: 4 }}/>Writing</span>
        <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--canvas-warn)', marginRight: 4 }}/>Tasks</span>
      </div>
    </>
  );
}

// ===== Activity Feed — surfaces recent edits across all widgets =====
// Activity entries are written by other widgets via window.dispatchEvent('canvas-activity').
// We persist a rolling buffer of the last 100 events in this widget's own state.
export function ActivityWidget({ state, setState }) {
  const events = state.events || [];
  useEffect(() => {
    const handler = (e) => {
      const entry = { id: 'a' + Date.now() + Math.random(), at: Date.now(), ...e.detail };
      setState(prev => {
        const next = { ...(prev || {}), events: [entry, ...((prev && prev.events) || [])].slice(0, 100) };
        return next;
      });
    };
    window.addEventListener('canvas-activity', handler);
    return () => window.removeEventListener('canvas-activity', handler);
    // setState ref is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (t) => {
    const d = Date.now() - t;
    if (d < 60_000) return 'just now';
    if (d < 3600_000) return Math.floor(d / 60_000) + 'm ago';
    if (d < 86400_000) return Math.floor(d / 3600_000) + 'h ago';
    return Math.floor(d / 86400_000) + 'd ago';
  };

  return (
    <>
      <div className="note-list">
        {events.length === 0 && (
          <EmptyState icon="graph" title="No activity yet" hint="Edits across your widgets will show up here as you work."/>
        )}
        {events.map(e => (
          <div key={e.id} className="note-row" style={{ padding: '7px 9px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="tag-pill">{e.source}</span>
              <span style={{ fontSize: 12, flex: 1 }}>{e.msg}</span>
              <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 10, color: 'var(--canvas-text-3)' }}>{fmt(e.at)}</span>
            </div>
          </div>
        ))}
      </div>
      {events.length > 0 && (
        <button className="add-tiny" onClick={() => setState({ ...state, events: [] })}>Clear feed</button>
      )}
    </>
  );
}

// ===== Daily Documenter — date-stamped journal with stub AI weekly summary =====
export function DocumenterWidget({ state, setState }) {
  const entries = state.entries || [];
  const [draft, setDraft] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [generating, setGenerating] = useState(false);

  const append = () => {
    if (!draft.trim()) return;
    const entry = { id: 'doc' + Date.now(), date: today, text: draft.trim(), at: Date.now() };
    setState({ ...state, entries: [entry, ...entries] });
    setDraft('');
    window.dispatchEvent(new CustomEvent('canvas-activity', {
      detail: { source: 'Documenter', msg: `Logged: ${draft.trim().slice(0, 50)}…` },
    }));
    fireToast('Entry saved');
  };

  const remove = (id) => setState({ ...state, entries: entries.filter(e => e.id !== id) });

  // TODO(LLM): wire to /api/summarize-week with last 7 days of entries.
  // Backend call shape (commented because endpoint isn't ready):
  // const generateSummary = async () => {
  //   const last7 = entries.filter(e => Date.now() - e.at < 7*86400_000);
  //   const res = await fetch(`${process.env.REACT_APP_API_URL}/api/canvas/summarize`, {
  //     method: 'POST',
  //     body: JSON.stringify({ entries: last7 }),
  //   });
  //   const { summary } = await res.json();
  //   setState({ ...state, lastSummary: { at: Date.now(), text: summary } });
  // };
  const generateSummary = () => {
    // Stub: echo back a structured summary built from the local entries so the UI
    // shape is real even though no LLM is hooked up yet.
    setGenerating(true);
    setTimeout(() => {
      const last7 = entries.filter(e => Date.now() - e.at < 7 * 86400_000);
      const text = last7.length === 0
        ? 'No entries in the last 7 days.'
        : `**This week** · ${last7.length} entries logged.\n\n` +
          '_LLM summary will replace this once the backend endpoint is wired._\n\n' +
          last7.slice(0, 3).map(e => `- ${e.date}: ${e.text.slice(0, 80)}${e.text.length > 80 ? '…' : ''}`).join('\n');
      setState({ ...state, lastSummary: { at: Date.now(), text } });
      setGenerating(false);
      fireToast('Weekly summary generated (stub)');
    }, 600);
  };

  // Group entries by date
  const grouped = entries.reduce((m, e) => { (m[e.date] ||= []).push(e); return m; }, {});
  const dates = Object.keys(grouped).sort().reverse();

  return (
    <>
      <div className="form-grid">
        <textarea
          className="textarea"
          placeholder={`What did you do today? (${today})`}
          rows={3}
          style={{ minHeight: 50, fontSize: 12.5 }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) append(); }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-primary" onClick={append} disabled={!draft.trim()}>
            <Icon name="plus" size={13}/>Log entry
          </button>
          <button className="btn" onClick={generateSummary} disabled={entries.length === 0 || generating}>
            {generating ? <><div className="spinner"/>Summarizing</> : <><Icon name="sparkles" size={13}/>Weekly summary</>}
          </button>
        </div>
      </div>
      {state.lastSummary && (
        <div className="review" style={{ borderLeftColor: 'var(--canvas-accent)' }}>
          <span className="review-tag" style={{ color: 'var(--canvas-accent)' }}>
            Generated {new Date(state.lastSummary.at).toLocaleString()} · stub
          </span>
          <div className="canvas-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.lastSummary.text}</ReactMarkdown>
          </div>
        </div>
      )}
      <div className="note-list" style={{ maxHeight: 260 }}>
        {dates.map(date => (
          <div key={date}>
            <div style={{ fontSize: 10, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontFamily: 'var(--canvas-mono)', padding: '6px 2px 2px' }}>
              {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            {grouped[date].map(e => (
              <div key={e.id} className="note-row" style={{ position: 'relative' }}>
                <div className="note-text">{e.text}</div>
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => remove(e.id)}><Icon name="trash" size={11}/></button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {entries.length === 0 && (
          <EmptyState icon="pencil" title="No entries yet" hint={`Drop a line about today. Hit ${MOD}+↵ to log it. Tap Weekly summary anytime.`}/>
        )}
      </div>
    </>
  );
}

// ===== PhD Journey — standard milestones with status + notes =====
// Captures the "General Journey" list: courses, prelim, lit review, IRB,
// committee, topic, comps, defense, ProQuest. Each milestone has a status
// (open/in-progress/completed) and an inline note.
const PHD_MILESTONES = [
  { id: 'courses', label: 'Course selection & dissertation credits', hint: 'Plan term-by-term. Check funding constraints.' },
  { id: 'prelim', label: 'Preliminary exam', hint: 'Department format varies — consult your handbook.' },
  { id: 'lit-review', label: 'Literature review', hint: 'Coverage + critique. Bibliography widget pairs well here.' },
  { id: 'topic', label: 'Pick dissertation topic', hint: 'Narrow until your advisor pushes back.' },
  { id: 'committee', label: 'Select committee', hint: 'Pros/cons of a co-chair: more buy-in, more scheduling.' },
  { id: 'irb', label: 'IRB approval', hint: 'Allow 6–12 weeks. Pre-fill paperwork early.' },
  { id: 'data', label: 'Data collection', hint: 'Pilot first. Plan for the inevitable instrument failure.' },
  { id: 'comps', label: 'Comprehensive exam', hint: 'Department format varies.' },
  { id: 'analysis', label: 'Data analysis & visualization', hint: 'Make the figures before the prose.' },
  { id: 'writing', label: 'Write dissertation', hint: 'One chapter at a time. Aim for "good enough to defend".' },
  { id: 'defense', label: 'Oral defense', hint: 'Slides + practice Q&A. Use the Defense Slides template.' },
  { id: 'proquest', label: 'Final admin (ProQuest upload)', hint: 'Read the formatting checklist before you start formatting.' },
];

export function PhdJourneyWidget({ state, setState }) {
  const statuses = state.statuses || {};
  const notes = state.notes || {};
  const [editingId, setEditingId] = useState(null);
  const completed = PHD_MILESTONES.filter(m => statuses[m.id] === 'completed').length;
  const total = PHD_MILESTONES.length;
  const pct = Math.round((completed / total) * 100);

  const cycleStatus = (id) => {
    const cur = statuses[id] || 'open';
    const next = cur === 'open' ? 'in-progress' : cur === 'in-progress' ? 'completed' : 'open';
    setState({ ...state, statuses: { ...statuses, [id]: next } });
  };
  const updateNote = (id, text) => setState({ ...state, notes: { ...notes, [id]: text } });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--canvas-text-2)' }}>
        <span style={{ fontFamily: 'var(--canvas-mono)', fontWeight: 700, fontSize: 16, color: 'var(--canvas-text)' }}>
          {completed}<span style={{ color: 'var(--canvas-text-3)', fontWeight: 500 }}>/{total}</span>
        </span>
        <div className="progress" style={{ flex: 1, height: 6 }}>
          <i style={{ width: pct + '%' }}/>
        </div>
        <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11, color: 'var(--canvas-text-3)' }}>{pct}%</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {PHD_MILESTONES.map(m => {
          const status = statuses[m.id] || 'open';
          const note = notes[m.id] || '';
          return (
            <div key={m.id} className={`phd-milestone milestone-${status}`}>
              <button
                className="phd-milestone-check"
                onClick={() => cycleStatus(m.id)}
                title={`Status: ${status} (click to advance)`}
              >
                {status === 'completed' && <Icon name="check" size={11}/>}
                {status === 'in-progress' && <span className="task-check-dot"/>}
              </button>
              <div className="phd-milestone-body" onClick={() => setEditingId(editingId === m.id ? null : m.id)}>
                <div className="phd-milestone-label">{m.label}</div>
                {(note || editingId === m.id) ? (
                  editingId === m.id ? (
                    <input
                      className="inline-input"
                      autoFocus
                      defaultValue={note}
                      placeholder={m.hint}
                      onBlur={(e) => { updateNote(m.id, e.target.value); setEditingId(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingId(null); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 2, fontSize: 11.5 }}
                    />
                  ) : (
                    <div className="phd-milestone-note">{note}</div>
                  )
                ) : (
                  <div className="phd-milestone-hint">{m.hint}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===== PhD Resources — curated links + open-source apps =====
// Static curated list of useful PhD tools and resources, plus user-added links.
const PHD_RESOURCE_GROUPS = [
  {
    label: 'Open-source PhD tools',
    items: [
      { name: 'Zotero', href: 'https://www.zotero.org/', desc: 'Reference manager — free and open source' },
      { name: 'Obsidian', href: 'https://obsidian.md/', desc: 'Local-first knowledge graph for notes' },
      { name: 'JabRef', href: 'https://www.jabref.org/', desc: 'BibTeX-native reference manager' },
      { name: 'Pandoc', href: 'https://pandoc.org/', desc: 'Universal document converter' },
      { name: 'Quarto', href: 'https://quarto.org/', desc: 'Scientific publishing with R/Python/Julia' },
    ],
  },
  {
    label: 'Writing & formatting',
    items: [
      { name: 'Overleaf', href: 'https://www.overleaf.com/', desc: 'Browser LaTeX editor with templates' },
      { name: 'LaTeX Templates', href: 'https://www.latextemplates.com/', desc: 'Thesis, CV, poster templates' },
      { name: 'Hemingway Editor', href: 'https://hemingwayapp.com/', desc: 'Plain-language readability check' },
    ],
  },
  {
    label: 'Community & career',
    items: [
      { name: 'Academic Twitter / #PhDChat', href: 'https://twitter.com/search?q=%23PhDChat', desc: 'Peers + advisors discussing the grind' },
      { name: 'ORCID', href: 'https://orcid.org/', desc: 'Permanent researcher ID for citations + grants' },
      { name: 'Conferences & CFPs (WikiCFP)', href: 'http://www.wikicfp.com/', desc: 'Upcoming deadlines across fields' },
    ],
  },
];

export function PhdResourcesWidget({ state, setState }) {
  const customLinks = state.customLinks || [];
  const [name, setName] = useState('');
  const [href, setHref] = useState('');

  const addLink = () => {
    if (!name.trim() || !href.trim()) return;
    setState({ ...state, customLinks: [...customLinks, { id: 'r' + Date.now(), name: name.trim(), href: href.trim() }] });
    setName(''); setHref('');
    fireToast('Resource added');
  };
  const removeLink = (id) => setState({ ...state, customLinks: customLinks.filter(l => l.id !== id) });

  return (
    <>
      {PHD_RESOURCE_GROUPS.map(g => (
        <div key={g.label}>
          <div style={{ fontSize: 10, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
            {g.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {g.items.map(it => (
              <a key={it.name} href={it.href} target="_blank" rel="noopener noreferrer" className="phd-resource-link">
                <span className="phd-resource-name">{it.name}</span>
                <span className="phd-resource-desc">{it.desc}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
      {customLinks.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
            Your links
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {customLinks.map(l => (
              <div key={l.id} className="phd-resource-link" style={{ position: 'relative' }}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', flex: 1, textDecoration: 'none', color: 'inherit' }}>
                  <span className="phd-resource-name">{l.name}</span>
                  <span className="phd-resource-desc">{l.href}</span>
                </a>
                <button className="icon-btn" onClick={() => removeLink(l.id)} style={{ position: 'absolute', right: 4, top: 4, width: 20, height: 20 }}>
                  <Icon name="x" size={11}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <input className="input" placeholder="Resource name" value={name} onChange={e => setName(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}/>
        <input className="input" placeholder="https://…" value={href} onChange={e => setHref(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', flex: 2 }}/>
        <button className="btn" onClick={addLink} disabled={!name.trim() || !href.trim()}>
          <Icon name="plus" size={12}/>Add
        </button>
      </div>
    </>
  );
}

// ===== Stub — roadmap preview card =====
// Shows what's coming for this widget type so adding it from the palette
// doesn't feel like a dead end.
const STUB_PLANS = {
  'concept-map': ['Drag papers as nodes', 'Connect by theme', 'Auto-cluster by citation overlap'],
  'highlights': ['Pull quotes with auto-citation', 'Search across all notes'],
  'paper-tldr': ['Drop a PDF', 'Get claim / method / limits / gaps', 'Save to Bibliography in one click'],
  'outline': ['Collapsible tree', 'Drop Insights into slots', 'Promote to Deliverable section'],
  'latex': ['Render math as you type', 'Snippet library', 'Copy as image / TeX'],
  'draft-locker': ['Versioned chapter drafts', 'Diff between versions', 'Roll back any change'],
  'gantt': ['Proposal → IRB → defense timeline', 'Critical-path highlighting', 'Drag to reschedule'],
  'mood': ['Daily slider', 'Trend graph', 'Correlate with productive days'],
  'sleep': ['Sleep duration vs. word output', 'Energy heatmap', 'Apple Health import'],
  'focus': ['Curated ambient playlists', 'Focus session timer', 'Auto-pause on Pomodoro break'],
  'cfp': ['CFP deadlines by venue', 'Fit score by topic', 'Submission status pipeline'],
  'grants': ['Grant deadlines + amounts', 'Award log', 'Generate budget justification'],
  'crm': ['Collaborators with last touch', 'Quick-add from Meeting Log', 'Reminders for cold contacts'],
  'cv': ['Track outputs over time', 'Auto-generate CV from Bibliography', 'Highlight by impact factor'],
  'datasets': ['Public datasets by domain', 'Saved searches', 'License + access notes'],
  'methods': ['When to use what test', 'Examples + citations', 'Saved templates per chapter'],
  'discounts': ['Software & services with edu pricing', 'Discount expiration tracking'],
  'assumption': ['Names hidden assumptions', 'Asks "what if wrong?"', 'Logs to a hypothesis tree'],
  'whats-missing': ['Gap analysis on lit review', 'Compares to top venues', 'Suggests targeted reads'],
  'calibrator': ['Challenges every "results show" claim', 'Asks for the prior', 'Flags p-hacking patterns'],
};

export function StubWidget({ meta }) {
  const plan = STUB_PLANS[meta.type] || [];
  return (
    <div className="widget-stub">
      <div className="widget-stub-icon"><Icon name={meta.icon} size={18}/></div>
      <div className="widget-stub-tag">Coming soon</div>
      <div className="widget-stub-title">{meta.name}</div>
      <div className="widget-stub-desc">{meta.desc}</div>
      {plan.length > 0 && (
        <ul className="widget-stub-plan">
          {plan.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
