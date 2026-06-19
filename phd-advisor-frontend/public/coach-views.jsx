/* coach-views.jsx — Insights, Workspace, Documents redesigned in the warm
   coach system. Exports window.CoachInsights, window.CoachWorkspace, window.CoachDocuments. */

const { useState: useSV, useEffect: useEV, useMemo: useMV } = React;
const IcoV = window.Icon;
const HV = window.coachHelpers;

const bMd = (s) => (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

// ============================================================================
// INSIGHTS — AI-summarized highlights from chats.
// New users see an explanatory empty state; sample data is opt-in.
// Cards are split into "Needs action" (next steps, blockers) and reference.
// ============================================================================
const INS_PREVIEW_KEY = "phd-nav-insights-preview";
function CoachInsights({ onNav }) {
  const [preview, setPreview] = useSV(() => { try { return localStorage.getItem(INS_PREVIEW_KEY) === "1"; } catch (e) { return false; } });
  const [pinned, setPinned] = useSV(() => new Set((window.CHAT_INSIGHTS || []).filter(i => i.pinned).map(i => i.id)));
  useEV(() => { try { localStorage.setItem(INS_PREVIEW_KEY, preview ? "1" : "0"); } catch (e) {} }, [preview]);
  const togglePin = (id) => setPinned(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!preview) {
    return (
      <div className="page page-narrow">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Insights</h1>
        </div>
        <div className="ins-empty">
          <div className="ins-empty-ico"><IcoV name="Sparkles" size={26} /></div>
          <h2 className="display">Insights appear here once you've chatted with your advisors a few times.</h2>
          <p>They summarize what's emerging across your conversations — open questions, blockers, and the next steps your advisors keep pointing at. Nothing is generated until there's real history to summarize.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => onNav && onNav("chat")}><IcoV name="MessageCircle" size={15} color="#fff" /> Start a conversation</button>
            <button className="btn" onClick={() => setPreview(true)}><IcoV name="Eye" size={15} /> Preview with sample data</button>
          </div>
        </div>
      </div>
    );
  }

  const all = window.CHAT_INSIGHTS || [];
  const isAction = (i) => /next step|blocker|risk|overdue|action/i.test(i.title + " " + (i.summary || ""));
  const sortPin = (list) => [...list].sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0));
  const action = sortPin(all.filter(isAction));
  const reference = sortPin(all.filter(i => !isAction(i)));

  const Card = ({ ins, urgent }) => {
    const isPin = pinned.has(ins.id);
    return (
      <article className={`ins-card ${isPin ? "pin" : ""} ${urgent ? "urgent" : ""}`}>
        <header className="ins-h">
          <div className="ins-h-l">
            <span className="ins-ico"><IcoV name={ins.icon || "Sparkles"} size={16} /></span>
            <div>
              <h3>{ins.title}</h3>
              <div className="ins-meta">From {ins.sources} conversations</div>
            </div>
          </div>
          <button className="ins-pin" onClick={() => togglePin(ins.id)} title={isPin ? "Unpin" : "Pin"}>
            <IcoV name={isPin ? "Pin" : "PinOff"} size={14} />
          </button>
        </header>
        <p className="ins-sum">{ins.summary}</p>
        <ul className="ins-bullets">
          {ins.bullets.slice(0, 3).map((b, i) => <li key={i} dangerouslySetInnerHTML={{ __html: bMd(b) }} />)}
        </ul>
        <footer className="ins-f">
          <button className="ins-fbtn" onClick={() => onNav && onNav("chat")}><IcoV name="MessageCircle" size={12} /> Chat about this</button>
        </footer>
      </article>
    );
  };

  return (
    <div className="page">
      <div className="greeting">
        <h1 className="display" style={{ fontSize: 26 }}>Insights</h1>
        <div className="sub">What's emerging across your conversations — action items first.</div>
      </div>
      <div className="sample-banner">
        <IcoV name="Eye" size={14} /> Sample data — these are examples of what Insights will look like once you've chatted.
        <button onClick={() => setPreview(false)}>Hide samples</button>
      </div>

      {action.length > 0 && (
        <>
          <div className="section-label"><span className="ic"><IcoV name="AlertCircle" size={13} /></span> Needs action</div>
          <div className="ins-grid" style={{ marginBottom: 10 }}>
            {action.map(ins => <Card key={ins.id} ins={ins} urgent={true} />)}
          </div>
        </>
      )}
      <div className="section-label"><span className="ic"><IcoV name="BookOpen" size={13} /></span> For reference</div>
      <div className="ins-grid">
        {reference.map(ins => <Card key={ins.id} ins={ins} urgent={false} />)}
      </div>
    </div>
  );
}

// ============================================================================
// WORKSPACE — widget dashboard with presets + palette
// ============================================================================
const WS_KEY = "phd-coach-workspace-v1";

// Suggested widgets per current milestone (BACKEND: stage-aware ranking)
const WS_SUGGEST = {
  "orientation": ["notes", "deadlines", "meeting-log", "phd-journey"],
  "topic-ideas": ["bibliography", "reading-queue", "notes", "meeting-log"],
  "committee": ["meeting-log", "deadlines", "notes", "calendar"],
  "literature": ["reading-queue", "bibliography", "highlights", "notes"],
  "proposal": ["outline", "writing", "deadlines", "reviewer-2"],
  "prelim": ["reading-queue", "kanban", "pomodoro", "deadlines"],
  "candidacy": ["deadlines", "meeting-log", "notes", "calendar"],
  "irb": ["kanban", "deadlines", "documenter", "notes"],
  "pilot": ["kanban", "documenter", "deadlines", "activity"],
  "collection": ["documenter", "kanban", "habits", "deadlines"],
  "analysis": ["kanban", "documenter", "writing", "pomodoro"],
  "writing": ["writing", "outline", "latex", "pomodoro"],
  "early-writing": ["writing", "outline", "notes", "pomodoro"],
  "first-paper": ["bibliography", "deadlines", "writing", "kanban"],
  "defense": ["pomodoro", "kanban", "deadlines", "notes"],
  "submission": ["deadlines", "kanban", "notes", "calendar"]
};
const wsSuggestFor = (roadmap) => {
  const cur = roadmap?.steps?.find(s => s.status === "current") || roadmap?.steps?.find(s => s.status === "redo");
  return (cur && WS_SUGGEST[cur.id]) || ["notes", "reading-queue", "deadlines", "pomodoro"];
};

function CoachWorkspace({ roadmap }) {
  const [layout, setLayout] = useSV(() => HV.loadJSON(WS_KEY, []));
  const [paletteOpen, setPaletteOpen] = useSV(false);
  useEV(() => HV.saveJSON(WS_KEY, layout), [layout]);

  const addWidget = (type) => setLayout(p => [...p, { id: `w-${type}-${Date.now()}`, type, size: "M" }]);
  const applyPreset = (preset) => setLayout(preset.layout.map((type, i) => ({ id: `w-${type}-${Date.now()}-${i}`, type, size: "M" })));
  const remove = (id) => setLayout(p => p.filter(w => w.id !== id));
  const cycle = (id) => setLayout(p => p.map(w => w.id === id ? { ...w, size: w.size === "S" ? "M" : w.size === "M" ? "L" : "S" } : w));

  const curStep = roadmap?.steps?.find(s => s.status === "current");
  const suggested = wsSuggestFor(roadmap);

  if (layout.length === 0) {
    return (
      <div className="page">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Workspace</h1>
          <div className="sub">Your <strong>tools</strong> live here — the boards, trackers, and notes your <strong>Skills</strong> and My Plan produce. Same data everywhere, never duplicated.</div>
        </div>

        <div className="section-label"><span className="ic"><IcoV name="LayoutGrid" size={13} /></span> Start with a preset</div>
        <div className="preset-grid">
          {(window.WORKSPACE_PRESETS || []).map(p => (
            <button key={p.id} className="preset-card" onClick={() => applyPreset(p)}>
              <span className="preset-ico"><IcoV name={p.icon} size={20} /></span>
              <span className="preset-n">{p.name}</span>
              <span className="preset-d">{p.desc}</span>
              <span className="preset-chips">
                {p.layout.slice(0, 4).map((t, i) => { const w = (window.WIDGET_CATALOG || []).find(c => c.type === t); return <span key={i} className="preset-chip">{w?.name || t}</span>; })}
                {p.layout.length > 4 && <span className="preset-chip">+{p.layout.length - 4}</span>}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, justifyContent: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>Or build your own —</span>
          <button className="btn sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} /> Add a widget</button>
        </div>
        {paletteOpen && <WidgetPalette onClose={() => setPaletteOpen(false)} onAdd={(t) => { addWidget(t); setPaletteOpen(false); }} suggested={suggested} stepTitle={curStep?.title} />}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 26 }}>Workspace</h1>
        <div className="sub">{layout.length} tool{layout.length === 1 ? "" : "s"} · shared with Skills and My Plan</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
        <button className="btn sm" onClick={() => setLayout([])}><IcoV name="Eraser" size={14} /> Clear</button>
        <button className="btn primary sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} color="#fff" /> Add widget</button>
      </div>

      <div className="ws-grid">
        {layout.map(w => {
          const def = (window.WIDGET_CATALOG || []).find(d => d.type === w.type);
          if (!def) return null;
          return (
            <div key={w.id} className={`ws-widget size-${w.size} ${def.critic ? "critic" : ""}`}>
              <div className="ws-w-head">
                <span className="ws-w-ico"><IcoV name={def.icon} size={14} /></span>
                <span className="ws-w-title">{def.name}</span>
                <button className="ws-size" onClick={() => cycle(w.id)}>{w.size}</button>
                <button className="ws-w-del" onClick={() => remove(w.id)}><IcoV name="Trash2" size={13} /></button>
              </div>
              <div className="ws-w-body"><WidgetBody def={def} seed={w.seed} /></div>
            </div>
          );
        })}
      </div>
      {paletteOpen && <WidgetPalette onClose={() => setPaletteOpen(false)} onAdd={(t) => { addWidget(t); setPaletteOpen(false); }} suggested={suggested} stepTitle={curStep?.title} />}
    </div>
  );
}

function WidgetBody({ def, seed }) {
  if (def.stub) return <div className="ws-stub">{def.name} · coming soon</div>;
  // chat-seeded content (created by a Chat skill) takes priority
  if (seed && seed.length) {
    if (def.type === "kanban") {
      return <div><span className="ws-seed-badge">From chat skill</span><div className="ws-seed-list">{seed.map((t, i) => <div key={i} className="ws-seed-row"><span className="wsd-c" /> {t}</div>)}</div></div>;
    }
    if (def.type === "reading-queue" || def.type === "notes" || def.type === "documenter" || def.type === "writing") {
      return <div><span className="ws-seed-badge">From chat skill</span><div className="ws-seed-list">{seed.map((t, i) => <div key={i} className="ws-seed-row"><span className="wsd-c" /> {t}</div>)}</div></div>;
    }
  }
  // a few live-feeling renderers; default to description
  switch (def.type) {
    case "bibliography":
      return <div className="ws-num-row"><b>47</b><span>references · APA</span></div>;
    case "reading-queue":
      return <div className="ws-num-row"><b>8</b><span>to read · 3 done this week</span></div>;
    case "pomodoro":
      return <div style={{ textAlign: "center" }}><div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>24:50</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Session 3 · focus</div></div>;
    case "writing":
      return <div><div className="ws-num-row"><b>412</b><span>words today · 500 goal</span></div><div style={{ display: "flex", gap: 2, marginTop: 8 }}>{Array.from({ length: 20 }, (_, i) => { const v = (i * 37) % 100 / 100; return <div key={i} style={{ flex: 1, height: 20, borderRadius: 3, background: v < .25 ? "var(--surface-3)" : v < .6 ? "var(--primary-soft)" : "var(--primary)" }} />; })}</div></div>;
    case "kanban":
      return <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>{["To do", "Doing", "Done"].map((c, i) => <div key={c} style={{ background: "var(--surface-2)", borderRadius: 8, padding: 7, fontSize: 11 }}><b style={{ display: "block", marginBottom: 5 }}>{c}</b>{Array.from({ length: [3, 2, 4][i] }).map((_, j) => <div key={j} style={{ background: "var(--surface)", padding: 5, borderRadius: 5, marginBottom: 4 }}>·</div>)}</div>)}</div>;
    case "reviewer-2":
      return <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--text-2)", lineHeight: 1.5 }}>"The framing assumes predictive coding without justifying it. A skeptical reader won't be convinced…"</div>;
    case "deadlines":
      return <div>{[["Aim 2 draft", "8d"], ["Quals proposal", "32d"]].map(([d, t]) => <div key={d} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, borderBottom: "1px solid var(--border)" }}><span>{d}</span><b style={{ color: "var(--primary-deep)" }}>in {t}</b></div>)}</div>;
    default:
      return <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{def.desc}</div>;
  }
}

function WidgetPalette({ onClose, onAdd, suggested = [], stepTitle }) {
  const [browsing, setBrowsing] = useSV(false);
  const [cat, setCat] = useSV("all");
  const [q, setQ] = useSV("");
  const cats = window.WIDGET_CATEGORIES || [];
  const catalog = window.WIDGET_CATALOG || [];
  const suggestedDefs = suggested.map(t => catalog.find(w => w.type === t)).filter(Boolean);
  const list = catalog.filter(w => (cat === "all" || w.cat === cat) && (!q || `${w.name} ${w.desc}`.toLowerCase().includes(q.toLowerCase())));

  const Tile = ({ w }) => (
    <button className={`pal-tile ${w.critic ? "critic" : ""}`} onClick={() => onAdd(w.type)}>
      <span className="pal-i"><IcoV name={w.icon} size={17} /></span>
      <span style={{ flex: 1 }}><span className="pal-n">{w.name}</span><span className="pal-d">{w.desc}</span></span>
      {w.stub && <span className="pal-soon">soon</span>}
    </button>
  );

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-h">
          <div><h2 className="display">Add a widget</h2><p>Widgets share data with the tools in My Plan.</p></div>
          <button className="modal-x" onClick={onClose}><IcoV name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="section-label" style={{ marginTop: 0 }}><span className="ic"><IcoV name="Sparkles" size={13} /></span> Suggested for your stage{stepTitle ? ` · ${stepTitle}` : ""}</div>
          <div className="pal-grid" style={{ marginBottom: 16 }}>
            {suggestedDefs.map(w => <Tile key={w.type} w={w} />)}
          </div>

          {!browsing ? (
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setBrowsing(true)}>
              <IcoV name="ChevronDown" size={14} /> Browse all {catalog.length} widgets
            </button>
          ) : (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <div className="wrap"><span className="fi"><IcoV name="Search" size={15} /></span>
                  <input placeholder="Search widgets…" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
              </div>
              <div className="pal-cats">
                {cats.map(c => <button key={c.id} className={`pal-cat ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>{c.label}</button>)}
              </div>
              <div className="pal-grid">
                {list.map(w => <Tile key={w.type} w={w} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DOCUMENTS — deliverable templates + simple editor
// ============================================================================
const DOC_KEY = "phd-coach-docs-v1";
const SECTIONS = {
  "research-paper": [["abstract", "Abstract", 250], ["intro", "Introduction", 1000], ["methods", "Methods", 800], ["results", "Results", 800], ["discussion", "Discussion", 1000], ["refs", "References", 0]],
  "meeting-prep": [["agenda", "Agenda", 80], ["progress", "Progress since last", 200], ["blockers", "Blockers", 150], ["decisions", "Decisions needed", 200], ["questions", "Questions", 150], ["followup", "Action items", 100]]
};
function sectionsFor(id) {
  if (SECTIONS[id]) return SECTIONS[id].map(([sid, name, target]) => ({ id: sid, name, target }));
  const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === id);
  const n = tpl?.sections || 4;
  return Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, name: `Section ${i + 1}`, target: 300 }));
}

function CoachDocuments() {
  const [store, setStore] = useSV(() => HV.loadJSON(DOC_KEY, { projects: {}, activeId: null }));
  useEV(() => HV.saveJSON(DOC_KEY, store), [store]);
  const projects = Object.values(store.projects || {});
  const active = store.activeId ? store.projects[store.activeId] : null;

  const create = (tid) => {
    const id = `p-${Date.now()}`; const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === tid);
    setStore(s => ({ activeId: id, projects: { ...s.projects, [id]: { id, name: `${tpl.name} draft`, templateId: tid, sections: {}, createdAt: Date.now() } } }));
  };
  const open = (id) => setStore(s => ({ ...s, activeId: id }));
  const close = () => setStore(s => ({ ...s, activeId: null }));
  const del = (id) => { if (!confirm("Delete this document?")) return; setStore(s => { const { [id]: _, ...rest } = s.projects; return { activeId: s.activeId === id ? null : s.activeId, projects: rest }; }); };

  // ---- Upload & store documents -------------------------------------------
  const fileRef = React.useRef(null);
  const [busy, setBusy] = useSV("");
  const [uploadErr, setUploadErr] = useSV("");
  const extOf = (n) => (n.split(".").pop() || "").toLowerCase();
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });
  const addDoc = (proj) => setStore(s => ({ activeId: proj.id, projects: { ...s.projects, [proj.id]: proj } }));

  const onUpload = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = ""; setUploadErr("");
    for (const file of files) {
      const ext = extOf(file.name);
      const base = { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: file.name.replace(/\.[^.]+$/, ""), uploaded: true, fileName: file.name, mime: file.type, size: file.size, createdAt: Date.now() };
      try {
        if (ext === "pdf") {
          const dataUrl = await readAs(file, "readAsDataURL");
          try { addDoc({ ...base, kind: "pdf", dataUrl }); }
          catch (err) { setUploadErr("That PDF is too large to store in the browser demo."); }
        } else if (ext === "docx" && window.mammoth) {
          setBusy(file.name);
          const arrayBuffer = await readAs(file, "readAsArrayBuffer");
          let text = "";
          try { const r = await window.mammoth.extractRawText({ arrayBuffer }); text = (r.value || "").trim(); } catch (err) { text = ""; }
          setBusy("");
          addDoc({ ...base, kind: "docx", content: text, converted: true });
        } else {
          // txt, md, rtf, csv, html, .doc fallback → editable text
          const text = await readAs(file, "readAsText");
          addDoc({ ...base, kind: "text", content: String(text || "") });
        }
      } catch (err) { setBusy(""); setUploadErr("Couldn't read that file — try a PDF, Word, or text file."); }
    }
  };
  const triggerUpload = () => fileRef.current && fileRef.current.click();
  const HiddenUpload = () => <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.html" style={{ display: "none" }} onChange={onUpload} />;

  // ---- Uploaded-document view (editable text / Word, or PDF viewer) --------
  if (active && active.uploaded) {
    const kindMeta = active.kind === "pdf" ? { icon: "FileText", label: "PDF" } : active.kind === "docx" ? { icon: "FileType2", label: "Word" } : { icon: "FileText", label: "Text" };
    const updContent = (v) => setStore(s => ({ ...s, projects: { ...s.projects, [active.id]: { ...s.projects[active.id], content: v } } }));
    const wc = (active.content || "").trim().split(/\s+/).filter(Boolean).length;
    return (
      <div className="page">
        <HiddenUpload />
        <div className="doc-tabs">
          {projects.map(p => { const ic = p.uploaded ? (p.kind === "docx" ? "FileType2" : "FileText") : ((window.DOC_TEMPLATES || []).find(t => t.id === p.templateId)?.icon || "FileText"); return <button key={p.id} className={`doc-tab ${p.id === active.id ? "active" : ""}`} onClick={() => open(p.id)}><IcoV name={ic} size={12} /> {p.name}</button>; })}
          <button className="doc-tab" onClick={close}><IcoV name="LayoutGrid" size={12} /> All documents</button>
        </div>
        <div className="step-head" style={{ marginBottom: 18 }}>
          <div className="step-num" style={{ fontSize: 18 }}><IcoV name={kindMeta.icon} size={22} color="#fff" /></div>
          <div style={{ flex: 1 }}>
            <input className="doc-title-input" value={active.name} onChange={e => setStore(s => ({ ...s, projects: { ...s.projects, [active.id]: { ...s.projects[active.id], name: e.target.value } } }))} />
            <div className="meta">
              <span className="chip"><IcoV name="Upload" size={12} /> Uploaded · {kindMeta.label}</span>
              <span className="chip">{active.fileName}</span>
              {active.kind === "pdf" ? <span className="chip">View only</span> : <span className="chip deliv-sat"><IcoV name="Pencil" size={12} /> Editable · {wc} words</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {active.dataUrl && <a className="btn sm" href={active.dataUrl} download={active.fileName}><IcoV name="Download" size={14} /> Download</a>}
            <button className="btn icon sm" onClick={() => del(active.id)} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
          </div>
        </div>
        {active.kind === "pdf" ? (
          <div className="doc-pdf-viewer"><iframe title={active.name} src={active.dataUrl} /></div>
        ) : (
          <div className="doc-editor">
            <div className="doc-page" style={{ gridColumn: "1 / -1" }}>
              {active.converted && <div className="doc-converted-note"><IcoV name="Info" size={13} /> Converted from Word — text is fully editable; original formatting was simplified. Your original is kept for download.</div>}
              <textarea className="doc-upload-edit" value={active.content || ""} onChange={e => updContent(e.target.value)} placeholder="This document is empty — start typing…" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (active) {
    const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === active.templateId);
    const secs = sectionsFor(active.templateId);
    const wc = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
    const total = secs.reduce((a, s) => a + wc(active.sections?.[s.id]), 0);
    const target = secs.reduce((a, s) => a + s.target, 0);
    const upd = (sid, v) => setStore(s => ({ ...s, projects: { ...s.projects, [active.id]: { ...s.projects[active.id], sections: { ...active.sections, [sid]: v } } } }));
    return (
      <div className="page">
        <div className="doc-tabs">
          {projects.map(p => { const t = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId); return <button key={p.id} className={`doc-tab ${p.id === active.id ? "active" : ""}`} onClick={() => open(p.id)}><IcoV name={t?.icon || "FileText"} size={12} /> {p.name}</button>; })}
          <button className="doc-tab" onClick={close}><IcoV name="LayoutGrid" size={12} /> All drafts</button>
        </div>
        <div className="step-head" style={{ marginBottom: 18 }}>
          <div className="step-num" style={{ fontSize: 18 }}><IcoV name={tpl.icon} size={22} color="#fff" /></div>
          <div style={{ flex: 1 }}>
            <input className="doc-title-input" value={active.name} onChange={e => setStore(s => ({ ...s, projects: { ...s.projects, [active.id]: { ...s.projects[active.id], name: e.target.value } } }))} />
            <div className="meta"><span className="chip">{tpl.name}</span><span className="chip">{total} / {target} words</span><span className="chip">~{Math.max(1, Math.round(total / 220))} min read</span></div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn sm"><IcoV name="Download" size={14} /> Export</button>
            <button className="btn icon sm" onClick={() => del(active.id)} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
          </div>
        </div>
        <div className="doc-editor">
          <aside className="doc-toc">
            <div className="doc-toc-l">On this page</div>
            {secs.map(s => { const w = wc(active.sections?.[s.id]); return <a key={s.id} className="doc-toc-link" href={`#dsec-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`dsec-${s.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><span>{s.name}</span>{w > 0 && <span className="cnt">{w}</span>}</a>; })}
          </aside>
          <div className="doc-page">
            <h1 className="display">{active.name}</h1>
            <div className="doc-page-meta">{total} words · {secs.length} sections</div>
            {secs.map(s => {
              const text = active.sections?.[s.id] || ""; const w = wc(text); const ok = s.target > 0 && w >= s.target * 0.7;
              return (
                <section key={s.id} id={`dsec-${s.id}`} className="doc-sec">
                  <h2>{s.name}</h2>
                  <textarea value={text} onChange={e => upd(s.id, e.target.value)} placeholder={`Start writing ${s.name.toLowerCase()}…`} />
                  <div className="doc-checks">
                    {s.target > 0 && <span className={`doc-check ${ok ? "ok" : ""}`}>{ok && <IcoV name="Check" size={10} />} {w} / {s.target} words</span>}
                    {/\d/.test(text) && <span className="doc-check ok"><IcoV name="Check" size={10} /> Has a number</span>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const templateDrafts = projects.filter(p => !p.uploaded);
  const uploadedDocs = projects.filter(p => p.uploaded);

  return (
    <div className="page">
      <HiddenUpload />
      <div className="greeting" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="display" style={{ fontSize: 26 }}>Documents</h1>
          <div className="sub">{projects.length > 0 ? `${projects.length} document${projects.length === 1 ? "" : "s"} stored.` : "Upload what your program sent you, or start from a template."}</div>
        </div>
        <button className="btn primary" onClick={triggerUpload}><IcoV name="Upload" size={15} color="#fff" /> Upload document</button>
      </div>

      {busy && <div className="search-state" style={{ marginBottom: 14 }}><IcoV name="Loader" size={16} className="spin" /> Reading &amp; converting <strong>&nbsp;{busy}&nbsp;</strong>…</div>}
      {uploadErr && <div className="doc-upload-err"><IcoV name="AlertTriangle" size={15} /> {uploadErr}</div>}

      {/* Drag-and-drop / empty-state dropzone */}
      <button className="doc-dropzone" onClick={triggerUpload}>
        <span className="doc-dz-ico"><IcoV name="UploadCloud" size={22} /></span>
        <span className="doc-dz-t">Upload a document</span>
        <span className="doc-dz-d">PDF, Word (.docx), or text. Word &amp; text files become editable; PDFs are stored for viewing.</span>
      </button>

      {uploadedDocs.length > 0 && (
        <>
          <div className="section-label"><span className="ic"><IcoV name="FolderOpen" size={13} /></span> Uploaded documents</div>
          <div className="doc-grid" style={{ marginBottom: 8 }}>
            {uploadedDocs.map(p => {
              const ic = p.kind === "docx" ? "FileType2" : p.kind === "pdf" ? "FileText" : "FileText";
              const tag = p.kind === "pdf" ? "PDF · view" : p.kind === "docx" ? "Word · editable" : "Text · editable";
              const w = p.kind !== "pdf" ? (p.content || "").trim().split(/\s+/).filter(Boolean).length : 0;
              return (
                <div key={p.id} className="doc-card" onClick={() => open(p.id)}>
                  <span className="doc-card-i"><IcoV name={ic} size={18} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="doc-card-n">{p.name}</div>
                    <div className="doc-card-d">{p.fileName}</div>
                    <div className="doc-card-meta">{tag}{p.kind !== "pdf" ? ` · ${w} words` : ""}</div>
                  </div>
                  <button className="doc-card-del" onClick={e => { e.stopPropagation(); del(p.id); }}><IcoV name="Trash2" size={13} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {templateDrafts.length > 0 && (
        <>
          <div className="section-label"><span className="ic"><IcoV name="History" size={13} /></span> Continue working</div>
          <div className="doc-grid" style={{ marginBottom: 8 }}>
            {templateDrafts.map(p => { const t = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId); if (!t) return null; const w = Object.values(p.sections || {}).reduce((a, x) => a + (x || "").trim().split(/\s+/).filter(Boolean).length, 0);
              return (
                <div key={p.id} className="doc-card" onClick={() => open(p.id)}>
                  <span className="doc-card-i"><IcoV name={t.icon} size={18} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="doc-card-n">{p.name}</div><div className="doc-card-d">{t.name} · {w} words</div></div>
                  <button className="doc-card-del" onClick={e => { e.stopPropagation(); del(p.id); }}><IcoV name="Trash2" size={13} /></button>
                </div>
              ); })}
          </div>
        </>
      )}

      <div className="section-label"><span className="ic"><IcoV name="FilePlus2" size={13} /></span> {templateDrafts.length > 0 ? "Start a new draft" : "Or start from a template"}</div>
      <div className="doc-grid">
        {(window.DOC_TEMPLATES || []).map(t => (
          <button key={t.id} className="doc-card" onClick={() => create(t.id)}>
            <span className="doc-card-i"><IcoV name={t.icon} size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}><div className="doc-card-n">{t.name}</div><div className="doc-card-d">{t.desc}</div><div className="doc-card-meta">{t.sections} sections · {t.mode}</div></div>
          </button>
        ))}
      </div>
    </div>
  );
}

window.CoachInsights = CoachInsights;
window.CoachWorkspace = CoachWorkspace;
window.CoachDocuments = CoachDocuments;
