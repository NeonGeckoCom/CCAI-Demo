import React, { useState, useMemo, useRef } from 'react';
import Icon from './CanvasIcon';
import { WIDGET_CATALOG, CATEGORIES } from './canvasData';

const fireToast = (msg, kind = 'success') =>
  window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg, kind } }));

// ---------- Add citation (with DOI lookup via CrossRef) ----------
export function AddCitationModal({ data, onClose }) {
  const init = data.initial || {};
  const [authors, setA] = useState(init.authors || '');
  const [title, setT] = useState(init.title || '');
  const [journal, setJ] = useState(init.journal || '');
  const [year, setY] = useState(init.year || new Date().getFullYear());
  const [doi, setDoi] = useState(init.doi || '');
  const [lookingUp, setLookingUp] = useState(false);
  const [bibtexInput, setBibtexInput] = useState('');
  const [showBibtex, setShowBibtex] = useState(false);
  const valid = authors && title && journal;
  const editing = !!init.key;

  const lookupDoi = async () => {
    const cleaned = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    if (!cleaned) return;
    setLookingUp(true);
    try {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleaned)}`);
      if (!res.ok) throw new Error('Not found');
      const json = await res.json();
      const w = json.message;
      const authorList = (w.author || []).map(a => `${a.family || ''}, ${(a.given || '').charAt(0)}.`).join('; ');
      setA(authorList || 'Unknown');
      setT((w.title && w.title[0]) || 'Untitled');
      setJ((w['container-title'] && w['container-title'][0]) || '');
      setY((w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0]) || new Date().getFullYear());
      fireToast('DOI resolved · fields filled');
    } catch (e) {
      fireToast(`DOI lookup failed: ${e.message}`, 'danger');
    } finally {
      setLookingUp(false);
    }
  };

  const importBibtex = () => {
    // Minimal BibTeX parser: pull author/title/journal/year out of the first @entry block.
    const get = (field) => {
      const m = bibtexInput.match(new RegExp(`${field}\\s*=\\s*[{"]([^}"]+)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const a = get('author');
    const t = get('title');
    const j = get('journal') || get('booktitle');
    const y = get('year');
    if (!t) { fireToast('Could not parse BibTeX', 'danger'); return; }
    setA(a); setT(t); setJ(j); setY(y || new Date().getFullYear());
    setShowBibtex(false);
    fireToast('BibTeX imported');
  };

  const submit = () => {
    if (!valid) return;
    const key = init.key || (authors.split(',')[0] || 'cite').toLowerCase().replace(/[^a-z]/g, '') + year;
    data.onAdd({ key, authors, title, journal, year: +year, cited: init.cited || 0, doi: doi || init.doi });
    fireToast(`${editing ? 'Updated' : 'Added'} @${key}`);
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="book" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit citation' : 'Add citation'}</div>
          <div className="modal-sub">{editing ? `@${init.key}` : 'Paste a DOI or BibTeX, or fill in manually.'}</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">DOI</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" placeholder="10.1038/nn0199_79  or  https://doi.org/…"
                value={doi} onChange={e => setDoi(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookupDoi(); }}/>
              <button className="btn" onClick={lookupDoi} disabled={!doi.trim() || lookingUp}>
                {lookingUp ? <><div className="spinner"/>Looking up</> : <><Icon name="search" size={13}/>Resolve</>}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--canvas-text-3)' }}>
            <button className="btn btn-ghost" onClick={() => setShowBibtex(s => !s)} style={{ padding: '4px 8px', fontSize: 11 }}>
              <Icon name="copy" size={12}/>{showBibtex ? 'Hide BibTeX' : 'Import BibTeX'}
            </button>
          </div>
          {showBibtex && (
            <div className="form-row">
              <label className="label">Paste a BibTeX entry</label>
              <textarea className="textarea" rows={5} style={{ fontFamily: 'var(--canvas-mono)', fontSize: 11.5 }}
                value={bibtexInput} onChange={e => setBibtexInput(e.target.value)}
                placeholder="@article{key, author={...}, title={...}, journal={...}, year={...}}"/>
              <button className="btn" onClick={importBibtex} disabled={!bibtexInput.trim()} style={{ alignSelf: 'flex-start' }}>
                <Icon name="check" size={13}/>Parse and fill
              </button>
            </div>
          )}
          <div className="form-row">
            <label className="label">Authors</label>
            <input className="input" value={authors} onChange={e => setA(e.target.value)} placeholder="Smith, J., & Doe, A."/>
          </div>
          <div className="form-row">
            <label className="label">Title</label>
            <input className="input" value={title} onChange={e => setT(e.target.value)} placeholder="A study of …"/>
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Journal</label>
              <input className="input" value={journal} onChange={e => setJ(e.target.value)} placeholder="Nature Neuroscience"/>
            </div>
            <div className="form-row">
              <label className="label">Year</label>
              <input className="input" type="number" value={year} onChange={e => setY(e.target.value)}/>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!valid}>
          <Icon name={editing ? 'check' : 'plus'} size={13}/>{editing ? 'Save changes' : 'Add citation'}
        </button>
      </div>
    </div>
  );
}

// ---------- Add task ----------
export function AddTaskModal({ data, onClose }) {
  const init = data.initial || {};
  const [title, setT] = useState(init.title || '');
  const [priority, setP] = useState(init.priority || 'med');
  const [meta, setM] = useState(init.meta || '');
  const editing = !!init.id;

  const submit = () => {
    if (!title) return;
    data.onAdd({ title, priority, meta: meta || '—' });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="kanban" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit task' : 'Add task'}</div>
          <div className="modal-sub">{editing ? '' : 'It\'ll be added to the column.'}</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">Task</label>
            <input className="input" autoFocus value={title} onChange={e => setT(e.target.value)} placeholder="What needs doing?"/>
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Priority</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['high', 'High'], ['med', 'Med'], ['low', 'Low']].map(([v, l]) => (
                  <button key={v} className="btn"
                    style={{ flex: 1, padding: '7px 8px', justifyContent: 'center',
                      background: priority === v ? 'var(--canvas-surface-3)' : 'var(--canvas-surface-2)',
                      borderColor: priority === v ? 'var(--canvas-border-2)' : 'var(--canvas-border)',
                      color: priority === v ? 'var(--canvas-text)' : 'var(--canvas-text-2)' }}
                    onClick={() => setP(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label className="label">Note / due</label>
              <input className="input" value={meta} onChange={e => setM(e.target.value)} placeholder="May 22 · 2h"/>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!title}>
          <Icon name={editing ? 'check' : 'plus'} size={13}/>{editing ? 'Save changes' : 'Add task'}
        </button>
      </div>
    </div>
  );
}

// ---------- Add deadline ----------
export function AddDeadlineModal({ data, onClose }) {
  const init = data.initial || {};
  const [title, setT] = useState(init.title || '');
  const [date, setD] = useState(init.date || '');
  const [tag, setG] = useState(init.tag || 'writing');
  const editing = !!init.id;

  const submit = () => {
    if (!title || !date) return;
    data.onAdd({ title, date, tag });
    fireToast(`${editing ? 'Updated' : 'Added'} · ${title}`);
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="calendar" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit deadline' : 'Add deadline'}</div>
          <div className="modal-sub">Will appear sorted by urgency.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">What's due</label>
            <input className="input" autoFocus value={title} onChange={e => setT(e.target.value)} placeholder="NSF report, COSYNE abstract…"/>
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={e => setD(e.target.value)}/>
            </div>
            <div className="form-row">
              <label className="label">Category</label>
              <select className="select" value={tag} onChange={e => setG(e.target.value)}>
                <option value="writing">Writing</option>
                <option value="lab">Lab</option>
                <option value="conf">Conference</option>
                <option value="NSF">Funding</option>
                <option value="milestone">Milestone</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!title || !date}>
          <Icon name={editing ? 'check' : 'plus'} size={13}/>{editing ? 'Save' : 'Add deadline'}
        </button>
      </div>
    </div>
  );
}

// ---------- Log words ----------
export function LogWordsModal({ data, onClose }) {
  const [n, setN] = useState(data.today);
  const submit = () => {
    data.onLog(+n || 0);
    fireToast(`Logged ${n} words today.`);
    onClose();
  };
  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="pencil" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">Log today's words</div>
          <div className="modal-sub">Total written today, including edits to existing chapters.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-row">
          <label className="label">Words written</label>
          <input className="input" type="number" autoFocus value={n} onChange={e => setN(e.target.value)} style={{ fontFamily: 'var(--canvas-mono)', fontSize: 18, padding: '12px 14px' }}/>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {[0, 100, 250, 500, 750, 1000].map(v => (
            <button key={v} className="chip" onClick={() => setN(v)}>{v}</button>
          ))}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}><Icon name="check" size={13}/>Log words</button>
      </div>
    </div>
  );
}

// ---------- Confirm remove ----------
export function ConfirmRemoveModal({ data, onClose }) {
  return (
    <div className="canvas-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon" style={{ background: 'rgba(240,106,106,0.12)', color: 'var(--canvas-danger)' }}>
          <Icon name="trash" size={18}/>
        </div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">Remove "{data.label}"?</div>
          <div className="modal-sub">Widget state stays in your project — you can add it back from the palette.</div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" style={{ background: 'rgba(240,106,106,0.12)', borderColor: 'rgba(240,106,106,0.3)', color: 'var(--canvas-danger)' }} onClick={() => { data.onConfirm(); onClose(); }}>
          <Icon name="trash" size={13}/>Remove
        </button>
      </div>
    </div>
  );
}

// ---------- Reading paper (with CrossRef search/DOI lookup) ----------
export function ReadingPaperModal({ data, onClose }) {
  const init = data.initial || {};
  const [title, setT] = useState(init.title || '');
  const [priority, setP] = useState(init.priority || 'med');
  const [time, setTime] = useState(init.time || '1h');
  const [doi, setDoi] = useState(init.doi || '');
  const [searchQ, setSearchQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const editing = !!init.title && data.initial;

  const lookupByDoi = async () => {
    const cleaned = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    if (!cleaned) return;
    setSearching(true);
    try {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleaned)}`);
      if (!res.ok) throw new Error('not found');
      const json = await res.json();
      const w = json.message;
      const author = (w.author && w.author[0]) ? `${w.author[0].family}` : 'Unknown';
      const yr = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0]) || '';
      setT(`${author} ${yr} — ${(w.title && w.title[0]) || 'Untitled'}`);
      fireToast('DOI resolved');
    } catch (e) {
      fireToast(`Lookup failed: ${e.message}`, 'danger');
    } finally {
      setSearching(false);
    }
  };

  const searchCrossref = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(searchQ)}&rows=5&select=DOI,title,author,issued`);
      const json = await res.json();
      setResults(json.message.items || []);
    } catch (e) {
      fireToast(`Search failed: ${e.message}`, 'danger');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (w) => {
    const author = (w.author && w.author[0]) ? w.author[0].family : 'Unknown';
    const yr = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0]) || '';
    setT(`${author} ${yr} — ${(w.title && w.title[0]) || 'Untitled'}`);
    setDoi(w.DOI || '');
    setResults([]);
  };

  const submit = () => {
    if (!title) return;
    data.onAdd({ title, priority, time, doi });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="list" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit paper' : 'Queue a paper'}</div>
          <div className="modal-sub">Search by title, paste a DOI, or type freely.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">Search CrossRef</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" placeholder="Predictive coding mouse V1…" value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchCrossref(); }}/>
              <button className="btn" onClick={searchCrossref} disabled={!searchQ.trim() || searching}>
                {searching ? <div className="spinner"/> : <Icon name="search" size={13}/>}
                Search
              </button>
            </div>
          </div>
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {results.map((w, i) => (
                <button key={i} className="palette-item" style={{ padding: '8px 10px' }} onClick={() => pickResult(w)}>
                  <div className="pi-content">
                    <div className="pi-title" style={{ fontSize: 12 }}>{(w.title && w.title[0]) || 'Untitled'}</div>
                    <div className="pi-desc">
                      {(w.author && w.author.slice(0, 2).map(a => a.family).join(', ')) || ''}
                      {w.author && w.author.length > 2 ? ' et al.' : ''}
                      {' · '}
                      {(w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0]) || ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <label className="label">DOI (optional)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={doi} onChange={e => setDoi(e.target.value)} placeholder="10.1038/…"/>
              <button className="btn" onClick={lookupByDoi} disabled={!doi.trim() || searching}>Resolve</button>
            </div>
          </div>
          <div className="form-row">
            <label className="label">Title</label>
            <input className="input" value={title} onChange={e => setT(e.target.value)} placeholder="Author Year — Short title"/>
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Priority</label>
              <select className="select" value={priority} onChange={e => setP(e.target.value)}>
                <option value="high">High</option>
                <option value="med">Med</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-row">
              <label className="label">Est. read time</label>
              <input className="input" value={time} onChange={e => setTime(e.target.value)} placeholder="2h, 90m, etc."/>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!title}><Icon name={editing ? 'check' : 'plus'} size={13}/>{editing ? 'Save' : 'Queue'}</button>
      </div>
    </div>
  );
}

// ---------- Budget item ----------
export function BudgetItemModal({ data, onClose }) {
  const init = data.initial || {};
  const [label, setL] = useState(init.label || '');
  const [spent, setS] = useState(init.spent ?? 0);
  const [color, setC] = useState(init.color || '#3dd9d6');
  const editing = !!init.label;
  const colors = ['#3dd9d6', '#e864b8', '#f5b454', '#7ed98a', '#9b8cff', '#f06a6a'];

  const submit = () => {
    if (!label) return;
    data.onSave({ label, spent: +spent || 0, color });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="wallet" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit category' : 'Add category'}</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">Category</label>
            <input className="input" autoFocus value={label} onChange={e => setL(e.target.value)} placeholder="Equipment, travel, etc."/>
          </div>
          <div className="form-row">
            <label className="label">Amount spent ($)</label>
            <input className="input" type="number" value={spent} onChange={e => setS(e.target.value)} style={{ fontFamily: 'var(--canvas-mono)' }}/>
          </div>
          <div className="form-row">
            <label className="label">Color</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {colors.map(c => (
                <button key={c} onClick={() => setC(c)} title={c}
                  style={{ width: 28, height: 28, borderRadius: 6, background: c, border: color === c ? '2px solid var(--canvas-text)' : '2px solid transparent', cursor: 'pointer' }}/>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {editing && data.onDelete && (
          <button className="btn btn-danger" style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--canvas-danger)', marginRight: 'auto' }} onClick={() => { data.onDelete(); onClose(); }}><Icon name="trash" size={13}/>Delete</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!label}><Icon name="check" size={13}/>{editing ? 'Save' : 'Add'}</button>
      </div>
    </div>
  );
}

// ---------- Note (with @mention autocomplete) ----------
export function NoteModal({ data, onClose }) {
  const init = data.initial || {};
  const [text, setT] = useState(init.text || '');
  const [tag, setG] = useState(init.tag || '');
  const [linkTo, setL] = useState(init.linkTo || '');
  const [mention, setMention] = useState(null); // { start, query, choices }
  const [mentionIdx, setMentionIdx] = useState(0);
  const taRef = useRef(null);
  const editing = !!init.id;

  // Pull mention sources from the persisted canvas state so the modal stays self-contained.
  const mentionSources = useMemo(() => {
    try {
      const all = JSON.parse(localStorage.getItem('canvas-states-v2') || '{}');
      const out = [];
      (all.bibliography?.entries || []).forEach(e => out.push({ key: '@' + e.key, label: e.title, kind: 'cite' }));
      (all.writing?.chapters || []).forEach(c => out.push({ key: '@' + c.name.replace(/\s+/g, '-'), label: c.name, kind: 'chapter' }));
      (all.kanban?.cards || []).forEach(c => out.push({ key: '@' + c.title.slice(0, 30).replace(/\s+/g, '-'), label: c.title, kind: 'task' }));
      return out;
    } catch { return []; }
  }, []);

  const onTextChange = (e) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setT(val);
    // Look back from cursor for an @mention being typed
    const before = val.slice(0, cursor);
    const m = before.match(/@(\S*)$/);
    if (m) {
      const q = m[1].toLowerCase();
      const choices = mentionSources
        .filter(s => s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes('@' + q))
        .slice(0, 6);
      setMention({ start: cursor - m[0].length, query: m[1], choices });
      setMentionIdx(0);
    } else {
      setMention(null);
    }
  };

  const insertMention = (item) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length); // +1 for the @
    const inserted = item.key + ' ';
    setT(before + inserted + after);
    setMention(null);
    setTimeout(() => {
      if (taRef.current) {
        const pos = before.length + inserted.length;
        taRef.current.setSelectionRange(pos, pos);
        taRef.current.focus();
      }
    }, 0);
  };

  const onKeyDown = (e) => {
    if (!mention || mention.choices.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(mention.choices.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mention.choices[mentionIdx]); }
    if (e.key === 'Escape') setMention(null);
  };

  const submit = () => {
    if (!text.trim()) return;
    data.onSave({ text: text.trim(), tag: tag.trim(), linkTo: linkTo.trim() });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="notes" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit note' : 'New note'}</div>
          <div className="modal-sub">Markdown supported · **bold**, *italic*, `code`, lists, links</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row" style={{ position: 'relative' }}>
            <textarea ref={taRef} className="textarea" autoFocus
              style={{ minHeight: 140, fontFamily: 'var(--canvas-mono)', fontSize: 12.5 }}
              value={text} onChange={onTextChange} onKeyDown={onKeyDown}
              placeholder="What's the thought? Markdown welcome. Type @ to mention citations, chapters, tasks."/>
            {mention && mention.choices.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%', left: 0, right: 0,
                background: 'var(--canvas-surface)',
                border: '1px solid var(--canvas-border-2)',
                borderRadius: 7,
                marginTop: 4,
                boxShadow: 'var(--canvas-shadow-lg)',
                zIndex: 10,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {mention.choices.map((c, i) => (
                  <button key={c.key + i} onMouseEnter={() => setMentionIdx(i)} onClick={() => insertMention(c)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', textAlign: 'left',
                      background: i === mentionIdx ? 'var(--canvas-surface-2)' : 'transparent',
                      color: 'var(--canvas-text)', border: 'none', cursor: 'pointer', fontSize: 12,
                    }}>
                    <span className="tag-pill">{c.kind}</span>
                    <span style={{ fontFamily: 'var(--canvas-mono)', color: 'var(--canvas-accent)' }}>{c.key}</span>
                    <span style={{ flex: 1, color: 'var(--canvas-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Tag</label>
              <input className="input" value={tag} onChange={e => setG(e.target.value)} placeholder="theory, todo, idea…"/>
            </div>
            <div className="form-row">
              <label className="label">Linked to</label>
              <input className="input" value={linkTo} onChange={e => setL(e.target.value)} placeholder="@rao1999, Aim 2…"/>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {editing && data.onDelete && (
          <button className="btn btn-danger" style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--canvas-danger)', marginRight: 'auto' }} onClick={() => { data.onDelete(); onClose(); }}><Icon name="trash" size={13}/>Delete</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!text.trim()}><Icon name="check" size={13}/>{editing ? 'Save' : 'Add note'}</button>
      </div>
    </div>
  );
}

// ---------- Habit ----------
export function HabitModal({ data, onClose }) {
  const init = data.initial || {};
  const [label, setL] = useState(init.label || '');
  const [icon, setI] = useState(init.icon || 'flame');
  const editing = !!init.id;
  const iconOpts = ['flame', 'pencil', 'book', 'flask', 'heart', 'graph', 'star'];
  const submit = () => {
    if (!label) return;
    data.onSave({ label, icon });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="flame" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit habit' : 'New habit'}</div>
          <div className="modal-sub">Tracked daily. Tap squares to mark done.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">Habit</label>
            <input className="input" autoFocus value={label} onChange={e => setL(e.target.value)} placeholder="Read 1 paper, write 30 min…"/>
          </div>
          <div className="form-row">
            <label className="label">Icon</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {iconOpts.map(n => (
                <button key={n} onClick={() => setI(n)} title={n}
                  style={{ width: 32, height: 32, borderRadius: 7, background: icon === n ? 'var(--canvas-accent-glow)' : 'var(--canvas-surface-2)', color: icon === n ? 'var(--canvas-accent)' : 'var(--canvas-text-3)', border: `1px solid ${icon === n ? 'var(--canvas-accent)' : 'var(--canvas-border)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                  <Icon name={n} size={14}/>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {editing && data.onDelete && (
          <button className="btn btn-danger" style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--canvas-danger)', marginRight: 'auto' }} onClick={() => { data.onDelete(); onClose(); }}><Icon name="trash" size={13}/>Delete</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!label}><Icon name="check" size={13}/>{editing ? 'Save' : 'Add habit'}</button>
      </div>
    </div>
  );
}

// ---------- Goal ----------
export function GoalModal({ data, onClose }) {
  const init = data.initial || {};
  const [label, setL] = useState(init.label || '');
  const [progress, setP] = useState(init.progress ?? 0);
  const [due, setD] = useState(init.due || '');
  const editing = !!init.id;

  const submit = () => {
    if (!label) return;
    data.onSave({ label, progress: +progress, due });
    onClose();
  };

  return (
    <div className="canvas-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="bullseye" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit goal' : 'New goal'}</div>
          <div className="modal-sub">Quarterly OKR or dissertation milestone.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-row">
            <label className="label">Goal</label>
            <input className="input" autoFocus value={label} onChange={e => setL(e.target.value)} placeholder="Submit Aim 2 to advisor by July"/>
          </div>
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Progress · {progress}%</label>
              <input type="range" min="0" max="100" step="5" value={progress} onChange={e => setP(+e.target.value)} style={{ accentColor: 'var(--canvas-accent)' }}/>
            </div>
            <div className="form-row">
              <label className="label">Due (optional)</label>
              <input className="input" value={due} onChange={e => setD(e.target.value)} placeholder="Q3 2026"/>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {editing && data.onDelete && (
          <button className="btn btn-danger" style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--canvas-danger)', marginRight: 'auto' }} onClick={() => { data.onDelete(); onClose(); }}><Icon name="trash" size={13}/>Delete</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!label}><Icon name="check" size={13}/>{editing ? 'Save' : 'Add goal'}</button>
      </div>
    </div>
  );
}

// ---------- Meeting ----------
export function MeetingModal({ data, onClose }) {
  const init = data.initial || {};
  const [who, setW] = useState(init.who || '');
  const [date, setD] = useState(init.date || new Date().toISOString().slice(0, 10));
  const [notes, setN] = useState(init.notes || '');
  const [actions, setA] = useState(init.actions || '');
  const editing = !!init.id;

  const submit = () => {
    if (!who) return;
    data.onSave({ who, date, notes, actions });
    onClose();
  };

  return (
    <div className="canvas-modal wide" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="message" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">{editing ? 'Edit meeting' : 'Log meeting'}</div>
          <div className="modal-sub">Advisor / collaborator / sponsor — anyone you want to track.</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-grid two">
            <div className="form-row">
              <label className="label">Who</label>
              <input className="input" autoFocus value={who} onChange={e => setW(e.target.value)} placeholder="Dr. Reineke"/>
            </div>
            <div className="form-row">
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={e => setD(e.target.value)}/>
            </div>
          </div>
          <div className="form-row">
            <label className="label">Notes</label>
            <textarea className="textarea" value={notes} onChange={e => setN(e.target.value)} placeholder="Discussion topics, decisions…"/>
          </div>
          <div className="form-row">
            <label className="label">Action items (one per line)</label>
            <textarea className="textarea" value={actions} onChange={e => setA(e.target.value)} placeholder="Send draft Aim 2&#10;Re-analyze M3&#10;Schedule next 1:1"/>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        {editing && data.onDelete && (
          <button className="btn btn-danger" style={{ background: 'transparent', borderColor: 'transparent', color: 'var(--canvas-danger)', marginRight: 'auto' }} onClick={() => { data.onDelete(); onClose(); }}><Icon name="trash" size={13}/>Delete</button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={!who}><Icon name="check" size={13}/>{editing ? 'Save' : 'Log meeting'}</button>
      </div>
    </div>
  );
}

// ---------- Widget palette ----------
export function PaletteModal({ data, onClose }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const present = new Set(data.layout.map(w => w.type));

  const filtered = useMemo(() => {
    let r = WIDGET_CATALOG;
    if (cat !== 'all') r = r.filter(w => w.cat === cat);
    if (q) {
      const ql = q.toLowerCase();
      r = r.filter(w => w.name.toLowerCase().includes(ql) || w.desc.toLowerCase().includes(ql));
    }
    return r;
  }, [q, cat]);

  const add = (w) => {
    if (present.has(w.type)) return;
    data.onAdd(w);
    fireToast(`${w.name} added to workspace`, w.critic ? 'critic' : 'success');
  };

  return (
    <div className="canvas-modal huge" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-icon"><Icon name="layout" size={18}/></div>
        <div style={{ flex: 1 }}>
          <div className="modal-title">Add widget</div>
          <div className="modal-sub">{WIDGET_CATALOG.length} widgets · {WIDGET_CATALOG.filter(w => w.critic).length} anti-yes-man</div>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon name="x" size={16}/></button>
      </div>
      <div className="modal-body">
        <div className="palette-search">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--canvas-text-3)' }}><Icon name="search" size={14}/></span>
            <input className="input" autoFocus style={{ paddingLeft: 34 }} placeholder="Search widgets…" value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          <div className="palette-cats" style={{ marginTop: 12 }}>
            {CATEGORIES.map(c => (
              <button key={c.id}
                className={`palette-cat ${cat === c.id ? 'active' : ''} ${c.critic ? 'critic' : ''}`}
                onClick={() => setCat(c.id)}>
                {c.label}{c.critic && <span style={{ marginLeft: 4 }}>★</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="palette-grid">
          {filtered.map(w => {
            const added = present.has(w.type);
            return (
              <button key={w.type}
                className={`palette-item ${w.critic ? 'critic' : ''} ${added ? 'added' : ''}`}
                onClick={() => add(w)} disabled={added}>
                <div className="pi-icon"><Icon name={w.icon} size={16}/></div>
                <div className="pi-content">
                  <div className="pi-title">
                    {w.name}
                    {w.critic && <span className="widget-tag" style={{ fontSize: 8.5 }}>WEDGE</span>}
                    {w.critic && <span className="widget-tag widget-tag-chat" style={{ fontSize: 8.5 }} title="Real critique happens in the main chat — this widget is a scratchpad">BEST IN CHAT</span>}
                    {w.enhanced && !w.stub && !w.critic && <span className="widget-tag widget-tag-enhanced" style={{ fontSize: 8.5 }}>ENHANCED</span>}
                    {w.stub && <span style={{ fontSize: 9, color: 'var(--canvas-text-4)', fontFamily: 'var(--canvas-mono)', marginLeft: 4 }}>SOON</span>}
                  </div>
                  <div className="pi-desc">{w.desc}</div>
                </div>
                {added && <span className="pi-added">added</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: 'span 2', padding: 30, textAlign: 'center', color: 'var(--canvas-text-3)', fontSize: 13 }}>
              No widgets match "{q}".
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Global content search (notes / quotes / citations / kanban / deadlines / outline) ----------
export function GlobalSearchModal({ data, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const states = data.states || {};

  const items = useMemo(() => {
    if (!q.trim()) return [];
    const ql = q.toLowerCase();
    const out = [];
    // Notes
    (states.notes?.items || []).forEach(n => {
      if ((n.text || '').toLowerCase().includes(ql) || (n.tag || '').toLowerCase().includes(ql) || (n.linkTo || '').toLowerCase().includes(ql)) {
        out.push({ kind: 'Note', label: (n.text || '').slice(0, 80), sub: n.tag ? `#${n.tag}` : '', icon: 'notes', widgetType: 'notes' });
      }
    });
    // Citations
    (states.bibliography?.entries || []).forEach(e => {
      const blob = `${e.title} ${e.authors} ${e.journal} ${e.key}`.toLowerCase();
      if (blob.includes(ql)) out.push({ kind: 'Citation', label: e.title, sub: `${e.authors} (${e.year})`, icon: 'book', widgetType: 'bibliography' });
    });
    // Kanban
    (states.kanban?.cards || []).forEach(c => {
      if (`${c.title} ${c.meta || ''}`.toLowerCase().includes(ql)) {
        out.push({ kind: 'Task', label: c.title, sub: `${c.priority?.toUpperCase()} · ${c.meta || ''}`, icon: 'kanban', widgetType: 'kanban' });
      }
    });
    // Deadlines
    (states.deadlines || []).forEach(d => {
      if (`${d.title} ${d.tag}`.toLowerCase().includes(ql)) {
        out.push({ kind: 'Deadline', label: d.title, sub: `${d.date} · ${d.tag}`, icon: 'calendar', widgetType: 'deadlines' });
      }
    });
    // Highlights
    (states.highlights?.items || []).forEach(h => {
      if (`${h.text} ${h.citeKey}`.toLowerCase().includes(ql)) {
        out.push({ kind: 'Quote', label: `"${h.text}"`.slice(0, 80), sub: h.citeKey ? `@${h.citeKey}` : '', icon: 'cite', widgetType: 'highlights' });
      }
    });
    // Outline
    (states.outline?.items || []).forEach(o => {
      if ((o.text || '').toLowerCase().includes(ql)) {
        out.push({ kind: 'Outline', label: o.text, sub: `depth ${o.depth}`, icon: 'list', widgetType: 'outline' });
      }
    });
    // Documenter
    (states.documenter?.entries || []).forEach(e => {
      if ((e.text || '').toLowerCase().includes(ql)) {
        out.push({ kind: 'Journal', label: e.text.slice(0, 80), sub: e.date, icon: 'pencil', widgetType: 'documenter' });
      }
    });
    return out.slice(0, 30);
  }, [q, states]);

  const jumpTo = (it) => {
    const el = document.querySelector(`[data-widget-id^="w-"][data-widget-type="${it.widgetType}"]`)
      || document.querySelector(`.widget`); // fallback: scroll to first
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.style.boxShadow = '0 0 0 2px var(--canvas-accent), 0 0 24px var(--canvas-accent-glow)';
      setTimeout(() => { el.style.boxShadow = ''; }, 1400);
    }
    onClose();
  };

  return (
    <div className="canvas-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: '16px 18px 8px', borderBottom: '1px solid var(--canvas-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="search" size={16} style={{ color: 'var(--canvas-text-3)' }}/>
        <input
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && items[idx]) jumpTo(items[idx]);
          }}
          placeholder="Search across notes, citations, tasks, quotes, deadlines…"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--canvas-text)', fontSize: 15, padding: '4px 0' }}
        />
        <kbd style={{ fontFamily: 'var(--canvas-mono)', fontSize: 10, color: 'var(--canvas-text-3)', background: 'var(--canvas-surface-2)', padding: '2px 6px', borderRadius: 4 }}>esc</kbd>
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto', padding: 6 }}>
        {!q.trim() && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--canvas-text-3)', fontSize: 13 }}>
            Type to search across your canvas content.
          </div>
        )}
        {q.trim() && items.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--canvas-text-3)', fontSize: 13 }}>
            No matches for "{q}".
          </div>
        )}
        {items.map((it, i) => (
          <button key={i} onClick={() => jumpTo(it)} onMouseEnter={() => setIdx(i)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', borderRadius: 7, textAlign: 'left',
              background: idx === i ? 'var(--canvas-surface-2)' : 'transparent',
              color: 'var(--canvas-text)', border: 'none', cursor: 'pointer',
            }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: 'var(--canvas-surface-2)', display: 'grid', placeItems: 'center', color: 'var(--canvas-accent)' }}>
              <Icon name={it.icon} size={13}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
              <div style={{ fontSize: 11, color: 'var(--canvas-text-3)' }}>{it.sub}</div>
            </div>
            <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 9.5, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{it.kind}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--canvas-border)', display: 'flex', gap: 14, fontSize: 10.5, color: 'var(--canvas-text-3)', fontFamily: 'var(--canvas-mono)' }}>
        <span>↑↓ navigate</span><span>↵ jump</span><span>esc close</span>
      </div>
    </div>
  );
}

// ---------- Command palette ----------
export function CommandPaletteModal({ data, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => {
    const all = [
      ...data.layout.map(w => {
        const meta = WIDGET_CATALOG.find(m => m.type === w.type);
        return { kind: 'widget', label: meta?.name || w.type, icon: meta?.icon || 'layout', sub: 'Open widget', action: () => {
          const el = document.querySelector(`[data-widget-id="${w.id}"]`);
          if (el) {
            el.scrollIntoView({ block: 'center' });
            el.style.boxShadow = '0 0 0 2px var(--canvas-accent), 0 0 24px var(--canvas-accent-glow)';
            setTimeout(() => { el.style.boxShadow = ''; }, 1400);
          }
        }};
      }),
      ...WIDGET_CATALOG.filter(w => !data.layout.find(l => l.type === w.type)).map(w => ({
        kind: 'add', label: 'Add: ' + w.name, icon: w.icon, sub: w.desc, action: () => data.onAddWidget(w),
      })),
      { kind: 'cmd', label: 'Switch to Insights', icon: 'insights', sub: 'View AI summaries', action: () => data.onSetView('insights') },
      { kind: 'cmd', label: 'Switch to Workspace', icon: 'layout', sub: 'View dashboard', action: () => data.onSetView('workspace') },
      { kind: 'cmd', label: 'Toggle theme', icon: 'star', sub: 'Dark / light', action: () => data.onToggleTheme() },
      { kind: 'cmd', label: 'Export workspace JSON', icon: 'download', sub: 'Download current layout', action: () => data.onExport() },
    ];
    if (!q) return all.slice(0, 8);
    const ql = q.toLowerCase();
    return all.filter(it => it.label.toLowerCase().includes(ql) || it.sub.toLowerCase().includes(ql)).slice(0, 12);
  }, [q, data]);

  const run = (i) => { items[i]?.action(); onClose(); };

  return (
    <div className="canvas-modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: '16px 18px 8px', borderBottom: '1px solid var(--canvas-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="search" size={16} style={{ color: 'var(--canvas-text-3)' }}/>
        <input
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') run(idx);
          }}
          placeholder="Search widgets, switch view, run a command…"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--canvas-text)', fontSize: 15, padding: '4px 0' }}
        />
        <kbd style={{ fontFamily: 'var(--canvas-mono)', fontSize: 10, color: 'var(--canvas-text-3)', background: 'var(--canvas-surface-2)', padding: '2px 6px', borderRadius: 4 }}>esc</kbd>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
        {items.map((it, i) => (
          <button key={i}
            onClick={() => run(i)}
            onMouseEnter={() => setIdx(i)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', borderRadius: 7, textAlign: 'left',
              background: idx === i ? 'var(--canvas-surface-2)' : 'transparent',
              color: 'var(--canvas-text)', border: 'none', cursor: 'pointer',
            }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: 'var(--canvas-surface-2)', display: 'grid', placeItems: 'center', color: it.kind === 'add' ? 'var(--canvas-accent)' : 'var(--canvas-text-3)' }}>
              <Icon name={it.icon} size={13}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{it.label}</div>
              <div style={{ fontSize: 11, color: 'var(--canvas-text-3)' }}>{it.sub}</div>
            </div>
            <span style={{ fontFamily: 'var(--canvas-mono)', fontSize: 9.5, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{it.kind}</span>
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--canvas-text-3)', fontSize: 13 }}>No matches.</div>
        )}
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--canvas-border)', display: 'flex', gap: 14, fontSize: 10.5, color: 'var(--canvas-text-3)', fontFamily: 'var(--canvas-mono)' }}>
        <span>↑↓ navigate</span><span>↵ run</span><span>esc close</span>
      </div>
    </div>
  );
}
