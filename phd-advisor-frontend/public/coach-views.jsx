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
// ============================================================================
// INSIGHTS — the system brain. Everything the app learns (chat, documents,
// meetings, defense practice, wellbeing) feeds the knowledge markdown; this
// page analyzes it into three focus areas — quality of work, mental
// wellbeing, timeline progress — with live charts from the student's own data.
// ============================================================================

// 14-day mood & stress lines. Two series → legend + direct end labels, hover
// crosshair with tooltip, and a table view; colors are validated CVD-safe
// pairs set per theme via --chart-a/--chart-b.
function InsMoodChart({ recent }) {
  const [hover, setHover] = React.useState(null);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const c = (recent || []).find(x => x.date === key);
    days.push({ key, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), mood: c ? c.mood : null, stress: c ? c.stress : null });
  }
  const has = days.some(d => d.mood != null);
  if (!has) return <div className="ins-chart-empty">No check-ins yet — log a few on the Wellbeing page and this chart comes alive.</div>;
  const W = 340, H = 120, PL = 18, PR = 44, PT = 8, PB = 18;
  const x = (i) => PL + (i / 13) * (W - PL - PR);
  const y = (v) => PT + (1 - (v - 1) / 4) * (H - PT - PB);
  const path = (get) => {
    let out = "", pen = false;
    days.forEach((d, i) => {
      const v = get(d);
      if (v == null) { pen = false; return; }
      out += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return out.trim();
  };
  const lastIdx = days.map((d, i) => (d.mood != null ? i : -1)).filter(i => i >= 0).pop();
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width * W;
    let best = null, bd = 1e9;
    days.forEach((d, i) => { if (d.mood == null) return; const dist = Math.abs(x(i) - rel); if (dist < bd) { bd = dist; best = i; } });
    setHover(best);
  };
  return (
    <div className="ins-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mood and stress, last 14 days" onMouseMove={onMove}>
        {[1, 3, 5].map(v => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="ins-grid" />
            <text x={PL - 4} y={y(v) + 3} className="ins-axis" textAnchor="end">{v}</text>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} className="ins-cross" />}
        <path d={path(d => d.mood)} fill="none" stroke="var(--chart-a)" strokeWidth="2" strokeLinecap="round" />
        <path d={path(d => d.stress)} fill="none" stroke="var(--chart-b)" strokeWidth="2" strokeLinecap="round" />
        {days.map((d, i) => d.mood != null && (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.mood)} r={hover === i ? 4 : 2.5} fill="var(--chart-a)" stroke="var(--surface)" strokeWidth="1.5" />
            <circle cx={x(i)} cy={y(d.stress)} r={hover === i ? 4 : 2.5} fill="var(--chart-b)" stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        ))}
        {lastIdx != null && (
          <>
            <text x={x(lastIdx) + 6} y={y(days[lastIdx].mood) + 3} className="ins-endlabel" style={{ fill: "var(--chart-a)" }}>Mood</text>
            <text x={x(lastIdx) + 6} y={y(days[lastIdx].stress) + 3} className="ins-endlabel" style={{ fill: "var(--chart-b)" }}>Stress</text>
          </>
        )}
      </svg>
      {hover != null && days[hover].mood != null && (
        <div className="ins-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{days[hover].label}</strong> · mood {days[hover].mood}/5 · stress {days[hover].stress}/5
        </div>
      )}
      <div className="ins-legend">
        <span><i className="ins-swatch" style={{ background: "var(--chart-a)" }} /> Mood</span>
        <span><i className="ins-swatch" style={{ background: "var(--chart-b)" }} /> Stress</span>
        <span className="ins-legend-n">1 = rough/calm · 5 = great/overwhelmed</span>
      </div>
      <details className="ins-table">
        <summary>View data</summary>
        <table><thead><tr><th>Day</th><th>Mood</th><th>Stress</th></tr></thead><tbody>
          {days.filter(d => d.mood != null).map(d => <tr key={d.key}><td>{d.label}</td><td>{d.mood}</td><td>{d.stress}</td></tr>)}
        </tbody></table>
      </details>
    </div>
  );
}

// Per-phase task completion — single measure, single hue, value labels in ink.
function InsPhaseBars({ phases }) {
  const rows = (phases || []).filter(p => p.tasksTotal > 0);
  if (!rows.length) return <div className="ins-chart-empty">No plan tasks yet — build out My Plan to track pace here.</div>;
  return (
    <div className="ins-bars">
      {rows.map(p => {
        const pct = Math.round((p.tasksDone / p.tasksTotal) * 100);
        return (
          <div key={p.phase} className="ins-bar-row" title={`${p.phase}: ${p.tasksDone} of ${p.tasksTotal} tasks done`}>
            <span className="ins-bar-l">{p.phase}</span>
            <span className="ins-bar-track"><span className="ins-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} /></span>
            <span className="ins-bar-v">{p.tasksDone}/{p.tasksTotal}</span>
          </div>
        );
      })}
    </div>
  );
}

function CoachInsights({ onNav, roadmap, doneTasks }) {
  const authed = window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed();
  const [brain, setBrain] = useSV(null);
  const [busy, setBusy] = useSV(true);
  const [wellness, setWellness] = useSV(null);
  const [docs, setDocs] = useSV([]);
  const [knowledge, setKnowledge] = useSV(null);
  const [mdDraft, setMdDraft] = useSV(null); // non-null → editing
  const [mdSaved, setMdSaved] = useSV(false);

  const planContext = () => {
    const steps = (roadmap && roadmap.steps) || [];
    const phases = {};
    steps.forEach(s => {
      const p = s.phase || "Plan";
      phases[p] = phases[p] || { phase: p, done: 0, total: 0, tasksDone: 0, tasksTotal: 0 };
      phases[p].total++;
      if (s.status === "done") phases[p].done++;
      const subs = s.subtasks || [];
      phases[p].tasksTotal += subs.length;
      phases[p].tasksDone += subs.filter(t => doneTasks && doneTasks.has(`${s.id}::${t}`)).length;
    });
    const cur = steps.find(s => s.status === "current" || s.status === "redo");
    return {
      plan: {
        program: (roadmap && roadmap.program && roadmap.program.name) || "",
        total_steps: steps.length,
        done_steps: steps.filter(s => s.status === "done").length,
        current: cur ? cur.title : "",
        phases: Object.values(phases),
      },
    };
  };
  const ctx = planContext();
  const phases = ctx.plan.phases;
  const tasksDone = phases.reduce((a, p) => a + p.tasksDone, 0);
  const tasksTotal = phases.reduce((a, p) => a + p.tasksTotal, 0);
  const libraryWords = docs.reduce((a, d) => a + (d.word_count || 0), 0);

  const load = async (force) => {
    setBusy(true);
    if (authed) {
      try {
        const [w, d, k] = await Promise.all([
          window.CoachAPI.wellnessSummary().catch(() => null),
          window.CoachAPI.listLibraryDocs().catch(() => null),
          window.CoachAPI.getKnowledge().catch(() => null),
        ]);
        if (w) setWellness(w);
        if (d) setDocs(d.documents || []);
        if (k) setKnowledge(k);
        setBrain(await window.CoachAPI.insightsBrain(planContext(), !!force));
      } catch (e) {}
    }
    setBusy(false);
  };
  useEV(() => { load(false); }, []);

  const saveMd = async () => {
    try {
      const k = await window.CoachAPI.saveKnowledge(mdDraft);
      setKnowledge(k); setMdDraft(null); setMdSaved(true);
      setTimeout(() => setMdSaved(false), 2500);
    } catch (e) {}
  };

  const FOCUS_META = [
    { key: "work", icon: "PenTool", label: "Quality of work", sub: "Is it what you want it to be?" },
    { key: "mental", icon: "Heart", label: "Mental wellbeing", sub: "Are you doing OK?" },
    { key: "timeline", icon: "TrendingUp", label: "Timeline & progress", sub: "Faster, or smarter?" },
  ];
  const focus = (brain && brain.focus) || {};

  return (
    <div className="page">
      <div className="greeting" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="display" style={{ fontSize: 26 }}>Insights</h1>
          <div className="sub">The system brain — analyzing everything from every tab into what it means for you.</div>
        </div>
        <button className="btn primary sm" disabled={busy || !authed} onClick={() => load(true)}>
          <IcoV name={busy ? "Loader" : "RefreshCw"} size={14} color="#fff" className={busy ? "spin" : ""} /> {busy ? "Analyzing…" : "Regenerate"}
        </button>
      </div>

      {!authed && <div className="doc-upload-err"><IcoV name="WifiOff" size={15} /> Sign in with the backend running to generate insights — charts below still use this device's data.</div>}

      <div className="ins-focus-grid">
        {FOCUS_META.map(f => {
          const sec = focus[f.key] || {};
          return (
            <div key={f.key} className="ins-focus">
              <div className="ins-focus-h">
                <span className="ins-focus-ico"><IcoV name={f.icon} size={15} /></span>
                <div><div className="ins-focus-l">{f.label}</div><div className="ins-focus-s">{f.sub}</div></div>
              </div>
              {busy && !sec.narrative ? (
                <div className="ins-chart-empty"><IcoV name="Loader" size={13} className="spin" /> Reading everything…</div>
              ) : (
                <>
                  {sec.headline && <div className="ins-focus-head">{sec.headline}</div>}
                  {sec.narrative && <p className="ins-focus-n">{sec.narrative}</p>}
                  {(sec.suggestions || []).length > 0 && (
                    <ul className="ins-focus-sug">{sec.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  )}
                </>
              )}
              {f.key === "mental" && <InsMoodChart recent={(wellness && wellness.recent) || []} />}
              {f.key === "timeline" && <InsPhaseBars phases={phases} />}
              {f.key === "work" && (
                <div className="ins-tiles">
                  <div className="ins-tile"><span className="ins-tile-n">{ctx.plan.done_steps}<em>/{ctx.plan.total_steps}</em></span><span className="ins-tile-l">Milestones done</span></div>
                  <div className="ins-tile"><span className="ins-tile-n">{tasksDone}<em>/{tasksTotal}</em></span><span className="ins-tile-l">Tasks done</span></div>
                  <div className="ins-tile"><span className="ins-tile-n">{docs.length}</span><span className="ins-tile-l">Documents analyzed</span></div>
                  <div className="ins-tile"><span className="ins-tile-n">{libraryWords >= 1000 ? `${Math.round(libraryWords / 1000)}k` : libraryWords}</span><span className="ins-tile-l">Words in your library</span></div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- The brain itself: the knowledge markdown, viewable and editable */}
      <div className="section-label" style={{ marginTop: 20 }}><span className="ic"><IcoV name="BrainCircuit" size={13} /></span> What the system knows</div>
      <div className="ins-brain">
        <div className="ins-brain-meta">
          <span className="ins-brain-d">Notes accumulate here automatically from every tab — this exact text is what your chat advisors read.</span>
          <div className="ins-brain-feeds">
            {[["MessageCircle", "Chat"], ["FileText", "Documents"], ["Users", "Meetings"], ["Presentation", "Defense practice"], ["Heart", "Wellbeing"]].map(([ic, l]) => (
              <span key={l} className="chip"><IcoV name={ic} size={11} /> {l}</span>
            ))}
          </div>
        </div>
        {mdDraft != null ? (
          <>
            <textarea className="ins-brain-edit" value={mdDraft} onChange={e => setMdDraft(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn sm primary" onClick={saveMd}><IcoV name="Save" size={13} color="#fff" /> Save</button>
              <button className="btn sm" onClick={() => setMdDraft(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {knowledge && (knowledge.markdown || "").trim()
              ? <pre className="doc-knowledge-md" style={{ maxHeight: 420 }}>{knowledge.markdown}</pre>
              : <div className="ins-chart-empty">Nothing recorded yet — chat, upload a document, log a meeting or a check-in, and notes start appearing here.</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              {knowledge && (knowledge.markdown || "").trim() && <button className="btn sm" onClick={() => setMdDraft(knowledge.markdown)}><IcoV name="Pencil" size={13} /> Edit notes</button>}
              {mdSaved && <span className="chip deliv-sat"><IcoV name="Check" size={12} /> Saved — advisors see this immediately</span>}
              {knowledge && knowledge.updated_at && <span className="ins-brain-t">Updated {new Date(knowledge.updated_at).toLocaleString()}</span>}
            </div>
          </>
        )}
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

// `embedded` renders one white "Tools" box on the Home page (its own row) that
// holds up to three widgets. Non-embedded is the full standalone Workspace page.
// Both share the WS_KEY store, so it's one workspace.
function CoachWorkspace({ roadmap, embedded }) {
  const [layout, setLayout] = useSV(() => HV.loadJSON(WS_KEY, []));
  const [paletteOpen, setPaletteOpen] = useSV(false);
  const [wsPage, setWsPage] = useSV(0);
  useEV(() => HV.saveJSON(WS_KEY, layout), [layout]);

  const EMBED_MAX = 3;
  const addWidget = (type) => setLayout(p => [...p, { id: `w-${type}-${Date.now()}`, type, size: "M" }]);
  const applyPreset = (preset) => setLayout(preset.layout.map((type, i) => ({ id: `w-${type}-${Date.now()}-${i}`, type, size: "M" })));
  const remove = (id) => setLayout(p => p.filter(w => w.id !== id));
  const cycle = (id) => setLayout(p => p.map(w => w.id === id ? { ...w, size: w.size === "S" ? "M" : w.size === "M" ? "L" : "S" } : w));

  const curStep = roadmap?.steps?.find(s => s.status === "current");
  const suggested = wsSuggestFor(roadmap);
  const palette = paletteOpen && <WidgetPalette onClose={() => setPaletteOpen(false)} onAdd={(t) => { addWidget(t); setPaletteOpen(false); }} suggested={suggested} stepTitle={curStep?.title} />;

  const widgetCard = (w) => {
    const isCustom = w.type === "custom";
    const def = isCustom
      ? { type: "custom", name: w.custom?.title || "Custom tool", icon: "Wand2" }
      : (window.WIDGET_CATALOG || []).find(d => d.type === w.type);
    if (!def) return null;
    return (
      <div key={w.id} className={`ws-widget size-${w.size} ${def.critic ? "critic" : ""}`}>
        <div className="ws-w-head">
          <span className="ws-w-ico"><IcoV name={def.icon} size={14} /></span>
          <span className="ws-w-title">{def.name}{isCustom && <span className="ws-custom-tag">custom</span>}</span>
          <button className="ws-size" onClick={() => cycle(w.id)} title="Resize: S = 3 per row, M = 2, L = full row">{w.size}</button>
          <button className="ws-w-del" onClick={() => remove(w.id)} aria-label={`Remove ${def.name}`}><IcoV name="Trash2" size={13} /></button>
        </div>
        <div className="ws-w-body">{isCustom ? (window.CustomTool ? <window.CustomTool inst={w.custom} /> : null) : <WidgetBody def={def} seed={w.seed} />}</div>
      </div>
    );
  };

  // Home: one white Tools box, three widgets per page — paginate the rest.
  if (embedded) {
    const pages = Math.max(1, Math.ceil(layout.length / EMBED_MAX));
    const curPage = Math.min(wsPage, pages - 1);
    const shown = layout.slice(curPage * EMBED_MAX, curPage * EMBED_MAX + EMBED_MAX);
    return (
      <section className="ws-embed">
        <div className="card card-pad ws-tools-box">
          <div className="ws-embed-head">
            <div className="card-h" style={{ margin: 0 }}><span className="ico"><IcoV name="Wrench" size={14} /></span> Tools{layout.length ? ` · ${layout.length}` : ""}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {pages > 1 && (
                <>
                  <button className="btn icon sm" disabled={curPage === 0} onClick={() => setWsPage(curPage - 1)} aria-label="Previous tools"><IcoV name="ChevronLeft" size={14} /></button>
                  <span className="ws-page-n">{curPage + 1}/{pages}</span>
                  <button className="btn icon sm" disabled={curPage >= pages - 1} onClick={() => setWsPage(curPage + 1)} aria-label="More tools"><IcoV name="ChevronRight" size={14} /></button>
                </>
              )}
              {layout.length > 0 && <button className="btn sm" onClick={() => { setLayout([]); setWsPage(0); }}><IcoV name="Eraser" size={14} /> Clear</button>}
              <button className="btn primary sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} color="#fff" /> Add widget</button>
            </div>
          </div>
          {shown.length === 0
            ? <button className="ws-tools-empty" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={18} /> Add tools for this step</button>
            : <div className="ws-grid">{shown.map(widgetCard)}</div>}
          {pages > 1 && (
            <div className="jn2-dots" role="tablist" aria-label="Tool pages">
              {Array.from({ length: pages }).map((_, p) => (
                <button key={p} className={`jn2-dot ${p === curPage ? "on" : ""}`} onClick={() => setWsPage(p)} aria-label={`Tools page ${p + 1}`} />
              ))}
            </div>
          )}
        </div>
        {palette}
      </section>
    );
  }

  // Standalone page: presets + unlimited widgets.
  if (layout.length === 0) {
    return (
      <div className="page">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Workspace</h1>
          <div className="sub">Your <strong>tools</strong> live here. The boards, trackers, and notes your <strong>Skills</strong> and My Plan produce, with the same data everywhere.</div>
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
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>Or build your own</span>
          <button className="btn sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} /> Add a widget</button>
        </div>
        {palette}
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
      <div className="ws-grid">{layout.map(widgetCard)}</div>
      {palette}
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
      return window.DeadlinesTool ? <window.DeadlinesTool /> : null;
    case "grants":
      return window.FundingTool ? <window.FundingTool /> : null;
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="widget-palette-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-h">
          <div><h2 className="display" id="widget-palette-title">Add a widget</h2><p>Widgets share data with the tools in My Plan.</p></div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IcoV name="X" size={14} /></button>
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
                  <input placeholder="Search widgets…" aria-label="Search widgets" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
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
  "meeting-prep": [["agenda", "Agenda", 80], ["progress", "Progress since last", 200], ["blockers", "Blockers", 150], ["decisions", "Decisions needed", 200], ["questions", "Questions", 150], ["followup", "Action items", 100]],
  "idp": [["goals", "Goals (1–3 years)", 200], ["skills", "Skills to develop", 200], ["milestones", "Milestones & timeline", 200], ["mentoring", "Mentoring & support plan", 150], ["career", "Career objectives", 150], ["review", "Review cadence", 80]],
  "advisor-compact": [["meeting", "Meeting cadence & communication", 150], ["advisee", "What I commit to (advisee)", 200], ["advisor", "What my advisor commits to", 200], ["feedback", "Feedback & turnaround expectations", 150], ["authorship", "Authorship & data ownership", 150], ["conflict", "How we'll handle disagreements", 120]],
  "progress-report": [["summary", "Summary", 150], ["completed", "Completed since last review", 200], ["current", "In progress now", 150], ["blockers", "Blockers & risks", 150], ["next", "Next steps", 150], ["asks", "Asks for my committee", 100]]
};
function sectionsFor(id) {
  if (SECTIONS[id]) return SECTIONS[id].map(([sid, name, target]) => ({ id: sid, name, target }));
  const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === id);
  const n = tpl?.sections || 4;
  return Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, name: `Section ${i + 1}`, target: 300 }));
}

// ----------------------------------------------------------------------------
// DocRichText — TipTap-backed rich text editor with a plain-textarea fallback.
// Persisted value stays PLAIN TEXT (what the AI and server store); formatting
// is an in-session editing aid. Defined at module level so it isn't remounted
// on every parent render.
// ----------------------------------------------------------------------------
function DocRichText({ value, onChange, placeholder }) {
  const hostRef = React.useRef(null);
  const edRef = React.useRef(null);
  const lastEmitted = React.useRef(null);
  const [ready, setReady] = useSV(() => !!window.TipTap);
  const [, force] = useSV(0);

  useEV(() => {
    if (ready) return;
    const onReady = () => setReady(true);
    window.addEventListener("tiptap-ready", onReady);
    const poll = setInterval(() => { if (window.TipTap) { setReady(true); clearInterval(poll); } }, 400);
    const stop = setTimeout(() => clearInterval(poll), 8000);
    return () => { window.removeEventListener("tiptap-ready", onReady); clearInterval(poll); clearTimeout(stop); };
  }, [ready]);

  const toHtml = (t) => {
    const esc = (x) => String(x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const paras = String(t || "").split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    return paras || "<p></p>";
  };

  useEV(() => {
    if (!ready || !window.TipTap || !hostRef.current) return;
    const ed = new window.TipTap.Editor({
      element: hostRef.current,
      extensions: [window.TipTap.StarterKit],
      content: toHtml(value),
      onUpdate: ({ editor }) => {
        const text = editor.getText({ blockSeparator: "\n\n" });
        lastEmitted.current = text;
        onChange(text);
      },
      onTransaction: () => force(x => x + 1),
    });
    edRef.current = ed;
    return () => { try { ed.destroy(); } catch (e) {} edRef.current = null; };
  }, [ready]);

  // External value changes (e.g. server content finishing its load) → reset
  // the editor, but never for our own emissions.
  useEV(() => {
    const ed = edRef.current;
    if (!ed || value === lastEmitted.current) return;
    lastEmitted.current = value;
    try { ed.commands.setContent(toHtml(value), false); } catch (e) {}
  }, [value, ready]);

  if (!ready) {
    return <textarea className="doc-upload-edit" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />;
  }
  const ed = edRef.current;
  const can = (fn) => { try { return fn(); } catch (e) { return false; } };
  const B = ({ icon, title, onRun, active, disabled }) => (
    <button type="button" className={`docr-btn ${active ? "active" : ""}`} title={title} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={onRun}><IcoV name={icon} size={14} /></button>
  );
  return (
    <div className="docr">
      {ed && (
        <div className="docr-bar">
          <B icon="Bold" title="Bold" active={can(() => ed.isActive("bold"))} onRun={() => ed.chain().focus().toggleBold().run()} />
          <B icon="Italic" title="Italic" active={can(() => ed.isActive("italic"))} onRun={() => ed.chain().focus().toggleItalic().run()} />
          <span className="docr-sep" />
          <B icon="Heading1" title="Heading" active={can(() => ed.isActive("heading", { level: 2 }))} onRun={() => ed.chain().focus().toggleHeading({ level: 2 }).run()} />
          <B icon="Heading2" title="Subheading" active={can(() => ed.isActive("heading", { level: 3 }))} onRun={() => ed.chain().focus().toggleHeading({ level: 3 }).run()} />
          <span className="docr-sep" />
          <B icon="List" title="Bullet list" active={can(() => ed.isActive("bulletList"))} onRun={() => ed.chain().focus().toggleBulletList().run()} />
          <B icon="ListOrdered" title="Numbered list" active={can(() => ed.isActive("orderedList"))} onRun={() => ed.chain().focus().toggleOrderedList().run()} />
          <B icon="Quote" title="Quote" active={can(() => ed.isActive("blockquote"))} onRun={() => ed.chain().focus().toggleBlockquote().run()} />
          <span className="docr-sep" />
          <B icon="Undo2" title="Undo" disabled={!can(() => ed.can().undo())} onRun={() => ed.chain().focus().undo().run()} />
          <B icon="Redo2" title="Redo" disabled={!can(() => ed.can().redo())} onRun={() => ed.chain().focus().redo().run()} />
          <span className="docr-note">Formatting is a writing aid — saved content is plain text.</span>
        </div>
      )}
      <div ref={hostRef} className="docr-body" data-placeholder={placeholder || ""} />
    </div>
  );
}

function CoachDocuments({ roadmap }) {
  // ==========================================================================
  // Documents — rebuilt around three views:
  //   "all"     → every file, from every part of the app, in one place
  //   "preview" → read-only view of one file (PDF viewer / formatted text)
  //   "edit"    → the editor (extracted text, or sectioned draft editor)
  // Local store (localStorage) keeps offline copies + PDFs; the server library
  // (/api/library) is the source the AI reads, edits sync there when signed in.
  // ==========================================================================
  const [store, setStore] = useSV(() => HV.loadJSON(DOC_KEY, { projects: {}, activeId: null }));
  useEV(() => HV.saveJSON(DOC_KEY, store), [store]);
  const projects = Object.values(store.projects || {});

  const [mode, setMode] = useSV("all");     // all | preview | edit
  const [sel, setSel] = useSV(null);        // { type: "local" | "server", id }
  const [filter, setFilter] = useSV("all"); // all | uploads | tools | drafts
  const [q, setQ] = useSV("");

  const [serverDocs, setServerDocs] = useSV([]);
  const [serverFull, setServerFull] = useSV(null);
  const [saveState, setSaveState] = useSV("");
  const [comparing, setComparing] = useSV("");
  const [knowledge, setKnowledge] = useSV(null);
  const [knowledgeOpen, setKnowledgeOpen] = useSV(false);
  const [busy, setBusy] = useSV("");
  const [uploadErr, setUploadErr] = useSV("");
  const fileRef = React.useRef(null);
  const authed = window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed();

  // ---- server sync ---------------------------------------------------------
  const refreshServer = async () => {
    if (!authed) return;
    try { const r = await window.CoachAPI.listLibraryDocs(); setServerDocs((r && r.documents) || []); } catch (e) {}
  };
  const refreshKnowledge = async () => {
    if (!authed) return;
    try { setKnowledge(await window.CoachAPI.getKnowledge()); } catch (e) {}
  };
  useEV(() => { refreshServer(); refreshKnowledge(); }, []);
  useEV(() => {
    if (!serverDocs.some(d => d.analysis_status === "pending" || d.analysis_status === "analyzing")) return;
    const t = setTimeout(() => { refreshServer(); refreshKnowledge(); }, 5000);
    return () => clearTimeout(t);
  }, [serverDocs]);

  const serverByFile = useMV(() => { const m = {}; for (const d of serverDocs) m[d.filename] = d; return m; }, [serverDocs]);

  // ---- selection resolution ------------------------------------------------
  const localDoc = sel && sel.type === "local" ? (store.projects[sel.id] || null) : null;
  const serverMeta = sel && sel.type === "server"
    ? (serverDocs.find(d => d.id === sel.id) || null)
    : (localDoc && localDoc.uploaded ? serverByFile[localDoc.fileName] : null);

  useEV(() => {
    setServerFull(null); setSaveState(""); setComparing("");
    if (serverMeta && authed) window.CoachAPI.getLibraryDoc(serverMeta.id).then(setServerFull).catch(() => {});
  }, [sel && sel.type, sel && sel.id, serverDocs.length]);

  // Blob URL for the PDF preview — unlike a raw data: URL it honors the
  // viewer open-params (#navpanes=0) so the thumbnail rail stays hidden.
  const [pdfUrl, setPdfUrl] = useSV(null);
  useEV(() => {
    let created = null; let alive = true;
    const a = localDoc;
    if (a && a.uploaded && a.kind === "pdf" && a.dataUrl) {
      fetch(a.dataUrl).then(r => r.blob()).then(b => {
        if (!alive) return;
        created = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
        setPdfUrl(created);
      }).catch(() => { if (alive) setPdfUrl(null); });
    } else setPdfUrl(null);
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [sel && sel.id]);

  // Older PDF uploads were stored without their text layer — extract it lazily
  // on open so they become editable too.
  useEV(() => {
    const a = localDoc;
    if (!a || !a.uploaded || a.kind !== "pdf" || (a.content || "").trim() || !a.dataUrl || !window.extractTextFromFile) return;
    fetch(a.dataUrl)
      .then(r => r.blob())
      .then(b => window.extractTextFromFile(new File([b], a.fileName || "document.pdf", { type: "application/pdf" })))
      .then(r => {
        if (r && r.text) setStore(s => s.projects[a.id] ? ({ ...s, projects: { ...s.projects, [a.id]: { ...s.projects[a.id], content: r.text } } }) : s);
      })
      .catch(() => {});
  }, [sel && sel.id]);

  // ---- current-document view model ----------------------------------------
  const cur = (() => {
    if (!sel) return null;
    if (sel.type === "server") {
      const d = serverFull || serverMeta;
      if (!d) return null;
      return {
        type: "server", id: d.id, title: d.name || "", fileName: d.filename || "",
        kind: "text", source: d.source || "app", text: serverFull ? (serverFull.content || "") : "",
        loading: !serverFull, srv: serverFull || serverMeta
      };
    }
    const p = localDoc;
    if (!p) return null;
    if (!p.uploaded) {
      const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId);
      return { type: "draft", id: p.id, title: p.name || "", tpl, p, source: "draft" };
    }
    const text = p.kind === "pdf" ? (serverFull ? (serverFull.content || "") : (p.content || "")) : (p.content || "");
    return {
      type: "local", id: p.id, title: p.name || "", fileName: p.fileName || "",
      kind: p.kind, dataUrl: p.dataUrl, converted: p.converted, text,
      source: "documents", srv: serverFull || serverMeta
    };
  })();

  const wcOf = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;

  // ---- mutations -----------------------------------------------------------
  const updLocal = (id, patch) => setStore(s => s.projects[id] ? ({ ...s, projects: { ...s.projects, [id]: { ...s.projects[id], ...patch } } }) : s);
  const setTitle = (v) => {
    if (!cur) return;
    if (cur.type === "server") setServerFull(f => f ? { ...f, name: v } : f);
    else updLocal(cur.id, { name: v });
  };
  const setText = (v) => {
    if (!cur) return;
    if (cur.type === "server") setServerFull(f => f ? { ...f, content: v } : f);
    else if (cur.kind === "pdf" && serverFull) setServerFull(f => ({ ...f, content: v }));
    else updLocal(cur.id, { content: v });
  };
  const saveToServer = async ({ reanalyze = false } = {}) => {
    if (!authed || !cur || !cur.srv || !cur.srv.id) return;
    setSaveState("saving");
    try {
      const content = (cur.type === "server" || (cur.kind === "pdf" && serverFull))
        ? ((serverFull && serverFull.content) || "")
        : cur.text;
      const d = await window.CoachAPI.saveLibraryDoc(cur.srv.id, { name: cur.title, content, reanalyze });
      setSaveState("saved");
      if (d) setServerFull(f => (f ? { ...f, ...d } : d));
      refreshServer();
      setTimeout(() => setSaveState(""), 2500);
    } catch (e) { setSaveState("error"); }
  };
  const delCurrent = () => {
    if (!cur || !confirm("Delete this document?")) return;
    if (cur.type !== "server") {
      setStore(s => { const { [cur.id]: _, ...rest } = s.projects; return { ...s, activeId: null, projects: rest }; });
    }
    const srvId = cur.type === "server" ? cur.id : (cur.srv && cur.srv.id);
    if (srvId && authed) window.CoachAPI.deleteLibraryDoc(srvId).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    setSel(null); setMode("all");
  };
  const delFromCard = (card) => {
    if (!confirm("Delete this document?")) return;
    if (card.ref.type === "local") {
      const p = store.projects[card.ref.id];
      setStore(s => { const { [card.ref.id]: _, ...rest } = s.projects; return { ...s, activeId: null, projects: rest }; });
      const twin = p && p.uploaded && serverByFile[p.fileName];
      if (twin && authed) window.CoachAPI.deleteLibraryDoc(twin.id).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    } else if (authed) {
      window.CoachAPI.deleteLibraryDoc(card.ref.id).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    }
  };

  const openPreview = (ref) => { setSel(ref); setMode("preview"); };
  const openEdit = (ref) => { setSel(ref); setMode("edit"); };
  const backToAll = () => { setSel(null); setMode("all"); };

  const createDraft = (tid) => {
    const id = `p-${Date.now()}`;
    const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === tid);
    if (!tpl) return;
    setStore(s => ({ ...s, projects: { ...s.projects, [id]: { id, name: `${tpl.name} draft`, templateId: tid, sections: {}, createdAt: Date.now() } } }));
    setSel({ type: "local", id }); setMode("edit");
  };

  // ---- upload --------------------------------------------------------------
  const extOf = (n) => (n.split(".").pop() || "").toLowerCase();
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });
  const ingestFiles = async (files) => {
    setUploadErr("");
    for (const file of files) {
      const ext = extOf(file.name);
      const base = { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: file.name.replace(/\.[^.]+$/, ""), uploaded: true, fileName: file.name, mime: file.type, size: file.size, createdAt: Date.now() };
      try {
        if (ext === "pdf") {
          setBusy(file.name);
          const dataUrl = await readAs(file, "readAsDataURL");
          let text = "";
          try { const r = window.extractTextFromFile && await window.extractTextFromFile(file); text = (r && r.text) || ""; } catch (err) {}
          setBusy("");
          try { setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "pdf", dataUrl, content: text } } })); }
          catch (err) { setUploadErr("That PDF is too large to store in the browser demo."); }
        } else if (ext === "docx" || ext === "doc") {
          setBusy(file.name);
          const dataUrl = await readAs(file, "readAsDataURL");
          let text = "";
          if (ext === "docx" && window.mammoth) {
            const arrayBuffer = await readAs(file, "readAsArrayBuffer");
            try { const r = await window.mammoth.extractRawText({ arrayBuffer }); text = (r.value || "").trim(); } catch (err) { text = ""; }
          }
          setBusy("");
          setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "docx", content: text, rawDataUrl: dataUrl, converted: Boolean(text) } } }));
        } else {
          const text = await readAs(file, "readAsText");
          setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "text", content: String(text || "") } } }));
        }
      } catch (err) { setBusy(""); setUploadErr("Couldn't read that file — try a PDF, Word, or text file."); }
      // Mirror into the server library so the AI can analyze it. Best-effort.
      if (authed) window.CoachAPI.uploadLibraryDoc({ file, source: "documents" }).then(() => refreshServer()).catch(() => {});
    }
  };
  const ingestRef = React.useRef(null);
  ingestRef.current = ingestFiles;
  const onUpload = (e) => { const files = [...(e.target.files || [])]; e.target.value = ""; ingestFiles(files); };
  const triggerUpload = () => fileRef.current && fileRef.current.click();
  const HiddenUpload = () => <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.html" style={{ display: "none" }} onChange={onUpload} />;

  // Uppy dashboard modal as the upload UI. Files it collects run through the
  // same ingest pipeline; the hidden input stays as the fallback picker.
  const uppyRef = React.useRef(null);
  useEV(() => {
    if (!window.Uppy || !window.Uppy.Uppy || !window.Uppy.Dashboard) return;
    const uppy = new window.Uppy.Uppy({
      autoProceed: false,
      restrictions: {
        maxFileSize: 10 * 1024 * 1024,
        allowedFileTypes: [".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".csv", ".html"],
      },
    });
    uppy.use(window.Uppy.Dashboard, {
      inline: false,
      closeModalOnClickOutside: true,
      closeAfterFinish: false,
      hideUploadButton: true,
      proudlyDisplayPoweredByUppy: false,
      theme: "auto",
      note: "PDF, Word, or text · up to 10MB · files are added the moment you drop them",
    });
    uppy.on("file-added", (f) => {
      if (ingestRef.current && f && f.data) ingestRef.current([f.data]);
      setTimeout(() => { try { uppy.removeFile(f.id); } catch (e) {} }, 800);
    });
    uppyRef.current = uppy;
    return () => { try { (uppy.destroy || uppy.close).call(uppy); } catch (e) {} uppyRef.current = null; };
  }, []);
  const openUploader = () => {
    const u = uppyRef.current;
    if (u) { const d = u.getPlugin("Dashboard"); if (d) { d.openModal(); return; } }
    triggerUpload();
  };

  // ---- exports -------------------------------------------------------------
  // Word-compatible HTML .doc — opens directly in Google Docs and Word.
  const downloadForDocs = (name, text) => {
    const esc = (x) => String(x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const paras = String(text || "").split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(name)}</title></head><body><h1>${esc(name)}</h1>${paras}</body></html>`;
    const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(name || "document").replace(/[\\/:*?"<>|]/g, "-")}.doc`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const draftText = (p) => sectionsFor(p.templateId).map(s => `${s.name}\n\n${p.sections?.[s.id] || ""}`).join("\n\n");

  // ---- AI panel + comparison ----------------------------------------------
  const runCompare = async (srv) => {
    setComparing("busy");
    try {
      const c = await window.CoachAPI.compareLibraryDoc(srv.id);
      setComparing("");
      setServerFull(f => (f && f.id === srv.id ? { ...f, comparison: c } : f));
      refreshServer(); refreshKnowledge();
    } catch (e) { setComparing(e && e.status === 404 ? "none" : "error"); setTimeout(() => setComparing(""), 3500); }
  };
  const statusChip = (srv) => {
    if (!srv) return null;
    const st = srv.analysis_status;
    if (st === "pending" || st === "analyzing") return <span className="chip"><IcoV name="Loader" size={12} className="spin" /> AI analyzing…</span>;
    if (st === "done") return <span className="chip deliv-sat"><IcoV name="Sparkles" size={12} /> AI summary ready</span>;
    if (st === "failed") return <span className="chip"><IcoV name="AlertTriangle" size={12} /> Analysis failed</span>;
    return null;
  };
  const saveChip = saveState === "saving" ? <span className="chip"><IcoV name="Loader" size={12} className="spin" /> Saving…</span>
    : saveState === "saved" ? <span className="chip deliv-sat"><IcoV name="Check" size={12} /> Saved</span>
    : saveState === "error" ? <span className="chip"><IcoV name="AlertTriangle" size={12} /> Save failed</span> : null;
  const AiPanel = ({ srv }) => {
    if (!srv) return null;
    const a = srv.analysis;
    const cmp = srv.comparison;
    const aiBusy = srv.analysis_status === "pending" || srv.analysis_status === "analyzing";
    return (
      <div className="doc-ai-panel">
        <div className="doc-ai-head">
          <span className="doc-ai-t"><IcoV name="Sparkles" size={14} /> AI insights</span>
          {statusChip(srv)}
          {!aiBusy && authed && (
            <button className="btn sm" onClick={() => runCompare(srv)} disabled={comparing === "busy"}>
              <IcoV name={comparing === "busy" ? "Loader" : "GitCompare"} size={13} className={comparing === "busy" ? "spin" : ""} /> Compare versions
            </button>
          )}
          {!aiBusy && authed && (
            <button className="btn sm" onClick={() => window.CoachAPI.analyzeLibraryDoc(srv.id).then(refreshServer).catch(() => {})}>
              <IcoV name="RefreshCw" size={13} /> Re-analyze
            </button>
          )}
        </div>
        {comparing === "none" && <div className="doc-ai-empty" style={{ marginBottom: 8 }}>No earlier version of this document was found to compare against.</div>}
        {comparing === "error" && <div className="doc-ai-empty" style={{ marginBottom: 8 }}>Comparison failed — try again in a moment.</div>}
        {cmp && cmp.is_same_document && (
          <div className="doc-cmp">
            <div className="doc-ai-l"><IcoV name="GitCompare" size={12} /> What changed vs {cmp.against_filename}</div>
            {cmp.summary && <p className="doc-ai-summary">{cmp.summary}</p>}
            {(cmp.changes || []).length === 0 && <div className="doc-ai-empty">No substantive differences between the two versions.</div>}
            {(cmp.changes || []).map((c, i) => (
              <div key={i} className="doc-cmp-change">
                <span className="doc-cmp-area">{c.area}</span>
                <span className="doc-cmp-what">{c.change}{c.impact ? <em> — {c.impact}</em> : null}</span>
              </div>
            ))}
            <div className="doc-cmp-note"><IcoV name="MessageCircle" size={12} /> Your chat advisors know these changes — ask "what changed in my handbook?"</div>
          </div>
        )}
        {aiBusy && <div className="doc-ai-empty">Reading the document, following its links, and updating what your coach knows about you…</div>}
        {!aiBusy && !a && <div className="doc-ai-empty">No analysis yet — hit re-analyze to have the AI read this document.</div>}
        {a && (
          <>
            {a.summary && <p className="doc-ai-summary">{a.summary}</p>}
            {(a.key_points || []).length > 0 && (
              <ul className="doc-ai-points">{a.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            )}
            {(a.link_insights || []).length > 0 && (
              <div className="doc-ai-links">
                <div className="doc-ai-l">Links the AI followed</div>
                {a.link_insights.map((li, i) => (
                  <div key={i} className="doc-ai-link"><a href={li.url} target="_blank" rel="noreferrer">{li.url}</a><span>{li.takeaway}</span></div>
                ))}
              </div>
            )}
            {(a.topics || []).length > 0 && (
              <div className="meta" style={{ marginTop: 8 }}>{a.topics.map((t, i) => <span key={i} className="chip">{t}</span>)}</div>
          )}
          </>
        )}
      </div>
    );
  };

  // ---- shared header pieces ------------------------------------------------
  const kindLabel = (kind) => kind === "pdf" ? "PDF" : kind === "docx" ? "Word" : kind === "draft" ? "Draft" : "Text";
  const kindIcon = (kind) => kind === "docx" ? "FileType2" : kind === "draft" ? "PenLine" : "FileText";
  const ModeTabs = () => (
    <div className="doc-mode-tabs">
      <button className="doc-mode-tab" onClick={backToAll}><IcoV name="LayoutGrid" size={13} /> All files</button>
      <button className={`doc-mode-tab ${mode === "preview" ? "active" : ""}`} onClick={() => setMode("preview")}><IcoV name="Eye" size={13} /> Preview</button>
      <button className={`doc-mode-tab ${mode === "edit" ? "active" : ""}`} onClick={() => setMode("edit")}><IcoV name="Pencil" size={13} /> Edit</button>
    </div>
  );

  // ==========================================================================
  // PREVIEW — read-only
  // ==========================================================================
  if (cur && mode === "preview") {
    const text = cur.type === "draft" ? "" : cur.text;
    const exportText = cur.type === "draft" ? draftText(cur.p) : text;
    return (
      <div className="page">
        <HiddenUpload />
        <div className="docv-bar">
          <div className="doc-mode-tabs" style={{ margin: 0 }}>
            <button className="doc-mode-tab" onClick={backToAll}><IcoV name="LayoutGrid" size={13} /> All files</button>
            <button className="doc-mode-tab active"><IcoV name="Eye" size={13} /> Preview</button>
            <button className="doc-mode-tab" onClick={() => setMode("edit")}><IcoV name="Pencil" size={13} /> Edit</button>
          </div>
          <span className="docv-bar-ico"><IcoV name={kindIcon(cur.type === "draft" ? "draft" : cur.kind)} size={15} color="#fff" /></span>
          <div className="docv-bar-t">
            <span className="docv-bar-name">{cur.title}</span>
            <span className="docv-bar-meta">
              {kindLabel(cur.type === "draft" ? "draft" : cur.kind)}
              {cur.fileName ? ` · ${cur.fileName}` : ""}
              {cur.type === "server" ? ` · from ${cur.source}` : ""}
              {cur.type === "draft" && cur.tpl ? ` · ${cur.tpl.name}` : ""}
              {` · ${wcOf(exportText)} words`}
              {cur.srv && cur.srv.comparison && cur.srv.comparison.is_same_document ? " · ↻ newer version" : ""}
            </span>
          </div>
          <div className="docv-bar-acts">
            {exportText.trim() && <button className="btn sm" onClick={() => downloadForDocs(cur.title, exportText)} title="Downloads a .doc that opens in Google Docs or Word"><IcoV name="FileType2" size={14} /> Google Docs / Word</button>}
            {cur.dataUrl && <a className="btn sm" href={cur.dataUrl} download={cur.fileName}><IcoV name="Download" size={14} /> Download</a>}
            {cur.type === "draft" && <button className="btn sm" onClick={() => window.print()} title="Print or save as PDF"><IcoV name="Printer" size={14} /> Print</button>}
            <button className="btn icon sm" onClick={delCurrent} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
          </div>
        </div>

        <div className={`docv-split ${cur.srv ? "" : "solo"}`}>
          <div className="docv-main">
            {cur.kind === "pdf" && cur.dataUrl ? (
              <div className="doc-pdf-viewer docv-tall"><iframe title={cur.title} src={`${pdfUrl || cur.dataUrl}#navpanes=0&view=Fit`} /></div>
            ) : cur.type === "draft" ? (
              <div className="docv-page">
                {sectionsFor(cur.p.templateId).map(s => (
                  <section key={s.id} className="docv-sec">
                    <h2>{s.name}</h2>
                    <div className="docv-text">{(cur.p.sections?.[s.id] || "").trim() || <span className="docv-empty">Not written yet.</span>}</div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="docv-page">
                {cur.loading ? (
                  <div className="docv-empty"><IcoV name="Loader" size={14} className="spin" /> Loading document…</div>
                ) : text.trim() ? (
                  text.split(/\n{2,}/).map((p, i) => <p key={i} className="docv-p">{p}</p>)
                ) : (
                  <div className="docv-empty">No text in this document yet — switch to Edit to add some.</div>
                )}
              </div>
            )}
          </div>
          {cur.srv && (
            <aside className="docv-aside">
              <div className="docv-info">
                <div className="docv-info-t"><IcoV name="Info" size={13} /> File details</div>
                <div className="docv-info-row"><span>Type</span><strong>{kindLabel(cur.type === "draft" ? "draft" : cur.kind)}</strong></div>
                {cur.fileName && <div className="docv-info-row"><span>File</span><strong>{cur.fileName}</strong></div>}
                <div className="docv-info-row"><span>Source</span><strong>{cur.srv.source || cur.source}</strong></div>
                <div className="docv-info-row"><span>Words</span><strong>{wcOf(exportText)}</strong></div>
                {cur.srv.updated_at && <div className="docv-info-row"><span>Updated</span><strong>{new Date(cur.srv.updated_at).toLocaleDateString()}</strong></div>}
              </div>
              <AiPanel srv={cur.srv && cur.srv.analysis !== undefined ? cur.srv : (serverFull || cur.srv)} />
            </aside>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // EDIT
  // ==========================================================================
  if (cur && mode === "edit") {
    if (cur.type === "draft") {
      const p = cur.p;
      const secs = sectionsFor(p.templateId);
      const total = secs.reduce((a, s) => a + wcOf(p.sections?.[s.id]), 0);
      const target = secs.reduce((a, s) => a + s.target, 0);
      const upd = (sid, v) => updLocal(p.id, { sections: { ...p.sections, [sid]: v } });
      return (
        <div className="page">
          <HiddenUpload />
          <ModeTabs />
          <div className="step-head docv-head" style={{ marginBottom: 12 }}>
            <div className="step-num" style={{ fontSize: 18 }}><IcoV name={cur.tpl?.icon || "PenLine"} size={22} color="#fff" /></div>
            <div style={{ flex: 1 }}>
              <input className="doc-title-input" value={p.name} onChange={e => updLocal(p.id, { name: e.target.value })} />
              <div className="meta"><span className="chip">{cur.tpl?.name || "Draft"}</span><span className="chip">{total} / {target} words</span><span className="chip deliv-sat"><IcoV name="Check" size={12} /> Saves automatically</span></div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm primary" onClick={() => setMode("preview")}><IcoV name="Eye" size={14} color="#fff" /> Preview</button>
              <button className="btn icon sm" onClick={delCurrent} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
            </div>
          </div>
          <div className="doc-editor">
            <aside className="doc-toc">
              <div className="doc-toc-l">On this page</div>
              {secs.map(s => { const w = wcOf(p.sections?.[s.id]); return <a key={s.id} className="doc-toc-link" href={`#dsec-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`dsec-${s.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><span>{s.name}</span>{w > 0 && <span className="cnt">{w}</span>}</a>; })}
            </aside>
            <div className="doc-page">
              <h1 className="display">{p.name}</h1>
              <div className="doc-page-meta">{total} words · {secs.length} sections</div>
              {secs.map(s => {
                const text = p.sections?.[s.id] || ""; const w = wcOf(text); const ok = s.target > 0 && w >= s.target * 0.7;
                return (
                  <section key={s.id} id={`dsec-${s.id}`} className="doc-sec">
                    <h2>{s.name}</h2>
                    <textarea value={text} onChange={e => upd(s.id, e.target.value)} placeholder={`Start writing ${s.name.toLowerCase()}…`} />
                    <div className="doc-print">{text}</div>
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

    const editable = cur.text;
    return (
      <div className="page">
        <HiddenUpload />
        <ModeTabs />
        <div className="step-head docv-head" style={{ marginBottom: 12 }}>
          <div className="step-num" style={{ fontSize: 18 }}><IcoV name={kindIcon(cur.kind)} size={22} color="#fff" /></div>
          <div style={{ flex: 1 }}>
            <input className="doc-title-input" value={cur.title} onChange={e => setTitle(e.target.value)} />
            <div className="meta">
              <span className="chip">{kindLabel(cur.kind)}</span>
              {cur.fileName && <span className="chip">{cur.fileName}</span>}
              <span className="chip deliv-sat"><IcoV name="Pencil" size={12} /> {wcOf(editable)} words</span>
              {saveChip}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {cur.srv && cur.srv.id && authed
              ? <button className="btn sm primary" onClick={() => saveToServer({ reanalyze: true })}><IcoV name="Save" size={14} color="#fff" /> Save &amp; re-analyze</button>
              : <button className="btn sm primary" onClick={() => setMode("preview")}><IcoV name="Eye" size={14} color="#fff" /> Done</button>}
            <button className="btn sm" onClick={() => setMode("preview")}><IcoV name="Eye" size={14} /> Preview</button>
            <button className="btn icon sm" onClick={delCurrent} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
          </div>
        </div>
        <div className="doc-editor">
          <div className="doc-page" style={{ gridColumn: "1 / -1" }}>
            {cur.kind === "pdf" && <div className="doc-converted-note"><IcoV name="Pencil" size={13} /> You're editing this PDF's extracted text — your coach reads this text; the original PDF (see Preview) stays untouched.</div>}
            {cur.converted && <div className="doc-converted-note"><IcoV name="Info" size={13} /> Converted from Word — text is fully editable; original formatting was simplified.</div>}
            <DocRichText value={editable} onChange={setText}
              placeholder={cur.loading ? "Loading document…" : cur.kind === "pdf" ? "If nothing appears, this is a scanned PDF with no text layer — type or paste its text here." : "This document is empty — start typing…"} />
            <div className="doc-print">{editable}</div>
            {!(cur.srv && cur.srv.id && authed) && <div className="doc-cmp-note" style={{ marginTop: 8 }}><IcoV name="Check" size={12} /> Edits save automatically on this device.</div>}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // ALL FILES
  // ==========================================================================
  const localUploads = projects.filter(p => p.uploaded);
  const localFileNames = new Set(localUploads.map(p => p.fileName));
  const cards = [];
  for (const p of localUploads) {
    const srv = serverByFile[p.fileName];
    cards.push({
      ref: { type: "local", id: p.id }, title: p.name, sub: p.fileName, kind: p.kind,
      source: "Uploaded here", group: "uploads", words: p.kind === "pdf" ? wcOf(p.content) : wcOf(p.content), srv,
      when: p.createdAt || 0
    });
  }
  for (const d of serverDocs.filter(d => !localFileNames.has(d.filename))) {
    cards.push({
      ref: { type: "server", id: d.id }, title: d.name, sub: d.filename, kind: "text",
      source: `From ${d.source}`, group: "tools", words: d.word_count, srv: d,
      when: Date.parse(d.updated_at || "") || 0
    });
  }
  for (const p of projects.filter(p => !p.uploaded)) {
    const t = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId);
    cards.push({
      ref: { type: "local", id: p.id }, title: p.name, sub: t ? t.name : "Draft", kind: "draft",
      source: "Draft", group: "drafts", icon: t?.icon,
      words: Object.values(p.sections || {}).reduce((a, x) => a + wcOf(x), 0),
      when: p.createdAt || 0
    });
  }
  cards.sort((a, b) => b.when - a.when);
  const qn = q.trim().toLowerCase();
  const visible = cards
    .filter(c => filter === "all" || c.group === filter)
    .filter(c => !qn || `${c.title} ${c.sub} ${c.source}`.toLowerCase().includes(qn));
  const counts = { all: cards.length, uploads: cards.filter(c => c.group === "uploads").length, tools: cards.filter(c => c.group === "tools").length, drafts: cards.filter(c => c.group === "drafts").length };

  return (
    <div className="page">
      <HiddenUpload />
      <div className="docs-head" data-ptour="doc-dropzone">
        <h1 className="display docs-head-h">Documents</h1>
        {cards.length > 0 && <span className="docs-head-sub">{cards.length} file{cards.length === 1 ? "" : "s"}</span>}
        {cards.length > 0 && (
          <div className="docs-filters">
            {[["all", "All"], ["uploads", "Uploads"], ["tools", "From chat & tools"], ["drafts", "Drafts"]].map(([id, label]) => (
              <button key={id} className={`docs-filter ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>{label} <span className="cnt">{counts[id]}</span></button>
            ))}
          </div>
        )}
        <div className="field docs-search"><div className="wrap"><span className="fi"><IcoV name="Search" size={14} /></span>
          <input placeholder="Search files…" aria-label="Search files" value={q} onChange={e => setQ(e.target.value)} /></div></div>
        <button className="btn primary sm" data-ptour="doc-upload" onClick={openUploader}><IcoV name="Upload" size={14} color="#fff" /> Upload</button>
      </div>

      {busy && <div className="search-state" style={{ marginBottom: 14 }}><IcoV name="Loader" size={16} className="spin" /> Reading &amp; converting <strong>&nbsp;{busy}&nbsp;</strong>…</div>}
      {uploadErr && <div className="doc-upload-err"><IcoV name="AlertTriangle" size={15} /> {uploadErr}</div>}

      {cards.length === 0 && (
        <button className="doc-dropzone" onClick={openUploader}>
          <span className="doc-dz-ico"><IcoV name="UploadCloud" size={22} /></span>
          <span className="doc-dz-t">Upload a document</span>
          <span className="doc-dz-d">PDF, Word (.docx), or text — every file becomes previewable, editable, and readable by your AI coach.</span>
        </button>
      )}

      {visible.length > 0 && (
        <div className="doc-grid" style={{ marginBottom: 8 }}>
          {visible.map(c => {
            let aiNote = "";
            if (c.srv && (c.srv.analysis_status === "pending" || c.srv.analysis_status === "analyzing")) aiNote = "AI analyzing…";
            else if (c.srv && c.srv.analysis_status === "done") aiNote = "✦ AI summary";
            const newer = c.srv && c.srv.comparison && c.srv.comparison.is_same_document;
            return (
              <div key={`${c.ref.type}-${c.ref.id}`} className="doc-card" onClick={() => openPreview(c.ref)}>
                <span className="doc-card-i"><IcoV name={c.icon || kindIcon(c.kind)} size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="doc-card-n">{c.title}</div>
                  <div className="doc-card-d">{c.sub}</div>
                  <div className="doc-card-meta">{kindLabel(c.kind)} · {c.source}{c.words ? ` · ${c.words} words` : ""}{aiNote ? ` · ${aiNote}` : ""}{newer ? " · ↻ newer version" : ""}</div>
                </div>
                <div className="doc-card-acts">
                  <button className="doc-card-act" title="Preview" onClick={e => { e.stopPropagation(); openPreview(c.ref); }}><IcoV name="Eye" size={13} /></button>
                  <button className="doc-card-act" title="Edit" onClick={e => { e.stopPropagation(); openEdit(c.ref); }}><IcoV name="Pencil" size={13} /></button>
                  <button className="doc-card-del" title="Delete" onClick={e => { e.stopPropagation(); delFromCard(c); }}><IcoV name="Trash2" size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {cards.length > 0 && visible.length === 0 && <div className="docv-empty" style={{ margin: "18px 0" }}>Nothing matches "{q}".</div>}

      {(window.DOC_TEMPLATES || []).length > 0 && (
        <>
          <div className="section-label"><span className="ic"><IcoV name="PenLine" size={13} /></span> Start a draft</div>
          <div className="docs-tpl-row">
            {(window.DOC_TEMPLATES || []).slice(0, 6).map(t => (
              <button key={t.id} className="docs-tpl" onClick={() => createDraft(t.id)}><IcoV name={t.icon || "FileText"} size={14} /> {t.name}</button>
            ))}
          </div>
        </>
      )}

      {knowledge && (knowledge.markdown || "").trim() && (
        <>
          <div className="section-label"><span className="ic"><IcoV name="Sparkles" size={13} /></span> What your coach has learned</div>
          <div className="doc-knowledge">
            <div className="doc-knowledge-d">Built automatically from your documents, the links inside them, your chats, and your wellbeing check-ins. Your chat advisors read this so answers fit your program and situation.</div>
            {knowledgeOpen ? (
              <>
                <pre className="doc-knowledge-md">{knowledge.markdown}</pre>
                <button className="btn sm" onClick={() => setKnowledgeOpen(false)}><IcoV name="ChevronUp" size={13} /> Hide</button>
              </>
            ) : (
              <button className="btn sm" onClick={() => setKnowledgeOpen(true)}><IcoV name="ChevronDown" size={13} /> Show what the AI knows</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

window.CoachInsights = CoachInsights;
window.CoachWorkspace = CoachWorkspace;
window.CoachDocuments = CoachDocuments;
