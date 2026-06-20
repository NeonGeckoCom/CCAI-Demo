/* canvas-tools.jsx — genuinely functional, persistent mini-tools.
   Each tool add/edit/deletes and persists to localStorage under its own key.
   A registry maps roadmap feature ids → a tool component, so the roadmap can
   surface the right working tool for the current step and hide the rest.
   Shares scope with other Babel scripts; uses window.Icon.
*/

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT } = React;
const IconT = window.Icon;

// localStorage helpers ------------------------------------------------------
function useStored(key, initial) {
  const [val, setVal] = useStateT(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch (e) { return initial; }
  });
  useEffectT(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }, [key, val]);
  return [val, setVal];
}
const uid = (p) => p + Math.random().toString(36).slice(2, 8);

// Shared card shell ---------------------------------------------------------
function ToolCard({ icon, title, accent, children, foot }) {
  return (
    <div className="tool-card" style={accent ? { "--tool-accent": accent } : undefined}>
      <div className="tool-card-head">
        <span className="tool-card-icon"><IconT name={icon} size={15} /></span>
        <span className="tool-card-title">{title}</span>
        {foot}
      </div>
      <div className="tool-card-body">{children}</div>
    </div>
  );
}

// 1. NOTES ------------------------------------------------------------------
function NotesTool({ storeKey, title = "Notes" }) {
  const [notes, setNotes] = useStored(storeKey, []);
  const [draft, setDraft] = useStateT("");
  const add = () => {
    if (!draft.trim()) return;
    setNotes([{ id: uid("n-"), text: draft.trim(), at: Date.now() }, ...notes]);
    setDraft("");
  };
  return (
    <ToolCard icon="StickyNote" title={title} foot={<span className="tool-count">{notes.length}</span>}>
      <div className="tool-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Jot a note + Enter"
        />
        <button className="tool-add" onClick={add}><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {notes.length === 0 && <div className="tool-empty">No notes yet.</div>}
        {notes.map(n => (
          <div key={n.id} className="tool-row">
            <span className="tool-row-text">{n.text}</span>
            <button className="tool-del" onClick={() => setNotes(notes.filter(x => x.id !== n.id))}><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 2. TASKS / CHECKLIST ------------------------------------------------------
function TasksTool({ storeKey, title = "Tasks" }) {
  const [tasks, setTasks] = useStored(storeKey, []);
  const [draft, setDraft] = useStateT("");
  const add = () => {
    if (!draft.trim()) return;
    setTasks([...tasks, { id: uid("t-"), text: draft.trim(), done: false }]);
    setDraft("");
  };
  const toggle = (id) => setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const doneN = tasks.filter(t => t.done).length;
  return (
    <ToolCard icon="ListChecks" title={title} foot={<span className="tool-count">{doneN}/{tasks.length}</span>}>
      <div className="tool-input-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a task + Enter" />
        <button className="tool-add" onClick={add}><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {tasks.length === 0 && <div className="tool-empty">No tasks yet.</div>}
        {tasks.map(t => (
          <div key={t.id} className={`tool-row task ${t.done ? "done" : ""}`}>
            <button className="tool-check" onClick={() => toggle(t.id)}>{t.done && <IconT name="Check" size={11} color="#fff" />}</button>
            <span className="tool-row-text" onClick={() => toggle(t.id)}>{t.text}</span>
            <button className="tool-del" onClick={() => setTasks(tasks.filter(x => x.id !== t.id))}><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 3. READING QUEUE ----------------------------------------------------------
function ReadingTool({ storeKey, title = "Reading Queue" }) {
  const [items, setItems] = useStored(storeKey, []);
  const [draft, setDraft] = useStateT("");
  const add = () => {
    if (!draft.trim()) return;
    setItems([{ id: uid("r-"), title: draft.trim(), read: false }, ...items]);
    setDraft("");
  };
  const toggle = (id) => setItems(items.map(i => i.id === id ? { ...i, read: !i.read } : i));
  const readN = items.filter(i => i.read).length;
  return (
    <ToolCard icon="BookOpen" title={title} foot={<span className="tool-count">{readN}/{items.length} read</span>}>
      <div className="tool-input-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Paper title or DOI + Enter" />
        <button className="tool-add" onClick={add}><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {items.length === 0 && <div className="tool-empty">Nothing queued.</div>}
        {items.map(i => (
          <div key={i.id} className={`tool-row task ${i.read ? "done" : ""}`}>
            <button className="tool-check" onClick={() => toggle(i.id)}>{i.read && <IconT name="Check" size={11} color="#fff" />}</button>
            <span className="tool-row-text" onClick={() => toggle(i.id)}>{i.title}</span>
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== i.id))}><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 4. BIBLIOGRAPHY -----------------------------------------------------------
function BibTool({ storeKey, title = "Bibliography" }) {
  const [entries, setEntries] = useStored(storeKey, []);
  const [f, setF] = useStateT({ authors: "", year: "", title: "" });
  const add = () => {
    if (!f.title.trim()) return;
    const key = (f.authors.split(/[ ,]/)[0] || "ref").toLowerCase() + (f.year || "");
    setEntries([{ id: uid("b-"), key, ...f }, ...entries]);
    setF({ authors: "", year: "", title: "" });
  };
  return (
    <ToolCard icon="BookMarked" title={title} foot={<span className="tool-count">{entries.length}</span>}>
      <div className="tool-input-row bib">
        <input style={{ flex: 2 }} value={f.authors} onChange={(e) => setF({ ...f, authors: e.target.value })} placeholder="Author(s)" />
        <input style={{ flex: 1 }} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} placeholder="Year" />
        <button className="tool-add" onClick={add}><IconT name="Plus" size={14} /></button>
      </div>
      <input className="tool-fullinput" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Title + Enter" />
      <div className="tool-list">
        {entries.length === 0 && <div className="tool-empty">No references yet.</div>}
        {entries.map(e => (
          <div key={e.id} className="tool-row">
            <span className="tool-row-text"><code className="bib-key">@{e.key}</code> {e.title} {e.authors && <span style={{ color: "var(--text-tertiary)" }}>— {e.authors}{e.year ? `, ${e.year}` : ""}</span>}</span>
            <button className="tool-del" onClick={() => setEntries(entries.filter(x => x.id !== e.id))}><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

// 5. POMODORO ---------------------------------------------------------------
function PomodoroTool({ storeKey, title = "Focus Timer" }) {
  const [state, setState] = useStored(storeKey, { sessions: 0 });
  const [secs, setSecs] = useStateT(25 * 60);
  const [running, setRunning] = useStateT(false);
  const [onBreak, setOnBreak] = useStateT(false);
  const ref = useRefT(null);

  useEffectT(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          clearInterval(ref.current);
          setRunning(false);
          if (!onBreak) { setState(st => ({ sessions: (st.sessions || 0) + 1 })); setOnBreak(true); return 5 * 60; }
          setOnBreak(false); return 25 * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [running, onBreak]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const reset = () => { setRunning(false); setOnBreak(false); setSecs(25 * 60); };

  return (
    <ToolCard icon="Timer" title={title} foot={<span className="tool-count">{state.sessions || 0} done</span>}>
      <div className="pomo">
        <div className="pomo-time">{mm}:{ss}</div>
        <div className="pomo-label">{onBreak ? "Break" : "Focus"}</div>
        <div className="pomo-btns">
          <button className="btn primary" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setRunning(r => !r)}>
            <IconT name={running ? "Pause" : "Play"} size={12} color="#fff" /> <span>{running ? "Pause" : "Start"}</span>
          </button>
          <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={reset}>Reset</button>
        </div>
      </div>
    </ToolCard>
  );
}

// REGISTRY: feature id → functional tool (those without an entry stay chips) --
const TOOL_REGISTRY = {
  "notes":            (k) => <NotesTool   storeKey={k} title="Notes" />,
  "documenter":       (k) => <NotesTool   storeKey={k} title="Daily Documenter" />,
  "writing-tracker":  (k) => <NotesTool   storeKey={k} title="Writing Scratchpad" />,
  "reading-queue":    (k) => <ReadingTool storeKey={k} title="Reading Queue" />,
  "lit-matrix":       (k) => <ReadingTool storeKey={k} title="Literature Matrix" />,
  "bibliography":     (k) => <BibTool     storeKey={k} title="Bibliography" />,
  "pomodoro":         (k) => <PomodoroTool storeKey={k} title="Focus Timer" />,
  "meeting-prep":     (k) => <TasksTool   storeKey={k} title="Meeting Agenda" />,
  "pilot-checklist":  (k) => <TasksTool   storeKey={k} title="Pilot Checklist" />,
  "proquest-checklist":(k) => <TasksTool  storeKey={k} title="Submission Checklist" />,
  "formatting-check": (k) => <TasksTool   storeKey={k} title="Formatting Checklist" />,
  "outline-builder":  (k) => <TasksTool   storeKey={k} title="Outline" />
};

function hasTool(featureId) { return !!TOOL_REGISTRY[featureId]; }
function renderTool(featureId) {
  const fn = TOOL_REGISTRY[featureId];
  return fn ? fn("phd-tool-" + featureId) : null;
}

// 6. DEADLINES (real countdown tracker) --------------------------------------
const DEADLINES_KEY = "phd-coach-deadlines-v1";
function dlCountdown(date) {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  if (isNaN(d)) return null;
  const days = Math.ceil((d - new Date(new Date().toDateString())) / 86400000);
  if (days === 0) return { text: "today", past: false };
  if (days < 0) return { text: `${-days}d ago`, past: true };
  return { text: `in ${days}d`, past: false };
}
function DeadlinesTool({ storeKey = DEADLINES_KEY, title = "Deadlines" }) {
  const [items, setItems] = useStored(storeKey, []);
  const [label, setLabel] = useStateT("");
  const [date, setDate] = useStateT("");
  const add = () => { if (!label.trim()) return; setItems([...items, { id: uid("d-"), label: label.trim(), date }]); setLabel(""); setDate(""); };
  const sorted = [...items].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  return (
    <ToolCard icon="Calendar" title={title} foot={<span className="tool-count">{items.length}</span>}>
      <div className="tool-input-row bib">
        <input style={{ flex: 2 }} value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Deadline name" />
        <input style={{ flex: 1 }} type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Due date" />
        <button className="tool-add" onClick={add} aria-label="Add deadline"><IconT name="Plus" size={14} /></button>
      </div>
      <div className="tool-list">
        {sorted.length === 0 && <div className="tool-empty">No deadlines yet.</div>}
        {sorted.map(d => { const cd = dlCountdown(d.date); return (
          <div key={d.id} className="tool-row">
            <span className="tool-row-text">{d.label}{d.date && <span style={{ color: "var(--text-3)" }}> · {d.date}</span>}</span>
            {cd && <span style={{ color: cd.past ? "var(--rose)" : "var(--primary-deep)", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap" }}>{cd.text}</span>}
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== d.id))} aria-label="Remove deadline"><IconT name="X" size={12} /></button>
          </div>); })}
      </div>
    </ToolCard>
  );
}

// 7. FUNDING (fellowships & grants tracker) ----------------------------------
const FUNDING_KEY = "phd-coach-funding-v1";
const FUND_STATUS = ["planned", "applied", "awarded", "rejected"];
function fundColor(s) { return s === "awarded" ? "var(--sage)" : s === "rejected" ? "var(--rose)" : s === "applied" ? "var(--amber)" : "var(--text-3)"; }
function FundingTool({ storeKey = FUNDING_KEY, title = "Funding" }) {
  const [items, setItems] = useStored(storeKey, []);
  const [f, setF] = useStateT({ name: "", amount: "", deadline: "" });
  const add = () => { if (!f.name.trim()) return; setItems([{ id: uid("g-"), name: f.name.trim(), amount: f.amount.trim(), deadline: f.deadline, status: "planned" }, ...items]); setF({ name: "", amount: "", deadline: "" }); };
  const cycle = (id) => setItems(items.map(x => x.id === id ? { ...x, status: FUND_STATUS[(FUND_STATUS.indexOf(x.status) + 1) % FUND_STATUS.length] } : x));
  return (
    <ToolCard icon="Award" title={title} foot={<span className="tool-count">{items.length}</span>}>
      <div className="tool-input-row bib">
        <input style={{ flex: 2 }} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Fellowship / grant" />
        <input style={{ flex: 1 }} value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="$ amount" />
        <button className="tool-add" onClick={add} aria-label="Add funding"><IconT name="Plus" size={14} /></button>
      </div>
      <input className="tool-fullinput" type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} onKeyDown={e => { if (e.key === "Enter") add(); }} aria-label="Funding deadline" />
      <div className="tool-list">
        {items.length === 0 && <div className="tool-empty">No funding tracked yet.</div>}
        {items.map(g => (
          <div key={g.id} className="tool-row">
            <span className="tool-row-text">{g.name}{g.amount && <span style={{ color: "var(--text-3)" }}> · {g.amount}</span>}{g.deadline && <span style={{ color: "var(--text-3)" }}> · {g.deadline}</span>}</span>
            <button onClick={() => cycle(g.id)} title="Cycle status" style={{ color: fundColor(g.status), border: "1px solid var(--border)", borderRadius: 999, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", background: "var(--surface-2)", cursor: "pointer", textTransform: "capitalize", whiteSpace: "nowrap" }}>{g.status}</button>
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== g.id))} aria-label="Remove funding"><IconT name="X" size={12} /></button>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

Object.assign(window, {
  ToolCard, NotesTool, TasksTool, ReadingTool, BibTool, PomodoroTool, DeadlinesTool, FundingTool,
  DEADLINES_KEY, FUNDING_KEY,
  hasTool, renderTool, TOOL_REGISTRY
});
