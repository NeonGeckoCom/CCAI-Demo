/* coach-plan.jsx — spreadsheet-style My Plan page.
   Sections (1, 2, 3…) are ~3-month quarters; subs (1a, 1b…) are ~week-sized
   rows. Everything edits inline like a spreadsheet, exports/imports CSV, and
   the personal assistant can regenerate (handbook + base template + profile)
   or retrofit (describe what changed) the whole plan in one pass.
   Exposes window.CoachPlanSheet. Loads before coach-app2.jsx. */

const { useState: useSP, useEffect: useEP, useMemo: useMP, useRef: useRP } = React;
const IcoP = window.Icon;
const HP = () => window.coachHelpers || {};

const letterOf = (j) => {
  let s = ""; j = j | 0;
  do { s = String.fromCharCode(97 + (j % 26)) + s; j = Math.floor(j / 26) - 1; } while (j >= 0);
  return s;
};
const PLAN_STATUSES = ["todo", "doing", "done", "skip"];
// Each phase of the journey gets its own accent color — the sheet reads as a
// path through eras, not a wall of grey rows.
const PHASE_PALETTE = ["#D9774B", "#5B8DB8", "#8B6CB0", "#4C9F8B", "#C9A227", "#E0A23E", "#5E9B6E", "#C8623F", "#B85B7A", "#6B7FC7"];
const PHASE_HINTS = { start: 0, course: 1, topic: 2, method: 3, qual: 4, proposal: 5, data: 6, writ: 7, defen: 8, submi: 9 };
function phaseColor(phase) {
  const p = (phase || "").toLowerCase();
  for (const k in PHASE_HINTS) if (p.includes(k)) return PHASE_PALETTE[PHASE_HINTS[k]];
  let h = 0; for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) | 0;
  return PHASE_PALETTE[Math.abs(h) % PHASE_PALETTE.length];
}
// Where a plan row came from — handbook, web search, or the built-in template.
function sourceMeta(src) {
  const s = String(src || "").trim();
  if (!s) return { icon: "HelpCircle", label: "—", full: "Source not recorded" };
  if (/perplexity|web/i.test(s)) return { icon: "Globe", label: "Web search", full: s };
  if (/template|built-in/i.test(s)) return { icon: "LayoutTemplate", label: "Template", full: s };
  return { icon: "FileText", label: s.length > 22 ? s.slice(0, 20) + "…" : s, full: s };
}

function yearOf(months, idx) {
  const m = parseInt(String(months || "").match(/\d+/) || "", 10);
  return isNaN(m) ? Math.floor(idx / 4) + 1 : Math.max(1, Math.ceil(m / 12));
}
const statusColor = (s) => s === "done" ? "var(--sage)" : s === "doing" ? "var(--amber)" : s === "skip" ? "var(--text-3)" : "var(--text-2)";
const statusIcon = (s) => s === "done" ? "CheckCircle2" : s === "doing" ? "CircleDot" : s === "skip" ? "MinusCircle" : "Circle";

// ---- profile (persisted; feeds generation + retrofit) ----------------------
const PLAN_PROFILE_KEY = "phd-coach-plan-profile-v1";
const PROFILE_TOKENS = [
  ["masters_entry", "I came in with a master's"],
  ["coursework_done", "My coursework is done"],
  ["post_quals", "I passed my qualifying exams"],
  ["post_candidacy", "I've advanced to candidacy"],
  ["post_proposal", "My proposal is defended"]
];
const loadProfile = () => { try { return JSON.parse(localStorage.getItem(PLAN_PROFILE_KEY) || "null") || { tokens: [], entry_note: "", field: "" }; } catch (e) { return { tokens: [], entry_note: "", field: "" }; } };
const saveProfile = (p) => { try { localStorage.setItem(PLAN_PROFILE_KEY, JSON.stringify(p)); } catch (e) {} };

// ---- roadmap <-> plan-JSON mapping ----------------------------------------
function subMetaOf(roadmap, stepId, sub) {
  return ((roadmap.subMeta || {})[`${stepId}::${sub}`]) || {};
}
function subStatus(roadmap, doneTasks, step, sub) {
  if (doneTasks && doneTasks.has(`${step.id}::${sub}`)) return "done";
  const m = subMetaOf(roadmap, step.id, sub);
  if (m.skipped) return "skip";
  if (m.doing) return "doing";
  return "todo";
}
function serializePlan(roadmap, doneTasks) {
  return {
    sections: (roadmap.steps || []).map((s, i) => ({
      code: i + 1,
      title: s.title, phase: s.phase || "", months: s.months || s.estimate || "",
      gate: !!s.gate, objective: s.objective || "", status: s.status || "locked",
      subs: (s.subtasks || []).map((t, j) => {
        const m = subMetaOf(roadmap, s.id, t);
        return { id: `${i + 1}${letterOf(j)}`, title: t, days: m.days || "", notes: m.notes || "",
          gate: !!m.gate, status: subStatus(roadmap, doneTasks, s, t) };
      })
    }))
  };
}
// Convert an AI plan (or CSV import) into roadmap steps + subMeta, preserving
// prior step ids/statuses (and therefore done-checkmarks) wherever titles match.
function planToRoadmap(plan, roadmap, doneTasks, setDoneTasks) {
  const prev = roadmap.steps || [];
  const prevByTitle = {};
  prev.forEach(s => { prevByTitle[(s.title || "").trim().toLowerCase()] = s; });
  const subMeta = {};
  const newDone = new Set();
  const steps = (plan.sections || []).map((sec, i) => {
    const match = prevByTitle[(sec.title || "").trim().toLowerCase()];
    const id = match ? match.id : `plan-${i + 1}-${(sec.title || "s").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
    const subtasks = [];
    (sec.subs || []).forEach(sub => {
      const t = (sub.title || "").trim();
      if (!t || subtasks.includes(t)) return;
      subtasks.push(t);
      const key = `${id}::${t}`;
      subMeta[key] = { days: sub.days || "", notes: sub.notes || "", gate: !!sub.gate,
        doing: sub.status === "doing", skipped: sub.status === "skip" };
      if (sub.status === "done") newDone.add(key);
      else if (doneTasks && doneTasks.has(key)) newDone.add(key);
    });
    return {
      id, title: sec.title, phase: sec.phase || "Plan", months: sec.months || "",
      icon: match ? match.icon : "Flag", gate: !!sec.gate,
      estimate: sec.months ? `months ${sec.months}` : (match ? match.estimate : "~3 months"),
      objective: sec.objective || (match ? match.objective : ""),
      status: match ? match.status : "locked",
      subtasks, add: match ? (match.add || []) : [], retire: match ? (match.retire || []) : [],
      toolsAdd: match ? match.toolsAdd : undefined, toolsRemove: match ? match.toolsRemove : undefined,
      templateId: match ? match.templateId : undefined
    };
  });
  if (!steps.some(s => s.status === "current" || s.status === "redo")) {
    const idx = steps.findIndex(s => s.status !== "done");
    if (idx >= 0) steps[idx] = { ...steps[idx], status: "current" };
  }
  if (setDoneTasks) setDoneTasks(newDone);
  return { ...roadmap, steps, subMeta };
}

// ---- CSV -------------------------------------------------------------------
const csvEsc = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function planToCsv(roadmap, doneTasks) {
  const rows = [["code", "title", "time", "status", "notes", "phase", "months", "gate"]];
  (roadmap.steps || []).forEach((s, i) => {
    rows.push([i + 1, s.title, "", s.status || "", s.objective || "", s.phase || "", s.months || "", s.gate ? "gate" : ""]);
    (s.subtasks || []).forEach((t, j) => {
      const m = subMetaOf(roadmap, s.id, t);
      rows.push([`${i + 1}${letterOf(j)}`, t, m.days || "", subStatus(roadmap, doneTasks, s, t), m.notes || "", "", "", m.gate ? "gate" : ""]);
    });
  });
  return rows.map(r => r.map(csvEsc).join(",")).join("\n");
}
function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function csvToPlan(text) {
  const rows = parseCsv(text);
  if (!rows.length) return null;
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const ci = { code: col("code"), title: col("title"), time: col("time"), status: col("status"), notes: col("notes"), phase: col("phase"), months: col("months"), gate: col("gate") };
  if (ci.code < 0 || ci.title < 0) return null;
  const sections = [];
  rows.slice(1).forEach(r => {
    const code = (r[ci.code] || "").trim();
    const title = (r[ci.title] || "").trim();
    if (!code || !title) return;
    const get = (k) => ci[k] >= 0 ? (r[ci[k]] || "").trim() : "";
    if (/^\d+$/.test(code)) {
      sections.push({ code: parseInt(code, 10), title, phase: get("phase"), months: get("months"),
        gate: /gate/i.test(get("gate")), objective: get("notes"),
        status: get("status") || "locked", subs: [] });
    } else if (/^\d+[a-z]+$/i.test(code) && sections.length) {
      sections[sections.length - 1].subs.push({ id: code, title, days: get("time"),
        notes: get("notes"), gate: /gate/i.test(get("gate")),
        status: PLAN_STATUSES.includes(get("status")) ? get("status") : "todo" });
    }
  });
  return sections.length ? { sections } : null;
}

// ---- Assistant modals ------------------------------------------------------
function ProfileFields({ profile, setProfile }) {
  const toggle = (t) => setProfile(p => ({ ...p, tokens: p.tokens.includes(t) ? p.tokens.filter(x => x !== t) : [...p.tokens, t] }));
  return (
    <>
      <div className="section-label"><span className="ic"><IcoP name="UserCheck" size={13} /></span> Where are you already?</div>
      <div className="plan-tokens">
        {PROFILE_TOKENS.map(([t, label]) => (
          <button key={t} className={`tool-chip-btn ${profile.tokens.includes(t) ? "on" : ""}`} onClick={() => toggle(t)}>
            <IcoP name={profile.tokens.includes(t) ? "Check" : "Plus"} size={11} /> {label}
          </button>
        ))}
      </div>
      <input className="tool-fullinput" value={profile.entry_note}
        onChange={e => setProfile(p => ({ ...p, entry_note: e.target.value }))}
        placeholder="Anything else? e.g. '3rd year, proposal draft half done, switching to 3-paper format'" />
    </>
  );
}

function RetrofitModal({ roadmap, doneTasks, onApply, onClose }) {
  const [text, setText] = useSP("");
  const [profile, setProfile] = useSP(loadProfile);
  const [busy, setBusy] = useSP(false);
  const [err, setErr] = useSP("");
  const [result, setResult] = useSP(null);
  useEP(() => { saveProfile(profile); }, [profile]);
  const EXAMPLES = [
    "My advisor wants me to switch to a 3-paper dissertation.",
    "I already finished coursework and passed quals — clean up the plan.",
    "My study 1 data was unusable; I need to re-collect this semester.",
    "I'm going part-time for a year starting this fall."
  ];
  const run = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const res = await window.CoachAPI.planRetrofit({
        plan: serializePlan(roadmap, doneTasks), change: text,
        profile: { tokens: profile.tokens, entry_note: profile.entry_note, field: (roadmap.program && roadmap.program.name) || "" }
      });
      setResult(res);
    } catch (e) { setErr(e.message || "Retrofit failed."); }
    finally { setBusy(false); }
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal fund-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Retrofit plan">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--grad)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><IcoP name="Wand2" size={18} /></div>
            <div><h2 className="display">Something changed?</h2><p>Tell your assistant what happened. It rewrites the plan around it in one pass — keeping everything you've done.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IcoP name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          {!result ? (
            <>
              <textarea className="meet-notes" style={{ minHeight: 100 }} value={text} onChange={e => setText(e.target.value)}
                placeholder="e.g. I passed quals early, my proposal moved to March, and we added a second study…" autoFocus />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {EXAMPLES.map((ex, i) => <button key={i} className="suggest-btn" onClick={() => setText(ex)}>{ex}</button>)}
              </div>
              {err && <div className="tool-flash err"><IcoP name="AlertTriangle" size={12} /> {err}</div>}
            </>
          ) : (
            <>
              <div className="tool-flash ok"><IcoP name="CheckCircle2" size={12} /> {result.summary || "Plan retrofitted."}</div>
              {(result.changes || []).length > 0 && (
                <div className="plan-preview">
                  <b>What the assistant changed:</b>
                  <ul className="plan-changes">{(result.changes || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {!result ? (
            <button className="btn primary" onClick={run} disabled={busy || !text.trim()}>
              <IcoP name={busy ? "Loader" : "Wand2"} size={14} color="#fff" className={busy ? "spin" : ""} /> {busy ? "Retrofitting…" : "Retrofit my plan"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setResult(null)}><IcoP name="ArrowLeft" size={13} /> Back</button>
              <button className="btn primary" onClick={() => onApply(result)}><IcoP name="Check" size={14} color="#fff" /> Apply changes</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Inline row expansion: notes + walkthrough + crafted tools -------------
const TOOL_KINDS = [["checklist", "Checklist", "ListChecks"], ["notes", "Notes", "StickyNote"], ["tracker", "Tracker", "Activity"]];
function suggestToolKind(text) {
  const p = (text || "").toLowerCase();
  if (/note|journal|idea|log|draft|writ/.test(p)) return "notes";
  if (/count|track|number|streak|hour|word|page|recruit|participant|metric/.test(p)) return "tracker";
  return "checklist";
}

function RowPanel({ roadmap, step, sub, code, status, onPatchMeta, onCycle, onAsk }) {
  const meta = subMetaOf(roadmap, step.id, sub);
  const [wt, setWt] = useSP(meta.walkthrough || null);
  const [busy, setBusy] = useSP(false);
  const [err, setErr] = useSP("");
  const [checked, setChecked] = useSP(() => new Set(meta.walkChecked || []));
  const [craftOpen, setCraftOpen] = useSP(false);
  const [craftKind, setCraftKind] = useSP(() => suggestToolKind(sub));
  const gen = async () => {
    setBusy(true); setErr("");
    try {
      const res = await window.CoachAPI.planWalkthrough({
        title: sub, section: step.title, objective: step.objective,
        notes: meta.notes, days: meta.days,
        program: roadmap.program && roadmap.program.name,
        field: roadmap.program && roadmap.program.name
      });
      setWt(res);
      setChecked(new Set());
      onPatchMeta({ walkthrough: res, walkChecked: [] });
    } catch (e) {
      setErr(e.message || "Couldn't reach the assistant — is the backend running?");
    } finally { setBusy(false); }
  };
  useEP(() => { if (!wt) gen(); }, []);
  const toggle = (i) => {
    setChecked(prev => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      onPatchMeta({ walkChecked: [...n] });
      return n;
    });
  };
  // Craft a real, persistent tool for this row (the same custom-tool primitive
  // the Navigator's skills use), seeded from the walkthrough where it fits.
  const craftTool = () => {
    if (!window.CoachActions) return;
    const key = `phd-custom-${Math.random().toString(36).slice(2, 9)}`;
    if (craftKind === "checklist" && wt && wt.steps.length) {
      try {
        localStorage.setItem(key, JSON.stringify(
          wt.steps.map((st, i) => ({ id: `wt-${i}`, text: st.title, done: checked.has(i) }))
        ));
      } catch (e) {}
    }
    const inst = window.CoachActions.addCustomTool({
      title: `${code} · ${sub.slice(0, 40)}`, kind: craftKind,
      purpose: `Tool for plan step ${code}: ${sub}`, key
    });
    onPatchMeta({ toolInst: inst });
    setCraftOpen(false);
  };
  const removeTool = () => { if (confirm("Remove this tool from the row? Its saved data stays in your Workspace.")) onPatchMeta({ toolInst: null }); };
  const doneN = wt ? wt.steps.filter((_, i) => checked.has(i)).length : 0;

  return (
    <div className="sheet-panel">
      <div className="sheet-panel-cols">
        <div className="sheet-panel-main">
          {busy && !wt && <div className="tool-empty"><IcoP name="Loader" size={13} className="spin" /> Your assistant is writing the walkthrough…</div>}
          {err && <div className="tool-flash err"><IcoP name="AlertTriangle" size={12} /> {err} <button className="tool-chip-btn" onClick={gen}>Retry</button></div>}
          {wt && (
            <>
              {wt.overview && <p className="wt-overview">{wt.overview}</p>}
              <div className="section-label" style={{ display: "flex", alignItems: "center", marginTop: 4 }}>
                <span className="ic"><IcoP name="ListChecks" size={13} /></span> How to complete {code} · {doneN}/{wt.steps.length}
                <button className="tool-chip-btn" style={{ marginLeft: "auto" }} onClick={gen} disabled={busy} title="Rewrite the walkthrough"><IcoP name={busy ? "Loader" : "RefreshCw"} size={11} className={busy ? "spin" : ""} /> Regenerate</button>
              </div>
              <div className="wt-steps">
                {wt.steps.map((st, i) => (
                  <div key={i} className={`wt-step ${checked.has(i) ? "done" : ""}`}>
                    <button className="dh-cb" onClick={() => toggle(i)} aria-label={checked.has(i) ? "Uncheck" : "Check"}>
                      {checked.has(i) && <IcoP name="Check" size={12} color="#fff" />}
                    </button>
                    <div>
                      <div className="wt-step-t">{i + 1}. {st.title}</div>
                      {st.detail && <div className="wt-step-d">{st.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {(wt.done_when || []).length > 0 && (
                <>
                  <div className="section-label"><span className="ic"><IcoP name="CheckCircle2" size={13} /></span> You're done when</div>
                  <ul className="wt-list sage">{wt.done_when.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </>
              )}
              {(wt.pitfalls || []).length > 0 && (
                <>
                  <div className="section-label"><span className="ic"><IcoP name="AlertTriangle" size={13} /></span> Watch out for</div>
                  <ul className="wt-list amber">{wt.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>
              )}
            </>
          )}
        </div>
        <div className="sheet-panel-side">
          <div className="section-label" style={{ marginTop: 0 }}><span className="ic"><IcoP name="PenLine" size={13} /></span> Notes</div>
          <textarea className="sheet-panel-notes" defaultValue={meta.notes || ""} key={`pn-${step.id}-${sub}`}
            placeholder="Your notes on this step…"
            onBlur={e => onPatchMeta({ notes: e.target.value.trim() })} />

          <div className="section-label"><span className="ic"><IcoP name="Wand2" size={13} /></span> Tool for this step</div>
          {meta.toolInst && window.CustomTool ? (
            <div className="sheet-panel-tool">
              <window.CustomTool inst={meta.toolInst} />
              <button className="tool-chip-btn" onClick={removeTool}><IcoP name="X" size={11} /> Remove tool</button>
            </div>
          ) : craftOpen ? (
            <div className="tool-panel">
              <div className="tool-btn-row" style={{ marginBottom: 6 }}>
                {TOOL_KINDS.map(([id, label, icon]) => (
                  <button key={id} className={`tool-chip-btn ${craftKind === id ? "on" : ""}`} onClick={() => setCraftKind(id)}><IcoP name={icon} size={11} /> {label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 6 }}>
                {craftKind === "checklist" ? "Pre-filled with the walkthrough's mini-steps." : craftKind === "notes" ? "A sticky-note pad scoped to this step." : "Count anything — participants, pages, hours."}
              </div>
              <button className="btn sm primary" style={{ width: "100%", justifyContent: "center" }} onClick={craftTool}><IcoP name="Wand2" size={13} color="#fff" /> Build it</button>
            </div>
          ) : (
            <button className="tool-empty clickable" onClick={() => setCraftOpen(true)}>
              <IcoP name="Wand2" size={13} /> Have the assistant craft a tool for this step — a checklist seeded from the walkthrough, a notes pad, or a tracker.
            </button>
          )}

          <div className="sheet-panel-acts">
            {onAsk && (
              <button className="btn sm" onClick={() => onAsk(`I'm working on "${sub}" (part of "${step.title}") in my PhD plan. I've read the checklist but I'm stuck — walk me through it with concrete first actions for my situation.`)}>
                <IcoP name="MessageCircle" size={13} /> Ask advisors
              </button>
            )}
            <button className="btn sm primary" onClick={() => { if (status !== "done") onCycle("done"); }}>
              <IcoP name="Check" size={13} color="#fff" /> {status === "done" ? "Done ✓" : "Mark done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- The spreadsheet page --------------------------------------------------
function CoachPlanSheet({ roadmap, setRoadmap, doneTasks, setDoneTasks, touchStep, onOpenSos, onNav, onOpenStep, onAsk }) {
  const steps = roadmap.steps || [];
  // Sections after the first two start closed on page load; letters are per
  // section, so one can be just 1a-1b while another runs a-z.
  const [collapsed, setCollapsed] = useSP(() => new Set((roadmap.steps || []).slice(2).map(s => s.id)));
  const [retrofit, setRetrofit] = useSP(false);
  const [expanded, setExpanded] = useSP(() => new Set()); // "stepId::sub" keys
  const toggleExpand = (stepId, sub) => setExpanded(prev => {
    const k = `${stepId}::${sub}`;
    const n = new Set(prev);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });
  const [toast, setToast] = useSP("");
  const importRef = useRP(null);
  // Two ways to see the plan: the whole journey, or just what you're working on.
  const [view, setView] = useSP(() => { try { return localStorage.getItem("phd-plan-view-v2") || "focus"; } catch (e) { return "focus"; } });
  useEP(() => { try { localStorage.setItem("phd-plan-view-v2", view); } catch (e) {} }, [view]);
  const [focusId, setFocusId] = useSP(null);
  useEP(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);

  const patchStep = (id, p) => setRoadmap({ ...roadmap, steps: steps.map(s => s.id === id ? { ...s, ...p } : s) });
  const patchMeta = (stepId, sub, p) => setRoadmap(r => ({
    ...r, subMeta: { ...(r.subMeta || {}), [`${stepId}::${sub}`]: { ...subMetaOf(r, stepId, sub), ...p } }
  }));

  const setSub = (step, oldT, newT) => {
    const t = newT.trim();
    if (!t || t === oldT || step.subtasks.includes(t)) return;
    const meta = subMetaOf(roadmap, step.id, oldT);
    setRoadmap(r => {
      const sm = { ...(r.subMeta || {}) };
      delete sm[`${step.id}::${oldT}`];
      sm[`${step.id}::${t}`] = meta;
      return { ...r, subMeta: sm, steps: r.steps.map(s => s.id === step.id ? { ...s, subtasks: s.subtasks.map(x => x === oldT ? t : x) } : s) };
    });
    setDoneTasks(prev => { const n = new Set(prev); if (n.has(`${step.id}::${oldT}`)) { n.delete(`${step.id}::${oldT}`); n.add(`${step.id}::${t}`); } return n; });
  };
  const cycleStatus = (step, sub) => {
    const cur = subStatus(roadmap, doneTasks, step, sub);
    const next = PLAN_STATUSES[(PLAN_STATUSES.indexOf(cur) + 1) % PLAN_STATUSES.length];
    setDoneTasks(prev => { const n = new Set(prev); const k = `${step.id}::${sub}`; next === "done" ? n.add(k) : n.delete(k); return n; });
    patchMeta(step.id, sub, { doing: next === "doing", skipped: next === "skip" });
    touchStep && touchStep(step.id);
  };
  const addSub = (step) => {
    let base = "New step", t = base, k = 2;
    while (step.subtasks.includes(t)) t = `${base} ${k++}`;
    patchStep(step.id, { subtasks: [...step.subtasks, t] });
  };
  const removeSub = (step, sub) => {
    patchStep(step.id, { subtasks: step.subtasks.filter(x => x !== sub) });
    setDoneTasks(prev => { const n = new Set(prev); n.delete(`${step.id}::${sub}`); return n; });
  };
  const moveSub = (step, j, dir) => {
    const k = j + dir;
    if (k < 0 || k >= step.subtasks.length) return;
    const subs = step.subtasks.slice();
    [subs[j], subs[k]] = [subs[k], subs[j]];
    patchStep(step.id, { subtasks: subs });
  };
  const addSection = (afterIdx) => {
    const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
    const s = { id, title: "New section", phase: steps[afterIdx] ? steps[afterIdx].phase : "Plan", icon: "Flag",
      months: "", estimate: "~3 months", objective: "", status: "locked", subtasks: [], add: [], retire: [], custom: true };
    const next = steps.slice();
    next.splice(afterIdx + 1, 0, s);
    setRoadmap({ ...roadmap, steps: next });
  };
  const removeSection = (id) => {
    const victim = steps.find(s => s.id === id);
    if (!victim || steps.length <= 1) return;
    if (!confirm(`Remove "${victim.title}" and its ${(victim.subtasks || []).length} steps?`)) return;
    let next = steps.filter(s => s.id !== id);
    if (!next.some(s => s.status === "current" || s.status === "redo")) {
      const idx = next.findIndex(s => s.status !== "done");
      if (idx >= 0) next = next.map((s, i) => i === idx ? { ...s, status: "current" } : s);
    }
    setRoadmap({ ...roadmap, steps: next });
  };
  const moveSection = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRoadmap({ ...roadmap, steps: next });
  };
  const toggleWork = (step) => {
    const active = step.status === "current" || step.status === "redo";
    if (active) {
      const others = steps.filter(s => s.id !== step.id && (s.status === "current" || s.status === "redo"));
      patchStep(step.id, { status: others.length ? "locked" : step.status });
      if (!others.length) setToast("Keep at least one section active.");
    } else {
      patchStep(step.id, { status: "current" });
      touchStep && touchStep(step.id);
    }
  };
  const toggleCollapse = (id) => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // CSV
  const exportCsv = () => {
    const blob = new Blob([planToCsv(roadmap, doneTasks)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-phd-plan.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const [importing, setImporting] = useSP(false);
  const importCsv = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    const text = await f.text();
    // Our own export round-trips instantly; anything else goes to the
    // assistant, which restructures it against the base-template standards.
    let plan = csvToPlan(text);
    if (!plan) {
      setImporting(true);
      setToast("That's not our format — the assistant is restructuring your spreadsheet…");
      try {
        const res = await window.CoachAPI.planImport({ csvText: text, profile: loadProfile() });
        plan = res;
        setToast(res.summary || "Spreadsheet restructured into your plan.");
      } catch (err) {
        setImporting(false);
        setToast(err.message || "Couldn't restructure that spreadsheet.");
        return;
      }
      setImporting(false);
    } else {
      setToast(`Imported ${plan.sections.length} sections from CSV.`);
    }
    setRoadmap(planToRoadmap(plan, roadmap, doneTasks, setDoneTasks));
  };
  const applyPlan = (plan, note) => {
    setRoadmap(planToRoadmap(plan, roadmap, doneTasks, setDoneTasks));
    setRetrofit(false);
    setToast(note);
  };


  const totalSubs = steps.reduce((a, s) => a + (s.subtasks || []).length, 0);
  const doneSubs = steps.reduce((a, s) => a + (s.subtasks || []).filter(t => doneTasks.has(`${s.id}::${t}`)).length, 0);
  const pct = totalSubs ? Math.round((doneSubs / totalSubs) * 100) : 0;

  // Focus view: rotate between the sections you're actively working on.
  const activeSecs = steps.filter(s => s.status === "current" || s.status === "redo");
  const focusList = activeSecs.length ? activeSecs : steps.filter(s => s.status !== "done").slice(0, 1);
  const focusStep = focusList.find(s => s.id === focusId) || focusList[0] || null;
  const rotateFocus = (dir) => {
    if (focusList.length < 2 || !focusStep) return;
    const idx = focusList.indexOf(focusStep);
    setFocusId(focusList[(idx + dir + focusList.length) % focusList.length].id);
  };
  // This Week leads with the walkthrough: the first open step auto-expands so
  // the page IS the guide, not a list you have to click into.
  useEP(() => {
    if (view !== "focus" || !focusStep) return;
    const subs = focusStep.subtasks || [];
    if (subs.some(t => expanded.has(`${focusStep.id}::${t}`))) return;
    const next = subs.find(t => {
      const st = subStatus(roadmap, doneTasks, focusStep, t);
      return st !== "done" && st !== "skip";
    }) || subs[0];
    if (next) setExpanded(prev => new Set(prev).add(`${focusStep.id}::${next}`));
  }, [view, focusStep && focusStep.id]);

  const renderRowExpanded = (s, t, st, i, j) => (
    <RowPanel roadmap={roadmap} step={s} sub={t} code={`${i + 1}${letterOf(j)}`} status={st}
      onPatchMeta={(p) => patchMeta(s.id, t, p)}
      onCycle={(force) => {
        if (force === "done") {
          setDoneTasks(prev => { const n = new Set(prev); n.add(`${s.id}::${t}`); return n; });
          patchMeta(s.id, t, { doing: false, skipped: false });
          touchStep && touchStep(s.id);
        } else cycleStatus(s, t);
      }}
      onAsk={onAsk} />
  );

  return (
    <div className="page page-wide">
      <div className="greeting" style={{ marginBottom: 14, display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="display" style={{ fontSize: 24 }}>{(roadmap.program && roadmap.program.name) || "My Plan"}</h1>
          <div className="plan-hero" title="Sections are ~3-month quarters · each row is about a week of work">
            <div className="plan-progress">
              <span className="plan-progress-fill" style={{ width: `${Math.max(2, pct)}%` }} />
              <span className="plan-cap" style={{ left: `${Math.min(96, Math.max(1, pct))}%` }} aria-hidden="true">🎓</span>
            </div>
            <span className="plan-hero-label">
              {pct}% of the way to Dr. {((window.MOCK_USER || {}).name || "You").split(" ").slice(-1)[0]}
              <em> · {doneSubs}/{totalSubs} steps</em>
            </span>
          </div>
        </div>
        <div className="plan-viewseg" role="tablist">
          <button role="tab" aria-selected={view === "focus"} className={view === "focus" ? "on" : ""} onClick={() => setView("focus")}><IcoP name="Crosshair" size={13} /> This week</button>
          <button role="tab" aria-selected={view === "overview"} className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}><IcoP name="Table2" size={13} /> Overview</button>
        </div>
        <div className="plan-toolbar">
          <button className="btn sm primary" onClick={() => setRetrofit(true)}><IcoP name="Wand2" size={13} color="#fff" /> Something changed?</button>
          <button className="btn sm" onClick={exportCsv}><IcoP name="Download" size={13} /> CSV</button>
          <button className="btn sm" disabled={importing} onClick={() => importRef.current && importRef.current.click()} title="Import any spreadsheet — ours round-trips exactly; others get restructured by the assistant">
            <IcoP name={importing ? "Loader" : "Upload"} size={13} className={importing ? "spin" : ""} /> {importing ? "Restructuring…" : "Import"}
          </button>
          <input ref={importRef} type="file" accept=".csv" style={{ display: "none" }} onChange={importCsv} />
        </div>
      </div>

      {window.RemindersPanel && view === "overview" && <window.RemindersPanel mode="full" onNav={onNav} />}

      {view === "overview" ? (
      <div className="sheet">
        <div className="sheet-head">
          <span className="sh-code">#</span><span className="sh-title">Task</span><span className="sh-time">Source</span>
          <span className="sh-status">Status</span><span className="sh-acts" />
        </div>
        {(() => { let lastYear = 0; return steps.map((s, i) => {
          const active = s.status === "current" || s.status === "redo";
          const secDone = (s.subtasks || []).filter(t => doneTasks.has(`${s.id}::${t}`)).length;
          const closed = collapsed.has(s.id);
          const yr = yearOf(s.months, i);
          const showYear = yr !== lastYear; lastYear = yr;
          return (
            <React.Fragment key={s.id}>
              {showYear && <div className="sheet-year"><span>Year {yr}</span></div>}
              <div className={`sheet-sec ${active ? "active" : ""} ${s.status === "done" ? "done" : ""}`}
                style={{ "--secp": `${(s.subtasks || []).length ? Math.round((secDone / s.subtasks.length) * 100) : 0}%`, "--sec-accent": phaseColor(s.phase) }}>
                <button className="sheet-fold" onClick={() => toggleCollapse(s.id)} aria-label={closed ? "Expand" : "Collapse"}>
                  <IcoP name={closed ? "ChevronRight" : "ChevronDown"} size={14} />
                </button>
                <span className="sh-code"><b>{i + 1}</b>{s.gate && <IcoP name="Flag" size={10} className="sheet-gate" />}</span>
                <input className="sheet-cell title sec" defaultValue={s.title} key={`t-${s.id}-${s.title}`}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.title) patchStep(s.id, { title: v }); }} />
                {(() => { const sm = sourceMeta(s.source || s.deliverableSource); return (
                  <span className="sheet-cell src" title={sm.full}><IcoP name={sm.icon} size={11} /> {sm.label}</span>
                ); })()}
                <button className={`sheet-work ${active ? "on" : ""}`} onClick={() => toggleWork(s)}
                  title={active ? "You're working here — click to pause" : "Work on this section"}>
                  <IcoP name={active ? "CircleDot" : s.status === "done" ? "CheckCircle2" : "Play"} size={13} />
                  {active ? "working" : s.status === "done" ? "done" : `${secDone}/${(s.subtasks || []).length}`}
                </button>
                <span className="sh-acts">
                  <button className="sheet-act" onClick={() => moveSection(i, -1)} disabled={i === 0} title="Move up"><IcoP name="ChevronUp" size={13} /></button>
                  <button className="sheet-act" onClick={() => moveSection(i, 1)} disabled={i === steps.length - 1} title="Move down"><IcoP name="ChevronDown" size={13} /></button>
                  <button className="sheet-act" onClick={() => addSub(s)} title="Add a row to this section"><IcoP name="Plus" size={13} /></button>
                  <button className="sheet-act danger" onClick={() => removeSection(s.id)} title="Remove section"><IcoP name="Trash2" size={13} /></button>
                </span>
              </div>
              {!closed && (s.subtasks || []).map((t, j) => {
                const st = subStatus(roadmap, doneTasks, s, t);
                const meta = subMetaOf(roadmap, s.id, t);
                const openRow = expanded.has(`${s.id}::${t}`);
                return (
                  <React.Fragment key={`${s.id}-${j}`}>
                    <div className={`sheet-row ${st} ${openRow ? "open" : ""}`}>
                      <button className="sh-code linky" onClick={() => toggleExpand(s.id, t)} title={openRow ? "Collapse" : "Expand the walkthrough for this step"}>
                        <IcoP name={openRow ? "ChevronDown" : "ChevronRight"} size={12} />
                        {i + 1}{letterOf(j)}{meta.gate && <IcoP name="Flag" size={9} className="sheet-gate" />}
                      </button>
                      <input className="sheet-cell title" defaultValue={t} key={`s-${s.id}-${j}-${t}`}
                        onBlur={e => setSub(s, t, e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
                      {(() => { const sm = sourceMeta(meta.source || s.source || s.deliverableSource); return (
                        <span className="sheet-cell src" title={sm.full}><IcoP name={sm.icon} size={11} /> {sm.label}</span>
                      ); })()}
                      <button className={`sheet-status ${st}`} onClick={() => cycleStatus(s, t)} title="Click to cycle: todo → doing → done → skip">
                        <IcoP name={statusIcon(st)} size={13} /> {st}
                      </button>
                      <span className="sh-acts">
                        <button className="sheet-act" onClick={() => moveSub(s, j, -1)} disabled={j === 0} title="Move up"><IcoP name="ChevronUp" size={13} /></button>
                        <button className="sheet-act" onClick={() => moveSub(s, j, 1)} disabled={j === s.subtasks.length - 1} title="Move down"><IcoP name="ChevronDown" size={13} /></button>
                        <button className="sheet-act danger" onClick={() => removeSub(s, t)} title="Remove row"><IcoP name="X" size={13} /></button>
                      </span>
                    </div>
                    {openRow && renderRowExpanded(s, t, st, i, j)}
                  </React.Fragment>
                );
              })}
              {!closed && (
                <button className="sheet-addrow" onClick={() => addSub(s)}><IcoP name="Plus" size={12} /> step</button>
              )}
            </React.Fragment>
          );
        }); })()}
        <button className="sheet-addsec" onClick={() => addSection(steps.length - 1)}><IcoP name="Plus" size={14} /> New quarter</button>
      </div>
      ) : (
      <div className="focus-wrap">
        {/* Everything marked "doing" anywhere in the plan surfaces here. */}
        {(() => {
          const doingRows = [];
          steps.forEach((s, i) => (s.subtasks || []).forEach((t, j) => {
            if (subStatus(roadmap, doneTasks, s, t) === "doing") doingRows.push({ s, t, i, j });
          }));
          if (!doingRows.length) return null;
          const openDoing = (s, t) => {
            if (focusList.some(x => x.id === s.id)) {
              setFocusId(s.id);
              setExpanded(prev => new Set(prev).add(`${s.id}::${t}`));
            } else {
              toggleExpand(s.id, t);
            }
          };
          return (
            <div className="focus-doing">
              <div className="focus-doing-head"><IcoP name="Zap" size={13} /> Doing now · {doingRows.length}</div>
              {doingRows.map(({ s, t, i, j }) => {
                const inActive = focusList.some(x => x.id === s.id);
                const key = `${s.id}::${t}`;
                const openHere = !inActive && expanded.has(key);
                return (
                  <React.Fragment key={`dn-${key}`}>
                    <div className={`focus-row doing ${openHere ? "open" : ""}`}>
                      <button className="sheet-status doing" onClick={() => cycleStatus(s, t)} title="todo → doing → done → skip">
                        <IcoP name="CircleDot" size={13} /> doing
                      </button>
                      <button className="focus-row-t" onClick={() => openDoing(s, t)}>
                        <b>{i + 1}{letterOf(j)}</b> {t}
                        <span className="focus-doing-sec">{s.title}</span>
                      </button>
                      <button className="sheet-act" style={{ opacity: 1 }} onClick={() => openDoing(s, t)} aria-label="Open">
                        <IcoP name={inActive ? "ArrowRight" : openHere ? "ChevronUp" : "ChevronDown"} size={14} />
                      </button>
                    </div>
                    {openHere && renderRowExpanded(s, t, "doing", i, j)}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}
        {focusList.length > 1 && (
          <div className="focus-tabs">
            <button className="sheet-act" style={{ opacity: 1 }} onClick={() => rotateFocus(-1)} aria-label="Previous section"><IcoP name="ChevronLeft" size={15} /></button>
            {focusList.map(s => {
              const sd = (s.subtasks || []).filter(t => doneTasks.has(`${s.id}::${t}`)).length;
              return (
                <button key={s.id} className={`focus-tab ${focusStep && focusStep.id === s.id ? "on" : ""}`}
                  style={{ "--sec-accent": phaseColor(s.phase) }} onClick={() => setFocusId(s.id)}>
                  {steps.indexOf(s) + 1}. {s.title} <em>{sd}/{(s.subtasks || []).length}</em>
                </button>
              );
            })}
            <button className="sheet-act" style={{ opacity: 1 }} onClick={() => rotateFocus(1)} aria-label="Next section"><IcoP name="ChevronRight" size={15} /></button>
          </div>
        )}
        {!focusStep ? (
          <div className="focus-empty">
            <IcoP name="Trophy" size={22} /> Everything's done — flip to Overview to add what's next, Dr.
          </div>
        ) : (() => {
          const i = steps.indexOf(focusStep);
          const total = (focusStep.subtasks || []).length;
          const sd = (focusStep.subtasks || []).filter(t => doneTasks.has(`${focusStep.id}::${t}`)).length;
          const spct = total ? Math.round((sd / total) * 100) : 0;
          return (
            <div className="focus-card" style={{ "--sec-accent": phaseColor(focusStep.phase) }}>
              <div className="focus-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="focus-eyebrow">{focusStep.phase || "Section"}{focusStep.months ? ` · months ${focusStep.months}` : ""} · Year {yearOf(focusStep.months, i)}</div>
                  <h2 className="display" style={{ fontSize: 21, margin: 0 }}>{i + 1}. {focusStep.title}</h2>
                </div>
                <div className="focus-pct">{spct}%</div>
              </div>
              <div className="dh-bar focus-bar"><span style={{ width: `${Math.max(3, spct)}%` }} /></div>
              <div className="focus-rows">
                {(focusStep.subtasks || []).map((t, j) => {
                  const st = subStatus(roadmap, doneTasks, focusStep, t);
                  const meta = subMetaOf(roadmap, focusStep.id, t);
                  const openRow = expanded.has(`${focusStep.id}::${t}`);
                  return (
                    <React.Fragment key={`f-${j}`}>
                      <div className={`focus-row ${st} ${openRow ? "open" : ""}`}>
                        <button className={`sheet-status ${st}`} onClick={() => cycleStatus(focusStep, t)} title="todo → doing → done → skip">
                          <IcoP name={statusIcon(st)} size={13} /> {st}
                        </button>
                        <button className="focus-row-t" onClick={() => toggleExpand(focusStep.id, t)}>
                          <b>{i + 1}{letterOf(j)}</b> {t}
                        </button>
                        {meta.days && <span className="dl-chip">{meta.days}</span>}
                        <button className="sheet-act" style={{ opacity: 1 }} onClick={() => toggleExpand(focusStep.id, t)} aria-label="Expand"><IcoP name={openRow ? "ChevronUp" : "ChevronDown"} size={14} /></button>
                      </div>
                      {openRow && renderRowExpanded(focusStep, t, st, i, j)}
                    </React.Fragment>
                  );
                })}
              </div>
              <button className="sheet-addrow" style={{ paddingLeft: 8, borderTop: "none" }} onClick={() => addSub(focusStep)}><IcoP name="Plus" size={12} /> step</button>
            </div>
          );
        })()}
      </div>
      )}

      <button className="sos" onClick={onOpenSos}><IcoP name="LifeBuoy" size={15} /> Something came up?</button>
      {retrofit && <RetrofitModal roadmap={roadmap} doneTasks={doneTasks} onClose={() => setRetrofit(false)}
        onApply={(plan) => applyPlan(plan, "Plan retrofitted — you're back on track.")} />}
      {toast && <div className="toast"><IcoP name="CheckCircle2" size={15} /> {toast}</div>}
    </div>
  );
}

window.CoachPlanSheet = CoachPlanSheet;

// Shared plan helpers for other modules (Settings hosts the template loader).
window.CoachPlanUtils = {
  // Fetch the base template, prune by the saved profile tokens, and return a
  // roadmap ready for setRoadmap. Throws on network/auth failure.
  async loadDefaultTemplate({ roadmap, doneTasks, setDoneTasks }) {
    const t = await window.CoachAPI.planBaseTemplate();
    const tokens = new Set(loadProfile().tokens || []);
    const sections = (t.sections || []).map(sec => ({
      code: sec.num, title: sec.title, phase: sec.phase || "", months: sec.months || "",
      gate: !!sec.gate, objective: sec.objective || "",
      subs: (sec.subs || [])
        .filter(sub => !(sub.skip_if || []).some(tok => tokens.has(tok)))
        .map(sub => ({ id: sub.id, title: sub.title, days: sub.days || "1w",
          notes: sub.description || "", gate: !!sub.gate }))
    })).filter(sec => sec.subs.length);
    return planToRoadmap({ sections }, roadmap, doneTasks, setDoneTasks);
  }
};
