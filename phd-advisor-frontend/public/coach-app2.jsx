/* coach-app2.jsx — Plan/step view, recovery, chat, settings, router + mount.
   Loads after coach-app.jsx. */

const { useState: useS2, useEffect: useE2, useMemo: useM2, useRef: useR2 } = React;
const Ico = window.Icon;
const RE2 = window.RoadmapEngine;
const H = window.coachHelpers;
const DEFAULT_ACADEMIC_PROGRAM = "PhD, Information Science";
const DEFAULT_ACADEMIC_INSTITUTION = "University of Colorado Boulder";
const ACADEMIC_PLACEHOLDERS = new Set(["string", "undefined", "null", "none", "n/a", "na", "unknown", "choose your program", "select your program", "choose your university", "select your university"]);

function cleanAcademicValue(value) {
  const text = String(value || "").trim();
  if (!text || ACADEMIC_PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
}
function firstAcademicValue(fallback, ...values) {
  let fallbackCandidate = "";
  const cleaned = values.map(cleanAcademicValue);
  cleaned.forEach(value => {
    if (value && !fallbackCandidate) fallbackCandidate = value;
  });
  return cleaned.find(value => value && value !== fallback) || fallbackCandidate || fallback;
}
function academicProgramValue(profile) {
  if (!profile) return "";
  return profile.program && typeof profile.program === "object" ? profile.program.name : profile.program;
}
function academicInstitutionValue(profile) {
  if (!profile) return "";
  if (profile.institution) return profile.institution;
  return profile.program && typeof profile.program === "object" ? profile.program.institution : "";
}
function signedInUserProfile() {
  return (window.CoachAPI && window.CoachAPI.getUser && window.CoachAPI.getUser()) || window.MOCK_USER || {};
}
function buildAcademicProfile(user, prefs = {}, roadmap = null) {
  const roadmapProfile = roadmap?.program ? { program: roadmap.program } : {};
  return {
    ...(user || {}),
    program: firstAcademicValue(
      DEFAULT_ACADEMIC_PROGRAM,
      academicProgramValue(user),
      user?.researchArea,
      prefs.program,
      academicProgramValue(roadmapProfile)
    ),
    institution: firstAcademicValue(
      DEFAULT_ACADEMIC_INSTITUTION,
      academicInstitutionValue(user),
      prefs.institution,
      academicInstitutionValue(roadmapProfile)
    )
  };
}

// ============================================================================
// PLAN / STEP VIEW  (spine + focused current step + live tools)
// ============================================================================
// ---- My Plan CSV (V2 roadmap model) ---------------------------------------
// Import/export the plan as a flat CSV so students can edit it in a spreadsheet
// and bring it back — the convenience the spreadsheet build had, on this UI.
// Subtask lettering to mirror the spreadsheet: step 1 → 1a, 1b, 1c … (a-z, aa…).
const planLetter = (n) => { let s = ""; n = Math.max(0, Math.floor(n)); do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const planCsvEsc = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function planToCsv(roadmap, doneTasks) {
  const rows = [["code", "title", "phase", "timeline", "objective", "gate", "status"]];
  (roadmap.steps || []).forEach((s, i) => {
    rows.push([i + 1, s.title, s.phase || "", s.estimate || "", s.objective || "", s.gate ? "gate" : "", s.status || ""]);
    (s.subtasks || []).forEach((t, j) => {
      const done = doneTasks && doneTasks.has(`${s.id}::${t}`);
      rows.push([`${i + 1}${planLetter(j)}`, t, "", "", "", "", done ? "done" : "todo"]);
    });
  });
  return rows.map(r => r.map(planCsvEsc).join(",")).join("\n");
}
function parsePlanCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function csvToRoadmap(text, base, stamp) {
  const rows = parsePlanCsv(text); if (!rows.length) return null;
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const ci = { code: col("code"), title: col("title"), phase: col("phase"), timeline: col("timeline"), objective: col("objective"), gate: col("gate"), status: col("status") };
  if (ci.code < 0 || ci.title < 0) return null;
  const steps = []; const done = new Set();
  const g = (r, k) => ci[k] >= 0 ? (r[ci[k]] || "").trim() : "";
  rows.slice(1).forEach(r => {
    const code = (r[ci.code] || "").trim(); const title = (r[ci.title] || "").trim();
    if (!code || !title) return;
    if (/^\d+$/.test(code)) {
      steps.push({ id: `csv-${stamp}-${steps.length}`, title, phase: g(r, "phase") || "Custom", icon: "Flag",
        estimate: g(r, "timeline"), objective: g(r, "objective"), gate: /gate|true|1/i.test(g(r, "gate")),
        status: g(r, "status") || "locked", subtasks: [], add: [], retire: [], custom: true });
    } else if (steps.length) {
      const s = steps[steps.length - 1]; s.subtasks.push(title);
      if (/done/i.test(g(r, "status"))) done.add(`${s.id}::${title}`);
    }
  });
  if (!steps.length) return null;
  if (!steps.some(s => s.status === "current" || s.status === "redo")) {
    const idx = steps.findIndex(s => s.status !== "done");
    steps[idx >= 0 ? idx : 0].status = "current";
  }
  return { roadmap: { ...base, steps }, done };
}

// Inline "how to do this" walkthrough for one subtask — the AI writes concrete
// mini-steps you can check off (ported from the spreadsheet's row expansion),
// cached per subtask in localStorage. Degrades to an "ask your advisors" link.
const PLAN_WT_KEY = "phd-plan-walkthrough-v1";
function PlanHowTo({ roadmap, step, sub, code, onAsk }) {
  const wtId = `${step.id}::${sub}`;
  const readAll = () => { try { return JSON.parse(localStorage.getItem(PLAN_WT_KEY) || "{}"); } catch (e) { return {}; } };
  const [entry, setEntry] = useS2(() => readAll()[wtId] || null);
  const [busy, setBusy] = useS2(false);
  const [err, setErr] = useS2("");
  const save = (next) => { const m = readAll(); m[wtId] = next; try { localStorage.setItem(PLAN_WT_KEY, JSON.stringify(m)); } catch (e) {} setEntry(next); };
  const authed = window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed();
  const gen = async () => {
    if (!window.CoachAPI || !window.CoachAPI.planWalkthrough) { setErr("Sign in with the backend running for AI walkthroughs."); return; }
    setBusy(true); setErr("");
    try {
      const res = await window.CoachAPI.planWalkthrough({
        title: sub, section: step.title, objective: step.objective,
        program: roadmap.program && roadmap.program.name,
        field: roadmap.program && roadmap.program.name
      });
      save({ wt: res, checked: [] });
    } catch (e) { setErr(e.message || "Couldn't reach the assistant — is the backend running?"); }
    finally { setBusy(false); }
  };
  useE2(() => { if (!entry && authed) gen(); }, []);
  const wt = entry && entry.wt;
  const checked = new Set((entry && entry.checked) || []);
  const toggle = (i) => { const n = new Set(checked); n.has(i) ? n.delete(i) : n.add(i); save({ ...entry, checked: [...n] }); };
  const steps = (wt && wt.steps) || [];
  const doneN = steps.filter((_, i) => checked.has(i)).length;
  return (
    <div className="howto">
      {busy && !wt && <div className="howto-load"><Ico name="Loader" size={13} className="spin" /> Writing the how-to for {code}…</div>}
      {err && <div className="howto-err"><Ico name="AlertTriangle" size={12} /> {err} {authed && <button className="btn sm" onClick={gen}>Retry</button>}</div>}
      {!busy && !wt && !err && (
        <button className="btn sm primary" onClick={gen}><Ico name="Sparkles" size={13} color="#fff" /> Show me how to do this</button>
      )}
      {wt && (
        <>
          {wt.overview && <p className="howto-overview">{wt.overview}</p>}
          <div className="howto-h"><Ico name="ListChecks" size={12} /> How to do {code} · {doneN}/{steps.length}
            <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={gen} disabled={busy} title="Rewrite the walkthrough"><Ico name={busy ? "Loader" : "RefreshCw"} size={12} className={busy ? "spin" : ""} /> Regenerate</button>
          </div>
          <div className="howto-steps">
            {steps.map((st, i) => (
              <button key={i} className={`howto-step ${checked.has(i) ? "done" : ""}`} onClick={() => toggle(i)}>
                <span className="howto-cb">{checked.has(i) && <Ico name="Check" size={11} color="#fff" />}</span>
                <span className="howto-step-t">{st.title || st.text || st}{st.detail ? <span className="howto-step-d">{st.detail}</span> : null}</span>
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={() => onAsk && onAsk(`I'm a PhD student working on "${step.title}". Walk me through, step by step, how to: ${sub} Assume I'm new to this and give concrete first actions.`)}>
            <Ico name="MessageCircle" size={13} /> Ask your advisors for more
          </button>
        </>
      )}
    </div>
  );
}

function PlanView({ roadmap, setRoadmap, doneTasks, setDoneTasks, activity, touchStep, onCelebrate, onOpenSos, onAsk, onNav, onOpenStep, skillsUnlocked = true, searchTarget }) {
  const [selected, setSelected] = useS2(() => {
    const c = roadmap.steps.findIndex(s => s.status === "current");
    return c >= 0 ? c : 0;
  });
  const [openTask, setOpenTask] = useS2(-1); // which sub-task's "how to" drawer is open
  const [editPlan, setEditPlan] = useS2(false); // full inline editing of everything
  const [dragIdx, setDragIdx] = useS2(null);
  const [renameId, setRenameId] = useS2(null);
  const csvRef = React.useRef(null);

  // Move a milestone from index `from` to index `to`, keeping the selection on it.
  const moveStep = (from, to) => {
    if (to < 0 || to >= roadmap.steps.length || from === to) return;
    const steps = roadmap.steps.slice();
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    setRoadmap({ ...roadmap, steps });
    setSelected(steps.findIndex(s => s.id === moved.id));
  };
  const renameStep = (id, title) => setRoadmap({ ...roadmap, steps: roadmap.steps.map(s => s.id === id ? { ...s, title } : s) });
  const [taskEdit, setTaskEdit] = useS2(null);   // subtask index being renamed
  const [newTask, setNewTask] = useS2("");
  const [selectedSub, setSelectedSub] = useS2(null); // sub-milestone open in the sheet (null = major)
  // Which milestones have their sub-milestones revealed in the spine (caret
  // toggle, spreadsheet-style). Current/redo milestones start expanded.
  const [spineOpen, setSpineOpen] = useS2(() => new Set(
    roadmap.steps.filter(s => s.status === "current" || s.status === "redo").map(s => s.id)
  ));
  const toggleSpine = (id, e) => {
    if (e) e.stopPropagation();
    setSpineOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  useE2(() => { setTaskEdit(null); setNewTask(""); setOpenTask(-1); }, [selected]);
  useE2(() => {
    if (!searchTarget?.stepId) return;
    const stepIndex = roadmap.steps.findIndex(item => item.id === searchTarget.stepId);
    if (stepIndex < 0) return;
    const taskIndex = Number.isInteger(searchTarget.taskIndex) &&
      searchTarget.taskIndex >= 0 &&
      searchTarget.taskIndex < (roadmap.steps[stepIndex].subtasks || []).length
      ? searchTarget.taskIndex
      : null;
    setSelected(stepIndex);
    setSelectedSub(taskIndex);
    setSpineOpen(previous => new Set(previous).add(searchTarget.stepId));
  }, [searchTarget?.nonce]);

  const step = roadmap.steps[selected];
  const activeCount = roadmap.steps.filter(s => s.status === "current" || s.status === "redo").length;

  const patchStep = (patch) => setRoadmap({ ...roadmap, steps: roadmap.steps.map(s => s.id === step.id ? { ...s, ...patch } : s) });
  const stepNum = selected + 1;
  const isCurrent = step.status === "current" || step.status === "redo" || step.status === "paused";
  const isDone = step.status === "done";
  const tkey = (t) => `${step.id}::${t}`;
  const doneN = step.subtasks.filter(t => doneTasks.has(tkey(t))).length;
  const allDone = doneN === step.subtasks.length;
  const risks = RE2.risks ? RE2.risks(step.templateId || step.id) : [];
  const stuck = H.stallDays ? H.stallDays(roadmap, activity) : 0;
  const stepIsCurrentNow = step.status === "current" || step.status === "redo";
  // Sub-milestone view (spreadsheet-style 2a/2b rows opened from the spine).
  const subT = selectedSub != null ? step.subtasks[selectedSub] : null;
  const subView = !editPlan && subT != null;
  const subCode = subView ? `${stepNum}${planLetter(selectedSub)}` : "";

  const toggleTask = (t) => {
    setDoneTasks(prev => { const n = new Set(prev); const k = tkey(t); n.has(k) ? n.delete(k) : n.add(k); return n; });
    touchStep && touchStep(step.id);
  };
  const setCurrent = (id) => {
    const res = RE2.setCurrent(roadmap, id);
    setRoadmap(res.roadmap);
    touchStep && touchStep(id);
    const i = res.roadmap.steps.findIndex(s => s.id === id);
    if (i >= 0) setSelected(i);
  };
  const complete = (id) => {
    const res = RE2.markComplete(roadmap, id);
    setRoadmap(res.roadmap);
    onCelebrate(res);
    const ni = res.roadmap.steps.findIndex(s => s.status === "current");
    if (ni >= 0) { touchStep && touchStep(res.roadmap.steps[ni].id); setSelected(ni); }
  };
  const workAlso = (id) => { setRoadmap(RE2.addCurrent(roadmap, id).roadmap); touchStep && touchStep(id); };
  const stopHere = (id) => setRoadmap(RE2.stopCurrent(roadmap, id).roadmap);

  // ---- Subtask (todo) editing ----------------------------------------------
  const setSubtasks = (subs) => patchStep({ subtasks: subs });
  const addTask = () => {
    const t = newTask.trim();
    if (!t || step.subtasks.includes(t)) return;
    setSubtasks([...step.subtasks, t]);
    setNewTask("");
  };
  const removeTask = (i) => {
    const t = step.subtasks[i];
    setSubtasks(step.subtasks.filter((_, j) => j !== i));
    setDoneTasks(prev => { const n = new Set(prev); n.delete(tkey(t)); return n; });
    if (openTask === i) setOpenTask(-1);
  };
  const renameTask = (i, text) => {
    const old = step.subtasks[i];
    const t = text.trim();
    setTaskEdit(null);
    if (!t || t === old || step.subtasks.includes(t)) return;
    setSubtasks(step.subtasks.map((x, j) => j === i ? t : x));
    setDoneTasks(prev => {
      const n = new Set(prev);
      if (n.has(tkey(old))) { n.delete(tkey(old)); n.add(`${step.id}::${t}`); }
      return n;
    });
  };
  const moveSub = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= step.subtasks.length) return;
    const arr = step.subtasks.slice(); const [m] = arr.splice(i, 1); arr.splice(j, 0, m);
    setSubtasks(arr);
  };

  // ---- Add / remove plan sections -------------------------------------------
  const makeMilestone = () => ({
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    title: "New milestone", phase: step?.phase || "Custom", icon: "Flag",
    estimate: "You set the pace", objective: "Describe what finishing this section looks like.",
    status: "locked", subtasks: [], add: [], retire: [], custom: true
  });
  const addMilestoneAt = (index) => {
    const s = makeMilestone();
    const steps = roadmap.steps.slice();
    steps.splice(index, 0, s);
    setRoadmap({ ...roadmap, steps });
    setSelected(index);
    setEditPlan(true);
    setRenameId(s.id);
  };
  const addMilestone = () => addMilestoneAt(selected + 1);
  const removeStepById = (id) => {
    if (roadmap.steps.length <= 1) return;
    const victim = roadmap.steps.find(s => s.id === id);
    if (!victim || !confirm(`Remove "${victim.title}" from your plan?`)) return;
    let steps = roadmap.steps.filter(s => s.id !== id);
    if (!steps.some(s => s.status === "current" || s.status === "redo")) {
      const idx = steps.findIndex(s => s.status !== "done");
      if (idx >= 0) steps = steps.map((s, i) => i === idx ? { ...s, status: "current" } : s);
    }
    setRoadmap({ ...roadmap, steps });
    setSelected(sel => Math.max(0, Math.min(sel, steps.length - 1)));
  };

  // ---- CSV import / export ---------------------------------------------------
  const exportCsv = () => {
    const blob = new Blob([planToCsv(roadmap, doneTasks)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `my-plan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const importCsv = (e) => {
    const file = e.target.files && e.target.files[0]; if (e.target) e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = csvToRoadmap(String(reader.result || ""), roadmap, Date.now());
      if (!parsed) { alert("Couldn't read that CSV. It needs a header row with at least: code, title (plus optional phase, timeline, objective, gate, status). Tip: export first to see the format."); return; }
      if (!confirm("Replace your current plan with this CSV? Your progress checkmarks come from the file's status column.")) return;
      setRoadmap(parsed.roadmap);
      if (setDoneTasks) setDoneTasks(parsed.done);
      setSelected(0);
    };
    reader.readAsText(file);
  };

  const doneCount = roadmap.steps.filter(s => s.status === "done").length;
  const pct = Math.round((doneCount / roadmap.steps.length) * 100);
  const nextGate = roadmap.steps.find(s => s.gate && s.status !== "done");
  const stepPct = step.subtasks.length ? Math.round((doneN / step.subtasks.length) * 100) : 0;

  let lastPhase = null;

  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 12, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {editPlan ? (
            <input className="pe-input pe-title" style={{ fontSize: 24, fontWeight: 600 }} value={roadmap.program?.name || ""}
              onChange={e => setRoadmap({ ...roadmap, program: { ...(roadmap.program || {}), name: e.target.value } })}
              placeholder="Name your plan" />
          ) : (
            <h1 className="display" style={{ fontSize: 24 }}>{roadmap.program?.name || "Your plan"}</h1>
          )}
          <div className="sub">{doneCount} of {roadmap.steps.length} milestones complete · {pct}%</div>
        </div>
        <div className="plan-toolbar">
          <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={importCsv} />
          <button className="btn sm" onClick={() => csvRef.current && csvRef.current.click()} title="Replace your plan from a CSV file"><Ico name="Upload" size={13} /> Import CSV</button>
          <button className="btn sm" onClick={exportCsv} title="Download your plan as a CSV to edit in a spreadsheet"><Ico name="Download" size={13} /> Export CSV</button>
          <button className="btn sm" onClick={addMilestone} title="Add a new section after the selected one"><Ico name="Plus" size={13} /> Add section</button>
          <button className={`btn sm ${editPlan ? "primary" : ""}`} onClick={() => { setEditPlan(e => !e); setRenameId(null); setSelectedSub(null); }}>
            <Ico name={editPlan ? "Check" : "Pencil"} size={14} color={editPlan ? "#fff" : undefined} /> {editPlan ? "Done editing" : "Edit plan"}
          </button>
        </div>
      </div>

      {/* Graduation slider — your walk from Start to the cap, plus what's now/next */}
      <div className="plan-glance">
        <div className="grad-slider">
          <span className="grad-end start" title="Start"><Ico name="Flag" size={11} /></span>
          <div className="grad-track">
            <div className="grad-fill" style={{ width: `${pct}%` }} />
            <div className="grad-cap" style={{ left: `${pct}%` }} title={`${pct}% · ${doneCount} of ${roadmap.steps.length} milestones`}>
              <Ico name="GraduationCap" size={13} color="#fff" />
            </div>
          </div>
          <span className="grad-end finish" title="Graduation"><Ico name="GraduationCap" size={15} /></span>
        </div>
        <div className="plan-glance-meta">
          <span className="pg-chip strong"><Ico name="GraduationCap" size={12} /> {pct}% · {doneCount}/{roadmap.steps.length} milestones</span>
          {isCurrent && !editPlan && <span className="pg-chip"><Ico name="MapPin" size={12} /> Now: <strong>{step.title}</strong></span>}
          {nextGate && <span className="pg-chip"><Ico name="Flag" size={12} /> Next gate: <strong>{nextGate.title}</strong></span>}
          {editPlan && <span className="pg-chip edit"><Ico name="Pencil" size={12} /> Editing — everything below is editable; drag to reorder.</span>}
        </div>
      </div>

      <div className="step-wrap">
        {/* Spine */}
        <div className="spine">
          {editPlan && <button className="btn sm spine-add" style={{ marginBottom: 8 }} onClick={() => addMilestoneAt(0)}><Ico name="Plus" size={14} /> Add section at top</button>}
          {roadmap.steps.map((s, i) => {
            const showPhase = s.phase !== lastPhase; lastPhase = s.phase;
            const dotClass = s.status === "done" ? "done" : s.status === "current" ? "current"
              : s.recovery || s.status === "redo" || s.status === "paused" ? "recovery" : "locked";
            return (
              <React.Fragment key={s.id}>
                {showPhase && <div className="spine-phase">{s.phase}</div>}
                {editPlan ? (
                  <div className={`spine-item editing ${i === selected ? "sel" : ""} ${dragIdx === i ? "dragging" : ""}`}
                    draggable onDragStart={() => setDragIdx(i)} onDragOver={e => e.preventDefault()}
                    onDrop={() => { if (dragIdx != null) moveStep(dragIdx, i); setDragIdx(null); }} onDragEnd={() => setDragIdx(null)}
                    onClick={() => setSelected(i)}>
                    <span className="spine-drag" title="Drag to reorder"><Ico name="GripVertical" size={15} /></span>
                    <span className={`spine-dot ${dotClass} ${s.gate ? "gate" : ""}`}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {renameId === s.id ? (
                        <input className="spine-rename" autoFocus defaultValue={s.title}
                          onClick={e => e.stopPropagation()}
                          onBlur={e => { renameStep(s.id, e.target.value.trim() || s.title); setRenameId(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { renameStep(s.id, e.target.value.trim() || s.title); setRenameId(null); } }} />
                      ) : (
                        <span className="spine-t1" onClick={e => { e.stopPropagation(); setRenameId(s.id); }} title="Rename">{s.title} <Ico name="Pencil" size={11} /></span>
                      )}
                    </span>
                    <span className="spine-move">
                      <button disabled={i === 0} onClick={e => { e.stopPropagation(); moveStep(i, i - 1); }} aria-label="Move up"><Ico name="ChevronUp" size={14} /></button>
                      <button disabled={i === roadmap.steps.length - 1} onClick={e => { e.stopPropagation(); moveStep(i, i + 1); }} aria-label="Move down"><Ico name="ChevronDown" size={14} /></button>
                    </span>
                    <button className="spine-del" disabled={roadmap.steps.length <= 1} onClick={e => { e.stopPropagation(); removeStepById(s.id); }} aria-label="Remove milestone" title="Remove this section"><Ico name="Trash2" size={13} /></button>
                  </div>
                ) : (
                  <>
                  <button className={`spine-item ${i === selected && selectedSub == null ? "sel" : ""}`}
                    onClick={() => { setSelected(i); setSelectedSub(null); setSpineOpen(prev => new Set(prev).add(s.id)); }}>
                    <span className={`spine-dot ${dotClass} ${s.gate ? "gate" : ""}`}>
                      {s.status === "done" ? <Ico name="Check" size={14} color="#fff" />
                        : s.recovery ? <Ico name="AlertTriangle" size={13} color="#fff" /> : i + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {/* No "gate" badge here any more — a gate is already legible
                          from its ringed dot, and the row reads better with the
                          disclosure caret in that space. "redo" stays: it is a
                          state you have to act on, not a property of the step. */}
                      <span className="spine-t1">{s.title}{s.status === "redo" && <span className="spine-flag">redo</span>}</span>
                    </span>
                    {s.subtasks.length > 0 && (
                      <span className={`spine-caret ${spineOpen.has(s.id) ? "open" : ""}`} role="button"
                        aria-label={spineOpen.has(s.id) ? "Hide sub-milestones" : "Show sub-milestones"}
                        onClick={(e) => toggleSpine(s.id, e)}>
                        <Ico name="ChevronDown" size={14} />
                      </span>
                    )}
                  </button>
                  {spineOpen.has(s.id) && s.subtasks.length > 0 && (
                    <div className="spine-subs">
                      {s.subtasks.map((t, j) => {
                        const sd = doneTasks.has(`${s.id}::${t}`);
                        const isSel = i === selected && selectedSub === j;
                        return (
                          <button key={j} className={`spine-sub ${isSel ? "sel" : ""} ${sd ? "done" : ""}`}
                            onClick={() => { setSelected(i); setSelectedSub(isSel ? null : j); }}>
                            <span className="spine-sub-code">{i + 1}{planLetter(j)}</span>
                            <span className="spine-sub-t">{t}</span>
                            {sd && <Ico name="Check" size={11} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </>
                )}
              </React.Fragment>
            );
          })}
          <button className="btn sm spine-add" onClick={addMilestone}><Ico name="Plus" size={14} /> Add your own section</button>
        </div>

        {/* Step sheet */}
        <div>
          {subView ? (
            <>
              {/* Sub-milestone sheet: its own head, the milestone's tips, and
                  the how-to walkthrough as its concrete steps to complete. */}
              <div className="step-head">
                <div className="step-num" style={{ fontSize: 16 }}>{subCode}</div>
                <div style={{ flex: 1 }}>
                  <div className="eyebrow"><Ico name="CornerDownRight" size={13} /> Milestone {stepNum} · {step.title}</div>
                  <h1 className="display" style={{ fontSize: 24 }}>{subT}</h1>
                  <div className="meta">
                    <span className={`chip ${doneTasks.has(tkey(subT)) ? "deliv-sat" : ""}`}>
                      <Ico name={doneTasks.has(tkey(subT)) ? "CheckCircle2" : "Circle"} size={12} /> {doneTasks.has(tkey(subT)) ? "Done" : "To do"}
                    </span>
                    <span className="chip"><Ico name="ListChecks" size={12} /> Sub-milestone {selectedSub + 1} of {step.subtasks.length}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button className="btn soft" onClick={() => toggleTask(subT)}>
                    <Ico name={doneTasks.has(tkey(subT)) ? "Undo2" : "Check"} size={14} /> {doneTasks.has(tkey(subT)) ? `Mark ${subCode} not done` : `Mark ${subCode} done`}
                  </button>
                  <button className="btn" onClick={() => setSelectedSub(null)}><Ico name="ArrowLeft" size={14} /> Back to milestone {stepNum}</button>
                </div>
              </div>
              {risks.length > 0 && (
                <div className="risks">
                  <div className="risks-h"><Ico name="Lightbulb" size={14} /> What trips people up here</div>
                  <ul className="risks-list">
                    {risks.map((r, i) => <li key={i}><Ico name="AlertTriangle" size={12} /> <span>{r}</span></li>)}
                  </ul>
                </div>
              )}
              <div className="section-label"><span className="ic"><Ico name="ListChecks" size={13} /></span> Steps to complete {subCode} — and how to do them</div>
              <div className="subsheet-howto">
                <PlanHowTo key={`${step.id}::${subT}`} roadmap={roadmap} step={step} sub={subT} code={subCode} onAsk={onAsk} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {selectedSub > 0 && <button className="btn sm" onClick={() => setSelectedSub(selectedSub - 1)}><Ico name="ChevronLeft" size={13} /> {stepNum}{planLetter(selectedSub - 1)}</button>}
                {selectedSub < step.subtasks.length - 1 && <button className="btn sm" onClick={() => setSelectedSub(selectedSub + 1)}>{stepNum}{planLetter(selectedSub + 1)} <Ico name="ChevronRight" size={13} /></button>}
              </div>
            </>
          ) : (
          <>
          {editPlan ? (
            <div className="step-head editing">
              <div className="step-num">{stepNum}</div>
              <div style={{ flex: 1 }}>
                <div className="pe-row">
                  <input className="pe-input pe-eyebrow" value={step.phase || ""} onChange={e => patchStep({ phase: e.target.value })} placeholder="Phase (e.g. Research)" />
                  <label className="pe-gate" title="A gate is a formal checkpoint that blocks progress until passed">
                    <input type="checkbox" checked={!!step.gate} onChange={e => patchStep({ gate: e.target.checked })} /> Gate
                  </label>
                </div>
                <input className="pe-input pe-title" value={step.title} onChange={e => patchStep({ title: e.target.value })} placeholder="Milestone title" />
                <textarea className="pe-input pe-obj" value={step.objective || ""} onChange={e => patchStep({ objective: e.target.value })} placeholder="What does finishing this section look like?" rows={2} />
              </div>
              <div className="pe-head-acts">
                <button className="btn sm" onClick={() => addMilestoneAt(selected)} title="Add a section before this one"><Ico name="ArrowUp" size={13} /> Add above</button>
                <button className="btn sm" onClick={() => addMilestoneAt(selected + 1)} title="Add a section after this one"><Ico name="ArrowDown" size={13} /> Add below</button>
                <button className="btn sm danger" disabled={roadmap.steps.length <= 1} onClick={() => removeStepById(step.id)}><Ico name="Trash2" size={13} /> Delete</button>
              </div>
            </div>
          ) : (
            <div className={`step-head ${step.recovery ? "recovery" : ""}`}>
              <div className="step-num">{step.recovery ? "!" : stepNum}</div>
              <div style={{ flex: 1 }}>
                <div className="eyebrow"><Ico name={step.icon} size={13} /> {step.recovery ? "Recovery" : isDone ? "Completed" : `Step ${stepNum} · ${step.phase}`}</div>
                <h1 className="display">{step.title}</h1>
                <p className="obj">{step.objective}</p>
                <div className="meta">
                                    {step.deliverableSource && <span className="chip"><Ico name="FileText" size={12} /> Source: {step.deliverableSource}</span>}
                  {step.deliverable && !step.handbookDerived && <span className="chip deliv-sat"><Ico name="CheckCircle2" size={12} /> Satisfies: {step.deliverable}</span>}
                  {stepIsCurrentNow && stuck >= (H.STALL_DAYS || 14) && (
                    <span className="chip chip-risk"><Ico name="AlertTriangle" size={12} /> Stuck {stuck} days — let's unblock it</span>
                  )}
                </div>
                {step.subtasks.length > 0 && (
                  <div className="pe-prog">
                    <div className="pe-prog-bar"><span style={{ width: `${stepPct}%` }} /></div>
                    <span className="pe-prog-l">{allDone ? "All steps done — nice work." : `${doneN}/${step.subtasks.length} steps done`}</span>
                  </div>
                )}
              </div>
              {!isCurrent ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {!isDone && (
                    <button className="btn soft" onClick={() => workAlso(step.id)} title="Progress is not linear. Keep everything else going and run this in parallel.">
                      <Ico name="Plus" size={14} /> Work on this too
                    </button>
                  )}
                  <button className="btn" onClick={() => setCurrent(step.id)} title="Make this your only active step">
                    <Ico name={isDone ? "Undo2" : "MapPin"} size={14} /> {isDone ? "Step back here" : "Focus only here"}
                  </button>
                </div>
              ) : (
                activeCount > 1 && (
                  <button className="btn" onClick={() => stopHere(step.id)} title="Set this back to not started">
                    <Ico name="Pause" size={14} /> Stop working here
                  </button>
                )
              )}
            </div>
          )}

          {/* What trips people up here — surfaces tacit knowledge at the right moment */}
          {!editPlan && risks.length > 0 && (
            <div className="risks">
              <div className="risks-h"><Ico name="Lightbulb" size={14} /> What trips people up here</div>
              <ul className="risks-list">
                {risks.map((r, i) => <li key={i}><Ico name="AlertTriangle" size={12} /> <span>{r}</span></li>)}
              </ul>
            </div>
          )}

          {isDone && !editPlan && (
            <div className="tip tip-coach" style={{ marginBottom: 16 }}>
              <span className="tip-ico"><Ico name="Check" size={15} color="#fff" /></span>
              <div className="tip-body">You finished this milestone. Browsing it for reference — jump to your current step in the list anytime.</div>
            </div>
          )}

          {/* Committee Builder — full workbench for the committee step */}
          {!editPlan && (step.id === "committee" || step.templateId === "committee") && window.CommitteeBuilder && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Users" size={13} /></span> Committee builder · score real names or get suggestions</div>
              <window.CommitteeBuilder />
            </>
          )}

          {/* Checklist — the heart of the page: milestones to complete + how to
              do each (AI walkthrough on expand). Fully editable in edit mode. */}
          <div className="section-label"><span className="ic"><Ico name="ListChecks" size={13} /></span> Steps to complete &amp; how to do them · {doneN}/{step.subtasks.length}</div>
          <div className="tasklist">
            {editPlan ? (
              step.subtasks.map((t, i) => (
                <div key={i} className="taskrow editing">
                  <div className="taskrow-main">
                    <span className="taskrow-code">{stepNum}{planLetter(i)}</span>
                    <span className="spine-move">
                      <button disabled={i === 0} onClick={() => moveSub(i, -1)} aria-label="Move up"><Ico name="ChevronUp" size={13} /></button>
                      <button disabled={i === step.subtasks.length - 1} onClick={() => moveSub(i, 1)} aria-label="Move down"><Ico name="ChevronDown" size={13} /></button>
                    </span>
                    <input className="spine-rename" style={{ flex: 1 }} defaultValue={t} key={`e-${step.id}-${i}-${t}`}
                      onBlur={e => renameTask(i, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }} />
                    <button className="dv-act danger" onClick={() => removeTask(i)} title="Remove this to-do"><Ico name="X" size={13} /></button>
                  </div>
                </div>
              ))
            ) : (
              step.subtasks.map((t, i) => {
                const d = doneTasks.has(tkey(t));
                const open = openTask === i;
                return (
                  <div key={i} className={`taskrow ${d ? "done" : ""} ${open ? "open" : ""}`}>
                    <div className="taskrow-main">
                      <span className="taskrow-code">{stepNum}{planLetter(i)}</span>
                      <button className="cb" onClick={() => toggleTask(t)} aria-label={d ? "Mark not done" : "Mark done"}>{d && <Ico name="Check" size={12} color="#fff" />}</button>
                      {taskEdit === i ? (
                        <input className="spine-rename" style={{ flex: 1 }} autoFocus defaultValue={t}
                          onBlur={e => renameTask(i, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") renameTask(i, e.target.value); if (e.key === "Escape") setTaskEdit(null); }} />
                      ) : (
                        <button className="taskrow-text" onClick={() => setOpenTask(open ? -1 : i)}>{t}</button>
                      )}
                      <span className="taskrow-tools">
                        <button className="dv-act" onClick={() => setTaskEdit(taskEdit === i ? null : i)} title="Edit this to-do"><Ico name="Pencil" size={13} /></button>
                        <button className="dv-act danger" onClick={() => removeTask(i)} title="Remove this to-do"><Ico name="X" size={13} /></button>
                      </span>
                      <button className="taskrow-go" onClick={() => setOpenTask(open ? -1 : i)} aria-label="How do I do this?">
                        <span className="taskrow-help">How?</span> <Ico name={open ? "ChevronUp" : "ChevronDown"} size={15} />
                      </button>
                    </div>
                    {open && (
                      <div className="taskrow-actions">
                        <PlanHowTo roadmap={roadmap} step={step} sub={t} code={`${stepNum}${planLetter(i)}`} onAsk={onAsk} />
                        {!d && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => { toggleTask(t); setOpenTask(-1); }}><Ico name="Check" size={13} /> Mark {stepNum}{planLetter(i)} done</button>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div className="task-add">
              <input className="def-add-input" value={newTask} onChange={e => setNewTask(e.target.value)}
                placeholder="Add your own to-do for this section..."
                onKeyDown={e => e.key === "Enter" && addTask()} />
              <button className="btn sm" onClick={addTask} disabled={!newTask.trim()}><Ico name="Plus" size={13} /> Add</button>
            </div>
          </div>

          {/* Complete CTA */}
          {isCurrent && !editPlan && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, padding: "18px 20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
              <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>
                {allDone ? <><b style={{ color: "var(--text)" }}>All steps checked.</b> Ready to celebrate this milestone.</> : `${step.subtasks.length - doneN} step${step.subtasks.length - doneN === 1 ? "" : "s"} left`}
              </div>
              <button className="btn primary lg" onClick={() => complete(step.id)} disabled={!allDone}>
                <Ico name="Flag" size={15} color="#fff" /> Complete milestone
              </button>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      <button className="sos" onClick={onOpenSos}><Ico name="LifeBuoy" size={15} /> Something came up?</button>
    </div>
  );
}

// ============================================================================
// CELEBRATION
// ============================================================================
function Celebration({ data, onClose }) {
  if (!data) return null;
  const colors = ["#D9774B", "#E0A23E", "#5E9B6E", "#EC8A5E", "#C8623F"];
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal celebrate" onClick={e => e.stopPropagation()}>
        <div className="celebrate-top">
          <div className="confetti">{Array.from({ length: 16 }).map((_, i) => <i key={i} style={{ left: `${(i*6.2)%100}%`, background: colors[i%colors.length], animationDelay: `${(i%6)*0.18}s` }} />)}</div>
          <div className="celebrate-badge">{data.milestoneNumber}</div>
          <div className="kick">Milestone {data.milestoneNumber} complete</div>
          <h2 className="display">{data.justCompleted.title}</h2>
          <p>{data.nextStep ? `Next: ${data.nextStep.title}` : "You've reached the end — congratulations, Dr.!"}</p>
        </div>
        <div className="celebrate-b">
          {data.retired.length > 0 && (
            <div className="celebrate-sec">
              <div className="cs-l"><Ico name="MinusCircle" size={13} /> Cleared away — you're done with these</div>
              <div>{data.retired.map(f => <span key={f} className="chip-feat" style={{ textDecoration: "line-through", opacity: .7 }}><Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}</span>)}</div>
            </div>
          )}
          {data.nextStep && (
            <div className="celebrate-sec">
              <div className="cs-l"><Ico name="Target" size={13} /> Your next objective</div>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55 }}>{data.nextStep.objective}</p>
            </div>
          )}
          {data.unlocked.length > 0 && (
            <div className="celebrate-sec">
              <div className="cs-l"><Ico name="PlusCircle" size={13} /> New tools to help you get there</div>
              <div>{data.unlocked.map(f => <span key={f} className="chip-feat" style={{ borderColor: "var(--sage)" }}><Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}</span>)}</div>
            </div>
          )}
          <button className="btn primary" style={{ justifyContent: "center" }} onClick={onClose}>
            <Ico name="ArrowRight" size={15} color="#fff" /> {data.nextStep ? "Keep going" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RECOVERY ("Something came up")
// ============================================================================
function RecoveryModal({ open, onClose, onReplan }) {
  const [text, setText] = useS2("");
  const [busy, setBusy] = useS2(false);
  useE2(() => { if (open) { setText(""); setBusy(false); } }, [open]);
  if (!open) return null;
  const examples = [
    "My data collection got rejected — the last batch is contaminated.",
    "My committee chair is leaving the university.",
    "My main analysis came back null.",
    "I'm behind and the scope feels too big."
  ];
  const submit = () => { if (!text.trim()) return; setBusy(true); setTimeout(() => { onReplan(text); setBusy(false); }, 850); };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--rose-soft)", color: "var(--rose)", display: "grid", placeItems: "center", flexShrink: 0 }}><Ico name="LifeBuoy" size={18} /></div>
            <div><h2 className="display">Something came up?</h2><p>Tell me in plain words. I'll reopen the affected milestones and add recovery steps so you're not stuck.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Ico name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <textarea className="modal-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="e.g. I thought my data was fine and moved on, but my committee just told me the last batch was rejected…" autoFocus />
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", margin: "14px 0 8px" }}>Common setbacks</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {examples.map((ex, i) => <button key={i} className="suggest-btn" onClick={() => setText(ex)}>{ex}</button>)}
          </div>
        </div>
        <div className="modal-f">
          <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}><Ico name="Sparkles" size={12} /> AI re-planning</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={!text.trim() || busy}>
              {busy ? <><Ico name="Loader" size={14} color="#fff" className="spin" /> Re-planning…</> : <><Ico name="Wand2" size={14} color="#fff" /> Fix my plan</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CHAT (context-aware)
// ============================================================================
function ChatView({ roadmap, onNav }) {
  const current = roadmap.steps.find(s => s.status === "current") || roadmap.steps[0];
  const advisors = window.ADVISORS || [];
  const [messages, setMessages] = useS2([]);
  const [input, setInput] = useS2("");
  const endRef = useR2(null);
  useE2(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (txt) => {
    const t = (txt ?? input).trim(); if (!t) return;
    setMessages(p => [...p, { id: "u" + Date.now(), type: "user", content: t }]);
    setInput("");
    setTimeout(() => {
      const responders = advisors.slice(0, 2);
      setMessages(p => [...p, ...responders.map((a, i) => ({
        id: "a" + Date.now() + i, type: "advisor", personaId: a.id,
        content: `**On "${current.title}":** here's how I'd approach that.\n\n- Tie it back to your current objective\n- Keep scope tight for this milestone\n- (Demo reply — wire to /chat-stream)`
      }))]);
    }, 650);
  };

  const hasMsgs = messages.length > 0;
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "advisor") { const g = []; while (i < messages.length && messages[i].type === "advisor") { g.push(messages[i]); i++; } i--; groups.push({ k: "a", g }); }
    else groups.push({ k: "u", m: messages[i] });
  }

  return (
    <div className="chat-wrap">
      <div className="chat-context" style={{ marginTop: 14 }}>
        <Ico name="MapPin" size={14} /> Chatting about: <strong>&nbsp;{current.title}</strong>
        <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => onNav("plan")}>Open in plan <Ico name="ArrowRight" size={13} /></button>
      </div>
      <div className="chat-scroll">
        {!hasMsgs ? (
          <>
            <div className="chat-welcome">
              <h2 className="display">How can I help with {current.title.toLowerCase()}?</h2>
              <p>Your advisors know where you are in your plan and will tailor advice to this step.</p>
            </div>
            <div className="advisor-rail">
              {advisors.slice(0, 3).map(a => (
                <div key={a.id} className="advisor-pill">
                  <div className="ap-i" style={{ background: a.color }}><Ico name={a.icon} size={16} color="#fff" /></div>
                  <div><div className="ap-n">{a.name}</div><div className="ap-r">{a.role}</div></div>
                </div>
              ))}
            </div>
            <div className="suggest-grid">
              {(window.CHAT_SUGGESTIONS || []).slice(0, 2).map(cat => (
                <div key={cat.title} className="suggest-cat">
                  <div className="sc-h"><span className="sc-i" style={{ background: cat.bg, color: cat.color }}><Ico name={cat.icon} size={15} /></span><span className="sc-t" style={{ color: cat.color }}>{cat.title}</span></div>
                  {cat.items.map(q => <button key={q} className="suggest-btn" onClick={() => send(q)}>{q}</button>)}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {groups.map((gr, gi) => gr.k === "u" ? (
              <div className="msg-user" key={gr.m.id}><div className="b">{gr.m.content}</div></div>
            ) : (
              <div className="msg-adv-row" key={gi}>
                {gr.g.map(m => { const a = H.advisorById(m.personaId); return (
                  <div className="msg-adv" key={m.id} style={{ borderTopColor: a.color }}>
                    <div className="ma-h"><div className="ma-i" style={{ background: a.color }}><Ico name={a.icon} size={14} color="#fff" /></div><div><div className="ma-n">{a.name}</div><div className="ma-r">{a.role}</div></div></div>
                    <div className="ma-b" dangerouslySetInnerHTML={{ __html: H.boldMd(m.content) }} />
                  </div>
                ); })}
              </div>
            ))}
            <div ref={endRef} />
          </>
        )}
      </div>
      <div className="chat-input-bar">
        <div className="chat-input">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Ask about ${current.title.toLowerCase()}…`} />
          <div className="ci-row">
            <div className="ci-tools"><button title="Attach"><Ico name="Paperclip" size={16} /></button><button title="Advisors"><Ico name="Users" size={16} /></button></div>
            <button className="btn primary sm" disabled={!input.trim()} onClick={() => send()}><Ico name="Send" size={14} color="#fff" /> Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SETTINGS (light)
// ============================================================================
// Mini help center — static content for anyone who gets lost.
const HELP_GLOSSARY = [
  ["Milestone / step", "One stage of the PhD journey — each has its own objective, tools, and checklist."],
  ["Gate", "A major checkpoint (prelim, proposal defense, candidacy). Clearing one unlocks the next phase."],
  ["Perspective", "An optional analytical emphasis for a PhD Navigator answer, such as methods, theory, critique, or stakeholders."],
  ["Action", "A visible task that creates something useful in your Workspace or Documents."],
  ["Deliverable", "Something your program requires you to produce — a form, an exam, a document."],
  ["Recovery / re-plan", "When something goes wrong, describe it and your plan re-routes with concrete steps."],
  ["ABD", "“All But Dissertation” — everything's done except writing and defending."],
  ["IRB", "Institutional Review Board — approval needed before research involving human participants."],
  ["Prelim / Comprehensive exam", "Early exams proving you've absorbed your field before advancing."],
  ["Candidacy", "Officially cleared to do dissertation research (the paperwork after prelims)."]
];
const HELP_FAQ = [
  ["Why don't I see Actions yet?", "Actions unlock after 5 chat messages — or turn on “Reveal everything now” in Settings → Feature unlocks."],
  ["How do I simplify my home screen?", "Set Display density to “Just what I need” in Settings."],
  ["Something went wrong with my research", "Use “Something came up?” on Home or My Plan — describe it in plain words and your plan re-routes around it."],
  ["Are my conversations private?", "Choose on-device / private models in Settings to keep processing local (slightly lower accuracy)."],
  ["How do I get every feature right now?", "Settings → Feature unlocks → Reveal everything now."]
];
const SETTINGS_INSTITUTIONS = window.UNIVERSITY_OPTIONS || [];
const SETTINGS_PROGRAMS = window.PROGRAM_OPTIONS || [];

// ============================================================================
// IMPORTANT FACULTY — who matters to your PhD, their role, and how often you
// mean to meet them. Overdue meetings get flagged here and in the morning brief.
// ============================================================================
const FACULTY_KEY = "phd-coach-faculty-v1";
const FACULTY_ROLES = ["Advisor", "Co-advisor", "Committee chair", "Committee member", "Mentor", "Collaborator", "Program director"];
const FACULTY_CADENCES = [
  ["weekly", "Weekly", 7], ["biweekly", "Every 2 weeks", 14], ["monthly", "Monthly", 31],
  ["quarterly", "Quarterly", 92], ["as-needed", "As needed", 0]
];
const cadenceDays = (c) => (FACULTY_CADENCES.find(x => x[0] === c) || [0, "", 0])[2];
const cadenceLabel = (c) => (FACULTY_CADENCES.find(x => x[0] === c) || ["", "As needed"])[1];
function facultyMeetState(f) {
  const days = cadenceDays(f.cadence);
  if (!days) return null;
  if (!f.lastMet) return { overdue: true, text: "no meeting logged yet" };
  const since = Math.floor((Date.now() - new Date(f.lastMet + "T00:00:00")) / 86400000);
  if (isNaN(since)) return null;
  if (since > days) return { overdue: true, text: `overdue — last met ${since}d ago` };
  return { overdue: false, text: `last met ${since === 0 ? "today" : since + "d ago"}` };
}

function FacultyCard() {
  const [items, setItems] = window.useSyncedStore(FACULTY_KEY, [], "faculty");
  const [f, setF] = useS2({ name: "", role: FACULTY_ROLES[0], cadence: "biweekly", email: "" });
  const add = () => {
    if (!f.name.trim()) return;
    setItems([...items, { id: "f" + Date.now(), ...f, name: f.name.trim(), email: f.email.trim(), lastMet: "" }]);
    setF({ name: "", role: FACULTY_ROLES[0], cadence: "biweekly", email: "" });
  };
  const patch = (id, p) => setItems(items.map(x => x.id === id ? { ...x, ...p } : x));
  const metToday = (id) => patch(id, { lastMet: new Date().toISOString().slice(0, 10) });

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-h"><span className="ico"><Ico name="Users" size={14} /></span> Important faculty</div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "2px 0 10px" }}>
        Advisors, committee members, and mentors — with how often you want to meet, so nobody slips through the cracks.
      </div>
      <div className="fac-add">
        <input style={{ flex: 2 }} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Name (e.g. Dr. Rivera)" />
        <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })} aria-label="Role">
          {FACULTY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={f.cadence} onChange={e => setF({ ...f, cadence: e.target.value })} aria-label="Meeting cadence">
          {FACULTY_CADENCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button className="tool-add" onClick={add} aria-label="Add faculty member"><Ico name="Plus" size={14} /></button>
      </div>
      <div className="fac-add" style={{ marginTop: 6 }}>
        <input style={{ flex: 1 }} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Email (optional — lets email import spot their readings)" />
      </div>
      <div className="fac-list">
        {items.length === 0 && <div className="tool-empty">No faculty added yet. Start with your advisor.</div>}
        {items.map(m => { const ms = facultyMeetState(m); return (
          <div key={m.id} className="fac-row">
            <span className="fac-av">{(m.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("")}</span>
            <div className="fac-main">
              <span className="fac-name">{m.name}{m.email && <a className="fac-mail" href={`mailto:${m.email}`} title={m.email}><Ico name="Mail" size={11} /></a>}</span>
              <span className="fac-meta">
                <select className="fac-inline" value={m.role} onChange={e => patch(m.id, { role: e.target.value })} aria-label="Role">
                  {FACULTY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                ·
                <select className="fac-inline" value={m.cadence} onChange={e => patch(m.id, { cadence: e.target.value })} aria-label="Meeting cadence">
                  {FACULTY_CADENCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </span>
              {ms && <span className={`fac-state ${ms.overdue ? "overdue" : ""}`}><Ico name={ms.overdue ? "AlertTriangle" : "CheckCircle2"} size={11} /> {ms.text}</span>}
            </div>
            <button className="btn sm" onClick={() => metToday(m.id)} title="Log that you met today"><Ico name="CalendarCheck" size={13} /> Met today</button>
            <button className="tool-del" onClick={() => setItems(items.filter(x => x.id !== m.id))} aria-label="Remove"><Ico name="X" size={12} /></button>
          </div>
        ); })}
      </div>
    </div>
  );
}

// ============================================================================
// CALENDAR & MAIL — Google / Outlook connections powering the morning brief,
// deadline sync, and reading-queue email import.
// ============================================================================
function IntegrationsCard() {
  const [status, setStatus] = useS2(null);
  const [busy, setBusy] = useS2("");
  const [err, setErr] = useS2("");
  const refresh = () => {
    if (!window.CoachAPI || !window.CoachAPI.isAuthed()) return;
    window.CoachAPI.integrationsStatus().then(setStatus).catch(() => setStatus(null));
  };
  useE2(() => {
    refresh();
    const onMsg = (e) => {
      if (e.data && e.data.type === "phd-integration") {
        refresh();
        try { sessionStorage.removeItem("phd-coach-brief-v1"); } catch (x) {}
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const connect = async (provider) => {
    setBusy(provider); setErr("");
    try {
      const { auth_url } = await window.CoachAPI.integrationConnect(provider);
      window.open(auth_url, "phd-oauth", "width=540,height=680,menubar=no,toolbar=no");
    } catch (e) {
      setErr(e.message || `Couldn't start the ${provider} connection.`);
    } finally { setBusy(""); }
  };
  const disconnect = async (provider) => {
    setBusy(provider);
    try { await window.CoachAPI.integrationDisconnect(provider); refresh(); } catch (e) {}
    setBusy("");
    try { sessionStorage.removeItem("phd-coach-brief-v1"); } catch (x) {}
  };

  const row = (provider, label, icon, blurb) => {
    const s = (status || {})[provider] || {};
    return (
      <div className="intg-row" key={provider}>
        <span className="intg-ico"><Ico name={icon} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{label}
            {s.connected && <span className="intg-on"><Ico name="CheckCircle2" size={11} /> connected{s.account_email ? ` · ${s.account_email}` : ""}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{blurb}</div>
        </div>
        {s.connected ? (
          <button className="btn sm" disabled={busy === provider} onClick={() => disconnect(provider)}><Ico name="Unplug" size={13} /> Disconnect</button>
        ) : (
          <button className="btn sm primary" disabled={busy === provider || status === null || s.configured === false}
            title={s.configured === false ? "Not configured on this server — set the OAuth env vars" : undefined}
            onClick={() => connect(provider)}>
            <Ico name="Plug" size={13} color="#fff" /> Connect
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="card-h"><span className="ico"><Ico name="CalendarDays" size={14} /></span> Calendar &amp; mail</div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "2px 0 10px" }}>
        Connect a calendar to see your next meeting on Home, sync deadlines, and let email import pull readings your advisor sends you.
      </div>
      {row("google", "Google Calendar + Gmail", "Calendar", "Morning brief, deadline sync, and reading import from Gmail.")}
      {row("microsoft", "Outlook Calendar + Mail", "CalendarDays", "Morning brief, deadline sync, and reading import from Outlook.")}
      {err && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--rose)", display: "flex", gap: 6, alignItems: "center" }}><Ico name="AlertTriangle" size={13} /> {err}</div>}
      {status && status.google && !status.google.configured && !status.microsoft.configured && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
          This server has no OAuth apps configured yet — an admin needs to set GOOGLE_OAUTH_CLIENT_ID/SECRET or MS_OAUTH_CLIENT_ID/SECRET.
        </div>
      )}
    </div>
  );
}

function HelpCenter({ onClose, onReplayTour }) {
  const sections = (window.COACH_TOUR_STEPS || []).filter(s => s.view);
  useE2(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }} role="dialog" aria-modal="true" aria-label="Help center">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><Ico name="LifeBuoy" size={18} /></div>
            <div><h2 className="display">Help center</h2><p>Lost? Here's how PhD Navigator works.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Ico name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          {sections.length > 0 && <>
            <div className="section-label" style={{ marginTop: 0 }}><span className="ic"><Ico name="Compass" size={13} /></span> What each section does</div>
            <div className="help-list">{sections.map((s, i) => <div key={i} className="help-row"><span className="help-ico"><Ico name={s.icon} size={14} /></span><div><b>{s.title}</b><span>{s.body}</span></div></div>)}</div>
          </>}
          <div className="section-label"><span className="ic"><Ico name="BookOpen" size={13} /></span> Glossary</div>
          <div className="help-list">{HELP_GLOSSARY.map(([t, d], i) => <div key={i} className="help-row"><div><b>{t}</b><span>{d}</span></div></div>)}</div>
          <div className="section-label"><span className="ic"><Ico name="HelpCircle" size={13} /></span> FAQ</div>
          <div className="help-list">{HELP_FAQ.map(([q, a], i) => <div key={i} className="help-row"><div><b>{q}</b><span>{a}</span></div></div>)}</div>
        </div>
        <div className="modal-f">
          <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}><Ico name="Info" size={12} /> You won't break anything by exploring.</span>
          <button className="btn primary" onClick={() => { onClose(); onReplayTour(); }}><Ico name="Rocket" size={14} color="#fff" /> Replay the tour</button>
        </div>
      </div>
    </div>
  );
}

function SettingsView({ roadmap = null, setRoadmap, theme, onToggleTheme, prefs = {}, setPrefs, engagement = {}, unlocked = {}, onRevealAll, onResetDrip, onToggleHidden, onRebuild, onLoadTemplate, onReplayOnboarding, onSignOut }) {
  const [help, setHelp] = useS2(false);
  const currentInstitution = prefs.institution || roadmap?.program?.institution || "";
  const currentProgram = prefs.program || roadmap?.program?.name || "";
  const densityChoice = prefs.revealAll ? "everything" : (prefs.density === "focused" ? "minimal" : "balanced");
  const chooseDensity = (c) => {
    if (c === "everything") { setPrefs && setPrefs(p => ({ ...p, density: "full" })); onRevealAll && onRevealAll(); }
    else if (c === "balanced") { setPrefs && setPrefs(p => ({ ...p, density: "full", revealAll: false })); }
    else { setPrefs && setPrefs(p => ({ ...p, density: "focused", revealAll: false })); }
  };
  const setModel = (m) => setPrefs && setPrefs(p => ({ ...p, modelMode: m }));
  const saveAcademic = (key, value) => {
    const clean = value || "";
    setPrefs && setPrefs(p => ({ ...p, [key]: clean }));
    setRoadmap && setRoadmap(r => {
      if (!r) return r;
      const program = r.program || {};
      return { ...r, program: { ...program, [key === "program" ? "name" : "institution"]: clean } };
    });
  };
  const unlockRows = [["skills", "Actions library", "after 5 messages", 5]];

  return (
    <div className="page page-narrow">
      <div className="greeting"><h1 className="display" style={{ fontSize: 26 }}>Settings</h1><div className="sub">Make it yours.</div></div>

      {/* Academic profile */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="GraduationCap" size={14} /></span> Academic profile</div>
        <div className="field">
          <label>University</label>
          <window.AcademicCombo
            value={currentInstitution}
            onChange={value => saveAcademic("institution", value)}
            options={SETTINGS_INSTITUTIONS}
            placeholder="Choose your university"
            icon="Building2"
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Program</label>
          <window.AcademicCombo
            value={currentProgram}
            onChange={value => saveAcademic("program", value)}
            options={SETTINGS_PROGRAMS}
            placeholder="Choose your program"
            icon="BookOpen"
          />
        </div>
      </div>

      {/* Important faculty — roles + meeting cadence */}
      <FacultyCard />

      {/* Calendar & mail connections */}
      <IntegrationsCard />

      {/* Display density */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="LayoutDashboard" size={14} /></span> Display density</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "2px 0 10px" }}>How much shows up at once.</div>
        <div className="seg3">
          <button className={densityChoice === "everything" ? "on" : ""} onClick={() => chooseDensity("everything")}><Ico name="LayoutDashboard" size={13} /> Everything</button>
          <button className={densityChoice === "balanced" ? "on" : ""} onClick={() => chooseDensity("balanced")}><Ico name="Scale" size={13} /> Balanced</button>
          <button className={densityChoice === "minimal" ? "on" : ""} onClick={() => chooseDensity("minimal")}><Ico name="Minimize2" size={13} /> Just what I need</button>
        </div>
      </div>

      {/* Models / privacy */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="Cpu" size={14} /></span> Models &amp; privacy</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Where AI runs</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>On-device is fully private, with slightly lower accuracy.</div></div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`btn sm ${prefs.modelMode !== "private" ? "primary" : ""}`} onClick={() => setModel("cloud")}><Ico name="Cloud" size={14} color={prefs.modelMode !== "private" ? "#fff" : undefined} /> Cloud</button>
            <button className={`btn sm ${prefs.modelMode === "private" ? "primary" : ""}`} onClick={() => setModel("private")}><Ico name="ShieldCheck" size={14} color={prefs.modelMode === "private" ? "#fff" : undefined} /> On-device</button>
          </div>
        </div>
      </div>

      {/* Feature unlocks */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="Sparkles" size={14} /></span> Feature unlocks</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", margin: "2px 0 10px" }}>Advanced features open up as you use Chat ({engagement.messages || 0} messages so far).</div>
        {unlockRows.map(([id, label, when, thr]) => {
          const hidden = (prefs.hidden || []).includes(id);
          const reached = prefs.revealAll || (engagement.messages || 0) >= thr;
          const icon = hidden ? "EyeOff" : (unlocked[id] ? "CheckCircle2" : "Lock");
          const color = hidden ? "var(--amber)" : (unlocked[id] ? "var(--sage)" : "var(--text-3)");
          return (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
              <Ico name={icon} size={14} color={color} />
              <span style={{ flex: 1 }}>{label}</span>
              {reached
                ? <button className="btn sm ghost" onClick={() => onToggleHidden && onToggleHidden(id)}>{hidden ? <><Ico name="Eye" size={13} /> Activate</> : <><Ico name="EyeOff" size={13} /> Hide</>}</button>
                : <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{when}</span>}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {!prefs.revealAll && <button className="btn sm primary" onClick={onRevealAll}><Ico name="Unlock" size={14} color="#fff" /> Reveal everything now</button>}
          <button className="btn sm" onClick={onResetDrip}><Ico name="RefreshCw" size={14} /> Reset the drip</button>
        </div>
      </div>

      {/* Help */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="LifeBuoy" size={14} /></span> Help &amp; learning</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Help center</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Glossary, what each section does, and FAQs</div></div>
          <button className="btn sm" onClick={() => setHelp(true)}><Ico name="HelpCircle" size={14} /> Open</button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Replay welcome tour</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Walk through what each page does again</div></div>
          <button className="btn sm" onClick={onReplayOnboarding}><Ico name="Rocket" size={14} /> Take the tour</button>
        </div>
      </div>

      {/* Appearance */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="Palette" size={14} /></span> Appearance</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Theme</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Warm light or cozy dark</div></div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`btn sm ${theme === "light" ? "primary" : ""}`} onClick={() => theme !== "light" && onToggleTheme()}><Ico name="Sun" size={14} color={theme==="light"?"#fff":undefined} /> Light</button>
            <button className={`btn sm ${theme === "dark" ? "primary" : ""}`} onClick={() => theme !== "dark" && onToggleTheme()}><Ico name="Moon" size={14} color={theme==="dark"?"#fff":undefined} /> Dark</button>
          </div>
        </div>
      </div>

      {/* Your plan */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="Map" size={14} /></span> Your plan</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Rebuild plan</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Start the setup over from scratch</div></div>
          <button className="btn sm" onClick={onRebuild}><Ico name="RefreshCw" size={14} /> Rebuild</button>
        </div>
        {onLoadTemplate && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <div><div style={{ fontWeight: 600, fontSize: 14 }}>Load default template</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>The research-backed 5-year plan — quarters with week-sized steps</div></div>
            <button className="btn sm" onClick={onLoadTemplate}><Ico name="LayoutTemplate" size={14} /> Load</button>
          </div>
        )}
      </div>

      {/* Account */}
      <div className="card card-pad">
        <div className="card-h"><span className="ico"><Ico name="User" size={14} /></span> Account</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>Signed in as <strong style={{ color: "var(--text)" }}>{window.MOCK_USER.email}</strong></div>
          <button className="btn sm" onClick={onSignOut}><Ico name="LogOut" size={14} /> Sign out</button>
        </div>
      </div>

      {help && <HelpCenter onClose={() => setHelp(false)} onReplayTour={onReplayOnboarding} />}
    </div>
  );
}

// ============================================================================
// STEP WORKSPACE — click a milestone → a focused popup that DYNAMICALLY loads
// the right tools, guidance, checklist and "do the work" actions for that step.
// The tools come from the roadmap engine's per-step feature lifecycle, so each
// step shows different contents. (Backend can later enrich each section.)
// ============================================================================
// Per-step starter document — single source lives in canvas-data.js (window.STEP_DOC).
const STEP_DOC = window.STEP_DOC || {};
function StepWorkspace({ roadmap, stepId, doneTasks, onToggleTask, onComplete, onAsk, onNav, onClose, onToast, skillsUnlocked = true }) {
  const [openTask, setOpenTask] = useS2(-1);
  const [addOpen, setAddOpen] = useS2(false);
  const [craft, setCraft] = useS2(false);
  useE2(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const idx = roadmap.steps.findIndex(s => s.id === stepId);
  const step = roadmap.steps[idx];
  if (!step) return null;
  const fs = RE2.computeFeatureState(roadmap, idx);
  const liveTools = fs.active.filter(f => window.hasTool(f));
  const risks = RE2.risks ? RE2.risks(step.templateId || step.id) : [];
  const tkey = (t) => `${step.id}::${t}`;
  const doneN = step.subtasks.filter(t => doneTasks.has(tkey(t))).length;
  const allDone = doneN === step.subtasks.length;
  const isCurrent = step.status === "current" || step.status === "redo" || step.status === "paused";
  const docTemplateId = STEP_DOC[step.id] || STEP_DOC[step.templateId];
  const tpl = docTemplateId && (window.DOC_TEMPLATES || []).find(t => t.id === docTemplateId);

  const askHow = (what) => { onAsk && onAsk(`I'm a PhD student working on "${step.title}". Walk me through, step by step, how to: ${what} I'm new to this — give concrete first actions.`); onClose(); };
  const makeBoard = () => { if (window.CoachActions) { window.CoachActions.addWidget("kanban", step.subtasks.slice(0, 6)); onToast && onToast("Task board added to Workspace"); } };
  const startDoc = () => { if (window.CoachActions && tpl) { window.CoachActions.createDoc(tpl.id, `${step.title} — ${tpl.name}`, {}); onClose(); onNav && onNav("documents"); } };
  const addTool = (type) => { if (window.CoachActions) { window.CoachActions.addWidget(type); onToast && onToast("Added to your Workspace"); setAddOpen(false); } };
  // Tools you can add to this step (real widgets; non-stub only).
  const availableTools = (window.WIDGET_CATALOG || []).filter(w => !w.stub);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="stepws" role="dialog" aria-modal="true" aria-label={step.title} onClick={e => e.stopPropagation()}>
        <div className="stepws-head">
          <div className="stepws-ico"><Ico name={step.recovery ? "LifeBuoy" : step.icon} size={20} color="#fff" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="stepws-eyebrow">{step.phase} · {step.estimate}</div>
            <h2 className="display">{step.title}</h2>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close workspace"><Ico name="X" size={15} /></button>
        </div>

        <div className="stepws-body">
          <p className="stepws-obj">{step.objective}</p>

          {/* Do the work — context actions for this step */}
          <div className="stepws-actions">
            <button className="btn primary" onClick={() => askHow(step.title.toLowerCase())}><Ico name="MessageCircle" size={15} color="#fff" /> Ask your advisors</button>
            {tpl && <button className="btn" onClick={startDoc}><Ico name={tpl.icon} size={15} /> Start: {tpl.name}</button>}
            <button className="btn" onClick={makeBoard}><Ico name="Columns3" size={15} /> Make a task board</button>
            <button className={`btn ${addOpen ? "" : "ghost"}`} onClick={() => setAddOpen(o => !o)}><Ico name="Plus" size={15} /> Add a tool</button>
          </div>

          {/* Available tools to add to this step + craft a custom one */}
          {addOpen && (
            <div className="stepws-tools">
              <button className="stepws-craft" onClick={() => setCraft(true)}>
                <span className="stepws-craft-i"><Ico name="Wand2" size={16} /></span>
                <span><b>Craft a custom tool</b><span className="stepws-craft-d">Describe what you need — the Navigator builds it.</span></span>
                <Ico name="ArrowRight" size={15} />
              </button>
              <div className="pal-grid">
                {availableTools.map(w => (
                  <button key={w.type} className="pal-tile" onClick={() => addTool(w.type)}>
                    <span className="pal-i"><Ico name={w.icon} size={17} /></span>
                    <span style={{ flex: 1 }}><span className="pal-n">{w.name}</span><span className="pal-d">{w.desc}</span></span>
                    <Ico name="Plus" size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Committee builder — special interactive tool for that step */}
          {(step.id === "committee" || step.templateId === "committee") && window.CommitteeBuilder && (
            <div className="stepws-sec">
              <div className="section-label"><span className="ic"><Ico name="Users" size={13} /></span> Committee builder</div>
              <window.CommitteeBuilder />
            </div>
          )}

          {/* Dynamically-loaded working tools for THIS step */}
          {liveTools.length > 0 && (
            <div className="stepws-sec">
              <div className="section-label"><span className="ic"><Ico name="Wrench" size={13} /></span> Your tools for this step</div>
              <div className="toolgrid">{liveTools.map(f => <React.Fragment key={f}>{window.renderTool(f)}</React.Fragment>)}</div>
            </div>
          )}

          {/* Checklist launchpad */}
          <div className="stepws-sec">
            <div className="section-label"><span className="ic"><Ico name="ListChecks" size={13} /></span> Steps to complete · {doneN}/{step.subtasks.length}</div>
            <div className="tasklist">
              {step.subtasks.map((t, i) => {
                const d = doneTasks.has(tkey(t));
                const open = openTask === i;
                return (
                  <div key={i} className={`taskrow ${d ? "done" : ""} ${open ? "open" : ""}`}>
                    <div className="taskrow-main">
                      <button className="cb" onClick={() => onToggleTask(step.id, t)} aria-label={d ? "Mark not done" : "Mark done"}>{d && <Ico name="Check" size={12} color="#fff" />}</button>
                      <button className="taskrow-text" onClick={() => setOpenTask(open ? -1 : i)}>{t}</button>
                      <button className="taskrow-go" onClick={() => setOpenTask(open ? -1 : i)} aria-label="How do I do this?"><span className="taskrow-help">How?</span> <Ico name={open ? "ChevronUp" : "ChevronDown"} size={15} /></button>
                    </div>
                    {open && (
                      <div className="taskrow-actions">
                        <button className="btn sm primary" onClick={() => askHow(t)}><Ico name="MessageCircle" size={13} color="#fff" /> Ask your advisors how</button>
                        {!d && <button className="btn sm ghost" onClick={() => { onToggleTask(step.id, t); setOpenTask(-1); }}><Ico name="Check" size={13} /> Mark done</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* What trips people up */}
          {risks.length > 0 && (
            <div className="risks">
              <div className="risks-h"><Ico name="Lightbulb" size={14} /> What trips people up here</div>
              <ul className="risks-list">{risks.map((r, i) => <li key={i}><Ico name="AlertTriangle" size={12} /> <span>{r}</span></li>)}</ul>
            </div>
          )}
        </div>

        <div className="stepws-foot">
          <span className="stepws-foot-note">{allDone ? "All steps checked — ready to complete." : `${step.subtasks.length - doneN} step${step.subtasks.length - doneN === 1 ? "" : "s"} left`}</span>
          <button className="btn primary" disabled={!allDone || !isCurrent} onClick={() => { onComplete(step.id); onClose(); }}>
            <Ico name="Flag" size={15} color="#fff" /> Complete milestone
          </button>
        </div>

        {craft && <CraftToolModal stepTitle={step.title}
          onClose={() => setCraft(false)}
          onCreated={() => { setCraft(false); setAddOpen(false); onToast && onToast("Custom tool built — it's in your Workspace"); }} />}
      </div>
    </div>
  );
}

// Craft a custom tool: describe it → the Navigator builds it from a primitive
// (checklist | notes | tracker) and saves it to the Workspace.
function CraftToolModal({ stepTitle, onClose, onCreated }) {
  const [name, setName] = useS2("");
  const [purpose, setPurpose] = useS2("");
  const [kind, setKind] = useS2("checklist");
  const [touched, setTouched] = useS2(false);
  // Suggest the primitive from the description until the user overrides it.
  useE2(() => {
    if (touched) return;
    const p = (purpose + " " + name).toLowerCase();
    if (/note|journal|idea|log|draft|writ/.test(p)) setKind("notes");
    else if (/count|track|number|streak|hour|word|page|day|metric|score/.test(p)) setKind("tracker");
    else setKind("checklist");
  }, [purpose, name, touched]);
  const KINDS = [["checklist", "Checklist", "ListChecks"], ["notes", "Notes", "StickyNote"], ["tracker", "Tracker", "Activity"]];
  const can = name.trim().length > 0;
  const create = () => { if (window.CoachActions) window.CoachActions.addCustomTool({ title: name.trim(), kind, purpose: purpose.trim() }); onCreated && onCreated(); };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><Ico name="Wand2" size={18} /></div>
            <div><h2 className="display">Craft a custom tool</h2><p>Tell the Navigator what you need for “{stepTitle}.” It builds a real, saved tool.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Ico name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="field"><label>Tool name</label><div className="wrap" style={{ paddingLeft: 0 }}>
            <input style={{ paddingLeft: 14 }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Participant recruitment tracker" autoFocus /></div></div>
          <div className="field"><label>What should it help you do?</label>
            <textarea className="modal-textarea" style={{ minHeight: 70 }} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Keep a checklist of people I've recruited and who has consented." /></div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 8 }}>Type <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· suggested from your description</span></label>
          <div className="opt-grid three">
            {KINDS.map(([id, label, icon]) => (
              <button key={id} className={`opt ${kind === id ? "sel" : ""}`} onClick={() => { setKind(id); setTouched(true); }}><Ico name={icon} size={14} /> {label}</button>
            ))}
          </div>
        </div>
        <div className="modal-f">
          <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}><Ico name="Sparkles" size={12} /> Built by your Navigator</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!can} onClick={create}><Ico name="Wand2" size={14} color="#fff" /> Build it</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// UNLOCK POPUP — one reusable modal for each engagement milestone.
// ============================================================================
const UNLOCK_CONTENT = {
  multiple: { icon: "Users", title: "Want more than one perspective?", to: "chat", cta: "Try Multiple mode",
    body: "You can now switch Chat to Multiple mode and hear up to three advisor lenses on the same question — or keep it to one. Your call." },
  skills: { icon: "Sparkles", title: "Actions are unlocked", to: "skills", cta: "Explore Actions",
    body: "Actions create useful outputs such as a literature-gap review, chapter outline, methods critique, or meeting-prep document." },
  personas10: { icon: "Users", title: "All 10 advisors are available", to: "chat", cta: "Open Chat",
    body: "Your full panel of advisor lenses is unlocked — methods, theory, writing, wellbeing, career, and more. Mix and match whoever fits the question." }
};
function UnlockPopup({ id, onDismiss, onAct, onKeepHidden }) {
  const c = UNLOCK_CONTENT[id]; if (!c) return null;
  useE2(() => { const onKey = (e) => { if (e.key === "Escape") onDismiss(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  return (
    <div className="backdrop" onClick={onDismiss}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={c.title} style={{ maxWidth: 460 }}>
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--grad)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><Ico name={c.icon} size={18} color="#fff" /></div>
            <div><h2 className="display">New feature unlocked</h2><p>Hey — {c.title.toLowerCase()}</p></div>
          </div>
          <button className="modal-x" onClick={onDismiss} aria-label="Dismiss"><Ico name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-2)", lineHeight: 1.55 }}>{c.body}</p>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-3)", display: "flex", gap: 6, alignItems: "center" }}><Ico name="Info" size={12} /> Prefer fewer things on screen? Keep it hidden — you can switch it back on anytime in Settings.</p>
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={() => onKeepHidden && onKeepHidden(id)}><Ico name="EyeOff" size={14} /> Keep hidden</button>
          <button className="btn primary" onClick={onAct}><Ico name="ArrowRight" size={14} color="#fff" /> {c.cta}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ROOT
// ============================================================================
function CoachRoot() {
  const [roadmap, setRoadmap] = useS2(() => H.normalizeStoredRoadmap
    ? H.normalizeStoredRoadmap(H.loadJSON(H.RM_KEY, null))
    : H.loadJSON(H.RM_KEY, null));
  // Auth is backed by the real backend (window.CoachAPI): the JWT lives in
  // localStorage['authToken']. Keep the displayed identity (window.MOCK_USER)
  // in sync with the signed-in user so the rail/dashboard/settings show it.
  const [authed, setAuthed] = useS2(() => !!(window.CoachAPI && window.CoachAPI.isAuthed()));
  if (window.CoachAPI && window.CoachAPI.isAuthed()) window.MOCK_USER = window.CoachAPI.getUser();
  const [gate, setGate] = useS2("landing"); // landing | login
  const [view, setView] = useS2("home");
  const [theme, setTheme] = useS2(() => { try { return localStorage.getItem(H.THEME_KEY) || "light"; } catch (e) { return "light"; } });
  const [doneTasks, setDoneTasks] = useS2(() => new Set(H.loadJSON(H.TASK_KEY, [])));
  const [celebrate, setCelebrate] = useS2(null);
  const [sosOpen, setSosOpen] = useS2(false);
  const [recovered, setRecovered] = useS2(null);
  const [toast, setToast] = useS2("");
  const [showTour, setShowTour] = useS2(false);
  const [authMode, setAuthMode] = useS2("login"); // login | signup
  const [restoring, setRestoring] = useS2(false); // fetching a returning user's saved plan
  const [globalSearchOpen, setGlobalSearchOpen] = useS2(false);
  const [planSearchTarget, setPlanSearchTarget] = useS2(null);
  const [savedChatTarget, setSavedChatTarget] = useS2(null);
  const [activity, setActivity] = useS2(() => H.loadJSON(H.ACT_KEY, {})); // per-step last-touched
  const touchStep = (id) => { if (id) setActivity(a => ({ ...a, [id]: Date.now() })); };
  const [chatSeed, setChatSeed] = useS2(null); // { text, contextSource, eligibleForMemory }
  const [freshChatKey, setFreshChatKey] = useS2(0);
  const askInChat = (q) => { setChatSeed({ text: q }); setView("chat"); };
  const [wsStep, setWsStep] = useS2(null); // step id whose workspace popup is open
  const openWorkspace = (id) => setWsStep(id);
  const toggleTaskFor = (stepId, t) => {
    setDoneTasks(prev => { const n = new Set(prev); const k = `${stepId}::${t}`; n.has(k) ? n.delete(k) : n.add(k); return n; });
    touchStep(stepId);
  };
  const completeStep = (id) => {
    const res = RE2.markComplete(roadmap, id);
    setRoadmap(res.roadmap);
    setCelebrate(res);
    const ni = res.roadmap.steps.findIndex(s => s.status === "current");
    if (ni >= 0) touchStep(res.roadmap.steps[ni].id);
  };

  // --- Progressive disclosure: density preference + engagement-driven unlocks ---
  // Existing users (no saved prefs) default to full/revealAll so they never lose UI.
  const [prefs, setPrefs] = useS2(() => H.loadJSON(H.PREFS_KEY, { density: "full", revealAll: true, modelMode: "cloud", hidden: [] }));
  const [engagement, setEngagement] = useS2(() => H.loadJSON(H.ENGAGE_KEY, { messages: 0, visits: 0 }));
  const [seenUnlocks, setSeenUnlocks] = useS2(() => H.loadJSON(H.UNLOCKS_KEY, []));
  const [unlockPopup, setUnlockPopup] = useS2(null);
  const [rebuildProfile, setRebuildProfile] = useS2(null);
  // A feature is "on" once its message threshold is reached (or reveal-all) AND
  // the user hasn't chosen to keep it hidden.
  const isHidden = (id) => (prefs.hidden || []).includes(id);
  const reached = (thr) => prefs.revealAll || engagement.messages >= thr;
  const unlocked = useM2(() => ({
    multiple:   reached(1)  && !isHidden("multiple"),
    skills:     false, // Skills page temporarily hidden for beta
    personas10: reached(15) && !isHidden("personas10")
  }), [prefs.revealAll, prefs.hidden, engagement.messages]);
  const focused = prefs.density === "focused";
  const bumpMessages = () => setEngagement(e => ({ ...e, messages: (e.messages || 0) + 1 }));
  const dismissUnlock = (id) => { setSeenUnlocks(s => s.includes(id) ? s : [...s, id]); setUnlockPopup(null); };
  // "Keep hidden" from the reveal popup: stash the feature away, remember we showed it.
  const keepHidden = (id) => {
    setPrefs(p => ({ ...p, hidden: [...new Set([...(p.hidden || []), id])] }));
    setSeenUnlocks(s => s.includes(id) ? s : [...s, id]);
    setUnlockPopup(null);
    setToast("Hidden for now — turn it back on anytime in Settings → Feature unlocks.");
  };
  const toggleHidden = (id) => setPrefs(p => { const h = new Set(p.hidden || []); h.has(id) ? h.delete(id) : h.add(id); return { ...p, hidden: [...h] }; });
  const revealAllNow = () => { setPrefs(p => ({ ...p, revealAll: true, hidden: [] })); setSeenUnlocks(["skills"]); setUnlockPopup(null); };
  const resetDrip = () => { setEngagement(e => ({ messages: 0, visits: e.visits || 0 })); setSeenUnlocks([]); setPrefs(p => ({ ...p, revealAll: false, hidden: [] })); setUnlockPopup(null); };
  const academicProfile = useM2(() => rebuildProfile || buildAcademicProfile(signedInUserProfile(), prefs, roadmap), [rebuildProfile, prefs, roadmap, authed]);

  // Meeting action items → the current step's to-do list. Fired by the Meeting
  // Agenda tool so "Add to my to-dos" updates This Week live, no reload needed.
  useE2(() => {
    const onAdd = (e) => {
      const items = (((e || {}).detail || {}).items || []).map(t => String(t).trim()).filter(Boolean);
      if (!items.length) return;
      setRoadmap(r => {
        if (!r || !Array.isArray(r.steps)) return r;
        const cur = r.steps.find(s => s.status === "current") || r.steps.find(s => s.status === "redo") || r.steps[0];
        if (!cur) return r;
        const merged = [...(cur.subtasks || [])];
        items.forEach(t => { if (!merged.includes(t)) merged.push(t); });
        return { ...r, steps: r.steps.map(s => s.id === cur.id ? { ...s, subtasks: merged } : s) };
      });
      setToast(`${items.length} action item${items.length === 1 ? "" : "s"} added to your to-do list`);
    };
    window.addEventListener("phd-add-todos", onAdd);
    return () => window.removeEventListener("phd-add-todos", onAdd);
  }, []);

  // Defense Room follow-ups → open Chat pre-seeded; individual report actions
  // can request a fresh conversation instead of reopening recent history.
  useE2(() => {
    const onOpenChat = (e) => {
      const detail = ((e || {}).detail || {});
      const seed = (detail.seed || "").trim();
      if (seed) {
        setChatSeed({
          text: seed,
          contextSource: detail.contextSource || null,
          eligibleForMemory: detail.eligibleForMemory !== false
        });
      }
      if (detail.newChat) setFreshChatKey(key => key + 1);
      setView("chat");
    };
    window.addEventListener("phd-open-chat", onOpenChat);
    return () => window.removeEventListener("phd-open-chat", onOpenChat);
  }, []);

  useE2(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem(H.THEME_KEY, theme); } catch (e) {} }, [theme]);
  useE2(() => { H.saveJSON(H.RM_KEY, roadmap); }, [roadmap]);
  useE2(() => { H.saveJSON(H.TASK_KEY, [...doneTasks]); }, [doneTasks]);
  // Best-effort backend backup of the plan + progress, so signing in from a new
  // browser restores the dashboard instead of re-running onboarding.
  useE2(() => {
    if (!authed || !roadmap || !window.CoachAPI || window.CoachAPI.token() === "demo-token") return;
    const t = setTimeout(() => { window.CoachAPI.putWorkspaceSection("roadmap", roadmap).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [roadmap, authed]);
  useE2(() => {
    if (!authed || !roadmap || !window.CoachAPI || window.CoachAPI.token() === "demo-token") return;
    const t = setTimeout(() => { window.CoachAPI.putWorkspaceSection("progress", [...doneTasks]).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [doneTasks, authed]);
  useE2(() => { H.saveJSON(H.ACT_KEY, activity); }, [activity]);
  useE2(() => { H.saveJSON(H.PREFS_KEY, prefs); }, [prefs]);
  useE2(() => { H.saveJSON(H.ENGAGE_KEY, engagement); }, [engagement]);
  useE2(() => { H.saveJSON(H.UNLOCKS_KEY, seenUnlocks); }, [seenUnlocks]);
  useE2(() => { setEngagement(e => ({ ...e, visits: (e.visits || 0) + 1 })); }, []); // count one visit per app load
  // Fire one unlock popup when a message threshold is first crossed (drip users only).
  useE2(() => {
    if (prefs.revealAll || unlockPopup) return;
    const order = ["skills"];
    const next = order.find(id => unlocked[id] && !seenUnlocks.includes(id));
    if (next) setUnlockPopup(next);
  }, [engagement.messages, prefs.revealAll]);
  // If Skills gets re-locked (reset drip) while viewing it, bounce home.
  useE2(() => { if (view === "skills" && !unlocked.skills) setView("home"); }, [view, unlocked.skills]);
  // ⌘K / Ctrl+K opens the same search experience from anywhere in the app.
  useE2(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setGlobalSearchOpen(open => !open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useE2(() => { try { localStorage.setItem("phd-coach-authed", authed ? "1" : "0"); } catch (e) {} }, [authed]);
  useE2(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2400); return () => clearTimeout(t); }, [toast]);
  // Auto-launch the welcome tour the first time someone lands in the app with a plan.
  useE2(() => {
    if (!authed || !roadmap) return;
    let done = false; try { done = localStorage.getItem(window.COACH_TOUR_KEY) === "1"; } catch (e) {}
    if (!done) { setView("home"); setShowTour(true); }
  }, [authed, !!roadmap]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  const handleReplan = (text) => {
    const res = RE2.replan(roadmap, text);
    setRoadmap(res.roadmap);
    setSosOpen(false);
    setRecovered(res.detour);
  };

  // Settings → Your plan → Load default template (the research-backed 5-year plan)
  const loadTemplatePlan = async () => {
    if (!confirm("Replace your current plan with the default 5-year PhD template? Done checkmarks survive where titles match.")) return;
    try {
      const rm = await window.CoachPlanUtils.loadDefaultTemplate({ roadmap, doneTasks, setDoneTasks });
      setRoadmap(rm);
      setToast("Default PhD template loaded — tailor it in My Plan.");
      setView("plan");
    } catch (e) {
      setToast((e && e.message) || "Couldn't load the template — is the backend running?");
    }
  };

  // 1) Not signed in → marketing landing / login. Auth is real (CoachAPI):
  // CoachLogin performs the backend login/signup and only calls onAuthed on
  // success. A brand-new account (isNew) lands in onboarding with a fresh plan.
  const onAuthed = (isNew, user) => {
    if (user) window.MOCK_USER = user;
    else if (window.CoachAPI) window.MOCK_USER = window.CoachAPI.getUser();
    setRebuildProfile(null);
    if (isNew) { setRoadmap(null); setDoneTasks(new Set()); }
    else {
      // localStorage is namespaced per account, and this component's state was
      // initialized before sign-in (unscoped). Re-read the signed-in account's
      // saved data now so returning users land on their dashboard, not onboarding.
      const localRm = H.normalizeStoredRoadmap
        ? H.normalizeStoredRoadmap(H.loadJSON(H.RM_KEY, null))
        : H.loadJSON(H.RM_KEY, null);
      setDoneTasks(new Set(H.loadJSON(H.TASK_KEY, [])));
      setActivity(H.loadJSON(H.ACT_KEY, {}));
      setPrefs(H.loadJSON(H.PREFS_KEY, { density: "full", revealAll: true, modelMode: "cloud", hidden: [] }));
      setEngagement(H.loadJSON(H.ENGAGE_KEY, { messages: 0, visits: 0 }));
      setSeenUnlocks(H.loadJSON(H.UNLOCKS_KEY, []));
      // Always replace in-memory state (a previous account's plan may still be
      // mounted after sign-out on this same page load).
      setRoadmap(localRm || null);
      if (!localRm) {
        // Sign-in must land on the dashboard, never onboarding. Try the backend
        // backup first; if the account has no saved plan anywhere, build the
        // standard template plan (same as onboarding's Skip) and say so.
        setRestoring(true);
        (async () => {
          let rm = null;
          if (window.CoachAPI && window.CoachAPI.token() !== "demo-token") {
            try {
              const state = await window.CoachAPI.getWorkspaceState();
              const saved = state && state.sections && state.sections.roadmap;
              if (saved && Array.isArray(saved.steps) && saved.steps.length) {
                rm = H.normalizeStoredRoadmap ? H.normalizeStoredRoadmap(saved) : saved;
                const prog = state.sections.progress;
                if (Array.isArray(prog)) setDoneTasks(new Set(prog));
              }
            } catch (e) {}
          }
          if (!rm) {
            try {
              const u = (window.CoachAPI && window.CoachAPI.getUser()) || {};
              const programName = u.program || DEFAULT_ACADEMIC_PROGRAM;
              const institution = u.institution || "";
              const deliverables = await RE2.discoverDeliverables({ program: programName, institution, materials: [] });
              rm = RE2.generateRoadmap({
                program: { name: programName, institution }, deliverables,
                startPosition: "coursework", workflow: { writeStyle: "unsure", publish: false }
              });
              if (H.normalizeStoredRoadmap) rm = H.normalizeStoredRoadmap(rm);
              setToast("We started you on the standard plan — personalize it with your handbook in Settings → Your plan.");
            } catch (e) { rm = null; }
          }
          if (rm) setRoadmap(rm);
          setRestoring(false);
        })();
      }
    }
    setAuthed(true);
    setView("home");
  };
  const handleAuthExpired = () => {
    if (window.CoachAPI) window.CoachAPI.clearAuth();
    setRebuildProfile(null);
    setAuthMode("login");
    setGate("login");
    setAuthed(false);
    setView("home");
  };
  if (!authed) {
    if (gate === "login") {
      return <window.CoachLogin
        onAuthed={onAuthed}
        onBack={() => setGate("landing")}
        mode={authMode} />;
    }
    return <window.CoachLanding
      onGetStarted={() => { setAuthMode("signup"); setGate("login"); }}
      onSignIn={() => { setAuthMode("login"); setGate("login"); }} />;
  }

  // 1.5) Signed in on a fresh browser → hold while the saved plan downloads,
  // so returning users never flash into (or get stuck in) onboarding.
  if (restoring && !roadmap) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "var(--bg)" }}>
        <Ico name="Loader" size={28} className="spin" />
        <div style={{ fontSize: 14, color: "var(--text-2)" }}>Loading your plan…</div>
      </div>
    );
  }

  // 2) Signed in, no plan yet → onboarding (onboarding hands up density/model prefs)
  if (!roadmap) {
    return <window.CoachOnboarding
      profile={academicProfile}
      onAuthExpired={handleAuthExpired}
      onComplete={(rm, p) => { setRebuildProfile(null); setRoadmap(rm); if (p) setPrefs(prev => ({ ...prev, ...p })); setView("home"); }} />;
  }

  const signOut = () => { if (window.CoachAPI) window.CoachAPI.clearAuth(); setRebuildProfile(null); setAuthed(false); setGate("landing"); setView("home"); };
  // Sanitize view: Skills isn't reachable until unlocked, and Workspace is not
  // its own page — its tools live on Home (in the Tools popup), so redirect there.
  const v = (view === "skills" && !unlocked.skills) ? "home" : (view === "workspace" ? "home" : view);

  let body;
  if (v === "home") body = <window.CoachDashboard roadmap={roadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} onNav={setView} onOpenSos={() => setSosOpen(true)} onOpenStep={openWorkspace} focused={focused} theme={theme} />;
  // My Plan uses the V2 PlanView (the version deployed on main); the newer
  // spreadsheet (CoachPlanSheet) is retired while we redo this section.
  else if (v === "plan") body = <PlanView roadmap={roadmap} setRoadmap={setRoadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} touchStep={touchStep} onCelebrate={setCelebrate} onOpenSos={() => setSosOpen(true)} onAsk={askInChat} onNav={setView} onOpenStep={openWorkspace} skillsUnlocked={unlocked.skills} searchTarget={planSearchTarget} />;
  else if (v === "chat") body = <window.CoachChatView roadmap={roadmap} setRoadmap={setRoadmap} onNav={setView} onToast={setToast} seed={chatSeed} freshChatKey={freshChatKey} onFreshChatConsumed={() => setFreshChatKey(0)} onSeedConsumed={() => setChatSeed(null)} unlocked={unlocked} onMessage={bumpMessages} savedChatTarget={savedChatTarget} onSavedChatConsumed={() => setSavedChatTarget(null)} onOpenPlanItem={(stepId, taskIndex) => { setPlanSearchTarget({ stepId, taskIndex, nonce: Date.now() }); setView("plan"); }} />;
  else if (v === "meetings") body = <window.CoachMeetings onToast={setToast} />;
  else if (v === "skills") body = <window.CoachSkills roadmap={roadmap} onNav={setView} />;
  else if (v === "insights") body = <window.CoachInsights onNav={setView} roadmap={roadmap} doneTasks={doneTasks} />;
  else if (v === "defense") body = <window.CoachDefenseRoom roadmap={roadmap} onNav={setView} onToast={setToast} />;
  else if (v === "documents") body = <window.CoachDocuments roadmap={roadmap} />;
  else if (v === "wellness") body = <window.CoachWellness onNav={setView} roadmap={roadmap} setRoadmap={setRoadmap} onToast={setToast} />;
  else body = <SettingsView roadmap={roadmap} setRoadmap={setRoadmap} theme={theme} onToggleTheme={toggleTheme}
    prefs={prefs} setPrefs={setPrefs} engagement={engagement} unlocked={unlocked}
    onRevealAll={revealAllNow} onResetDrip={resetDrip} onToggleHidden={toggleHidden}
    onRebuild={() => { if (confirm("Rebuild your plan from scratch? Progress clears.")) { setRebuildProfile(buildAcademicProfile(signedInUserProfile(), prefs, roadmap)); setRoadmap(null); setDoneTasks(new Set()); } }}
    onLoadTemplate={loadTemplatePlan}
    onReplayOnboarding={() => { setView("home"); setShowTour(true); }}
    onSignOut={signOut} />;

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <window.CoachRail view={view} onNav={setView} user={window.MOCK_USER} skillsUnlocked={unlocked.skills} onSignOut={signOut} />
      <main className="main" id="main-content" tabIndex={-1}>
        {v !== "chat" && (
          <div className={v === "documents" ? "topbar compact" : "topbar"}>
            <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
              <Ico name="Compass" size={15} /> {roadmap.program?.name || "PhD Navigator"}
              {prefs.modelMode === "private" && <span className="private-pill" title="On-device / private models"><Ico name="ShieldCheck" size={12} /> Private</span>}
            </div>
            <div className="tb-r">
              <button className="btn sm" onClick={() => setGlobalSearchOpen(true)} title="Search" aria-label="Open search"><Ico name="Search" size={15} /> Search</button>
            </div>
          </div>
        )}
        {body}
      </main>

      <Celebration data={celebrate} onClose={() => setCelebrate(null)} />
      {showTour && <window.CoachTour onNav={setView} onClose={() => setShowTour(false)} skillsUnlocked={unlocked.skills} />}
      {/* Per-page first-view walkthrough (Documents/Insights/Skills/Defense).
          Suppressed while the app-wide welcome tour is running so they don't stack. */}
      {!showTour && window.PageTour && <window.PageTour page={v} />}
      <RecoveryModal open={sosOpen} onClose={() => setSosOpen(false)} onReplan={handleReplan} />
      {recovered && (
        <div className="backdrop" onClick={() => { setRecovered(null); setView("plan"); }}>
          <div className="modal celebrate" onClick={e => e.stopPropagation()}>
            <div className="celebrate-top" style={{ background: "var(--rose)" }}>
              <div className="confetti">{Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ left: `${(i*7)%100}%`, background: ["#fff","#FBE9E2","#F2B27A"][i%3], animationDelay: `${(i%5)*0.16}s` }} />)}</div>
              <div className="celebrate-badge"><Ico name="LifeBuoy" size={30} color="#fff" /></div>
              <div className="kick">Plan re-routed</div>
              <h2 className="display">You're back on track.</h2>
              <p>We rebuilt your path around what happened — one step at a time.</p>
            </div>
            <div className="celebrate-b">
              <div className="celebrate-sec">
                <div className="cs-l"><Ico name="LifeBuoy" size={13} /> Your recovery step</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{recovered.title}</div>
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55 }}>{recovered.objective}</p>
              </div>
              {recovered.subtasks && recovered.subtasks.length > 0 && (
                <div className="celebrate-sec">
                  <div className="cs-l"><Ico name="ListChecks" size={13} /> What we added</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {recovered.subtasks.slice(0, 4).map((t, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text)" }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, border: "2px solid var(--border-2)", flexShrink: 0 }} /> {t}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn primary" style={{ justifyContent: "center", background: "var(--rose)" }} onClick={() => { setRecovered(null); setView("plan"); }}>
                <Ico name="ArrowRight" size={15} color="#fff" /> Go to my recovery step
              </button>
            </div>
          </div>
        </div>
      )}
      {wsStep && <StepWorkspace
        roadmap={roadmap}
        stepId={wsStep}
        doneTasks={doneTasks}
        onToggleTask={toggleTaskFor}
        onComplete={completeStep}
        onAsk={askInChat}
        onNav={setView}
        onToast={setToast}
        skillsUnlocked={unlocked.skills}
        onClose={() => setWsStep(null)} />}
      {globalSearchOpen && window.CoachSearchModal && <window.CoachSearchModal
        roadmap={roadmap}
        onClose={() => setGlobalSearchOpen(false)}
        onOpenChat={chat => {
          setSavedChatTarget({ id: chat.id, nonce: Date.now() });
          setView("chat");
        }}
        onOpenDocument={document => {
          const key = "phd-coach-docs-v1";
          const store = H.loadJSON(key, { projects: {}, activeId: null });
          store.activeId = document.id;
          H.saveJSON(key, store);
          setView("documents");
        }}
        onOpenPlan={(stepId, taskIndex) => {
          setPlanSearchTarget({ stepId, taskIndex, nonce: Date.now() });
          setView("plan");
        }} />}
      {unlockPopup && <UnlockPopup id={unlockPopup}
        onDismiss={() => dismissUnlock(unlockPopup)}
        onKeepHidden={keepHidden}
        onAct={() => { const to = UNLOCK_CONTENT[unlockPopup].to; dismissUnlock(unlockPopup); setView(to); }} />}
      {toast && <div className="toast"><Ico name="CheckCircle2" size={15} /> {toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<CoachRoot />);
