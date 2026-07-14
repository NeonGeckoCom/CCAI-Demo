/* coach-app2.jsx — Plan/step view, recovery, chat, settings, router + mount.
   Loads after coach-app.jsx. */

const { useState: useS2, useEffect: useE2, useMemo: useM2, useRef: useR2 } = React;
const Ico = window.Icon;
const RE2 = window.RoadmapEngine;
const H = window.coachHelpers;

// ============================================================================
// PLAN / STEP VIEW  (spine + focused current step + live tools)
// ============================================================================
function PlanView({ roadmap, setRoadmap, doneTasks, setDoneTasks, activity, touchStep, onCelebrate, onOpenSos, onAsk, onNav, onOpenStep, skillsUnlocked = true }) {
  const [selected, setSelected] = useS2(() => {
    const c = roadmap.steps.findIndex(s => s.status === "current");
    return c >= 0 ? c : 0;
  });
  const [openTask, setOpenTask] = useS2(-1); // which sub-task's "how to" drawer is open
  const [editPlan, setEditPlan] = useS2(false); // reorder / rename milestones
  const [dragIdx, setDragIdx] = useS2(null);
  const [renameId, setRenameId] = useS2(null);

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
  const [toolPicker, setToolPicker] = useS2(false);
  useE2(() => { setTaskEdit(null); setNewTask(""); setToolPicker(false); setOpenTask(-1); }, [selected]);

  const step = roadmap.steps[selected];
  const fs = RE2.computeFeatureState(roadmap, selected);
  // Per-step tool overrides layered on top of the engine's lifecycle:
  // toolsAdd = user pinned it here, toolsRemove = user took it off this step.
  const toolsAdd = step.toolsAdd || [];
  const toolsRemove = step.toolsRemove || [];
  const effActive = [
    ...fs.active.filter(f => !toolsRemove.includes(f)),
    ...toolsAdd.filter(f => !fs.active.includes(f) && !toolsRemove.includes(f))
  ];
  const liveTools = effActive.filter(f => window.hasTool(f));
  const chipOnly = effActive.filter(f => !window.hasTool(f));
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
  // Parallel work: run this step alongside whatever else is in flight.
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
    // carry the checked state over to the renamed task
    setDoneTasks(prev => {
      const n = new Set(prev);
      if (n.has(tkey(old))) { n.delete(tkey(old)); n.add(`${step.id}::${t}`); }
      return n;
    });
  };

  // ---- Tool add / remove -----------------------------------------------------
  const addTool = (f) => patchStep({
    toolsAdd: toolsRemove.includes(f) ? toolsAdd : [...toolsAdd, f],
    toolsRemove: toolsRemove.filter(x => x !== f)
  });
  const removeTool = (f) => patchStep(
    toolsAdd.includes(f)
      ? { toolsAdd: toolsAdd.filter(x => x !== f) }
      : { toolsRemove: [...toolsRemove, f] }
  );

  // ---- Add / remove plan sections -------------------------------------------
  const addMilestone = () => {
    const id = `custom-${Date.now()}`;
    const base = roadmap.steps[selected];
    const s = {
      id, title: "New milestone", phase: base?.phase || "Custom", icon: "Flag",
      estimate: "You set the pace", objective: "Describe what finishing this section looks like.",
      status: "locked", subtasks: [], add: [], retire: [], custom: true
    };
    const steps = roadmap.steps.slice();
    steps.splice(selected + 1, 0, s);
    setRoadmap({ ...roadmap, steps });
    setSelected(selected + 1);
    setEditPlan(true);
    setRenameId(id);
  };
  const removeStepById = (id) => {
    if (roadmap.steps.length <= 1) return;
    const victim = roadmap.steps.find(s => s.id === id);
    if (!victim || !confirm(`Remove "${victim.title}" from your plan?`)) return;
    let steps = roadmap.steps.filter(s => s.id !== id);
    // never leave the plan with nothing in flight
    if (!steps.some(s => s.status === "current" || s.status === "redo")) {
      const idx = steps.findIndex(s => s.status !== "done");
      if (idx >= 0) steps = steps.map((s, i) => i === idx ? { ...s, status: "current" } : s);
    }
    setRoadmap({ ...roadmap, steps });
    setSelected(sel => Math.max(0, Math.min(sel, steps.length - 1)));
  };

  const doneCount = roadmap.steps.filter(s => s.status === "done").length;
  const pct = Math.round((doneCount / roadmap.steps.length) * 100);

  let lastPhase = null;

  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="display" style={{ fontSize: 24 }}>{roadmap.program?.name || "Your plan"}</h1>
          <div className="sub">{doneCount} of {roadmap.steps.length} milestones complete · {pct}%</div>
        </div>
        <button className={`btn sm ${editPlan ? "primary" : ""}`} onClick={() => { setEditPlan(e => !e); setRenameId(null); }}>
          <Ico name={editPlan ? "Check" : "Pencil"} size={14} color={editPlan ? "#fff" : undefined} /> {editPlan ? "Done editing" : "Edit plan"}
        </button>
      </div>

      <div className="step-wrap">
        {/* Spine */}
        <div className="spine">
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
                    onDrop={() => { if (dragIdx != null) moveStep(dragIdx, i); setDragIdx(null); }} onDragEnd={() => setDragIdx(null)}>
                    <span className="spine-drag" title="Drag to reorder"><Ico name="GripVertical" size={15} /></span>
                    <span className={`spine-dot ${dotClass} ${s.gate ? "gate" : ""}`}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {renameId === s.id ? (
                        <input className="spine-rename" autoFocus defaultValue={s.title}
                          onBlur={e => { renameStep(s.id, e.target.value.trim() || s.title); setRenameId(null); }}
                          onKeyDown={e => { if (e.key === "Enter") { renameStep(s.id, e.target.value.trim() || s.title); setRenameId(null); } }} />
                      ) : (
                        <span className="spine-t1" onClick={() => setRenameId(s.id)} title="Rename">{s.title} <Ico name="Pencil" size={11} /></span>
                      )}
                      <span className="spine-t2">{s.estimate}</span>
                    </span>
                    <span className="spine-move">
                      <button disabled={i === 0} onClick={() => moveStep(i, i - 1)} aria-label="Move up"><Ico name="ChevronUp" size={14} /></button>
                      <button disabled={i === roadmap.steps.length - 1} onClick={() => moveStep(i, i + 1)} aria-label="Move down"><Ico name="ChevronDown" size={14} /></button>
                    </span>
                    <button className="spine-del" disabled={roadmap.steps.length <= 1} onClick={() => removeStepById(s.id)} aria-label="Remove milestone" title="Remove this section"><Ico name="Trash2" size={13} /></button>
                  </div>
                ) : (
                  <button className={`spine-item ${i === selected ? "sel" : ""}`} onClick={() => { setSelected(i); onOpenStep && onOpenStep(s.id); }}>
                    <span className={`spine-dot ${dotClass} ${s.gate ? "gate" : ""}`}>
                      {s.status === "done" ? <Ico name="Check" size={14} color="#fff" />
                        : s.recovery ? <Ico name="AlertTriangle" size={13} color="#fff" /> : i + 1}
                    </span>
                    <span>
                      <span className="spine-t1">{s.title} {s.gate && <span className="spine-flag">gate</span>}{s.status === "redo" && <span className="spine-flag">redo</span>}</span>
                      <span className="spine-t2">{s.estimate}</span>
                    </span>
                  </button>
                )}
              </React.Fragment>
            );
          })}
          <button className="btn sm spine-add" onClick={addMilestone}><Ico name="Plus" size={14} /> Add your own section</button>
        </div>

        {/* Step sheet */}
        <div>
          <div className={`step-head ${step.recovery ? "recovery" : ""}`}>
            <div className="step-num">{step.recovery ? "!" : stepNum}</div>
            <div style={{ flex: 1 }}>
              <div className="eyebrow"><Ico name={step.icon} size={13} /> {step.recovery ? "Recovery" : isDone ? "Completed" : `Step ${stepNum} · ${step.phase}`}</div>
              <h1 className="display">{step.title}</h1>
              <p className="obj">{step.objective}</p>
              <div className="meta">
                <span className="chip"><Ico name="Clock" size={12} /> {step.estimate}</span>
                {step.deliverableSource && <span className="chip"><Ico name="FileText" size={12} /> Source: {step.deliverableSource}</span>}
                {step.deliverable && !step.handbookDerived && <span className="chip deliv-sat"><Ico name="CheckCircle2" size={12} /> Satisfies: {step.deliverable}</span>}
                {stepIsCurrentNow && stuck >= (H.STALL_DAYS || 14) && (
                  <span className="chip chip-risk"><Ico name="AlertTriangle" size={12} /> Stuck {stuck} days — let's unblock it</span>
                )}
              </div>
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

          {/* What trips people up here — surfaces tacit knowledge at the right moment */}
          {risks.length > 0 && (
            <div className="risks">
              <div className="risks-h"><Ico name="Lightbulb" size={14} /> What trips people up here</div>
              <ul className="risks-list">
                {risks.map((r, i) => <li key={i}><Ico name="AlertTriangle" size={12} /> <span>{r}</span></li>)}
              </ul>
            </div>
          )}

          {isDone && (
            <div className="tip tip-coach" style={{ marginBottom: 16 }}>
              <span className="tip-ico"><Ico name="Check" size={15} color="#fff" /></span>
              <div className="tip-body">You finished this milestone. Browsing it for reference — jump to your current step in the list anytime.</div>
            </div>
          )}

          {/* Committee Builder — full workbench for the committee step */}
          {(step.id === "committee" || step.templateId === "committee") && window.CommitteeBuilder && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Users" size={13} /></span> Committee builder · score real names or get suggestions</div>
              <window.CommitteeBuilder />
            </>
          )}

          {/* Live tools — user-editable per step */}
          <div className="section-label" style={{ display: "flex", alignItems: "center" }}>
            <span className="ic"><Ico name="Wrench" size={13} /></span> Your tools for this step
            <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setToolPicker(o => !o)}>
              <Ico name={toolPicker ? "ChevronUp" : "Plus"} size={13} /> {toolPicker ? "Close" : "Add tool"}
            </button>
          </div>
          {toolPicker && (
            <div className="feat-picker">
              {Object.keys(RE2.FEATURES).filter(f => !effActive.includes(f)).map(f => {
                const feat = RE2.feature(f);
                return (
                  <button key={f} className="feat-add-chip" onClick={() => addTool(f)} title={feat.blurb}>
                    <Ico name={feat.icon} size={12} /> {feat.name} <Ico name="Plus" size={11} />
                  </button>
                );
              })}
            </div>
          )}
          {liveTools.length > 0 ? (
            <div className="toolgrid">
              {liveTools.map(f => (
                <div className="tool-wrap" key={f}>
                  <button className="tool-x" onClick={() => removeTool(f)} title="Remove this tool from the step"><Ico name="X" size={12} /></button>
                  {window.renderTool(f)}
                </div>
              ))}
            </div>
          ) : chipOnly.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 14 }}>No tools on this step yet. Add the ones you want here.</div>
          )}

          {/* Checklist — fully editable: add, rename, remove */}
          <div className="section-label"><span className="ic"><Ico name="ListChecks" size={13} /></span> Steps to complete · {doneN}/{step.subtasks.length}</div>
          <div className="tasklist">
            {step.subtasks.map((t, i) => {
              const d = doneTasks.has(tkey(t));
              const open = openTask === i;
              return (
                <div key={i} className={`taskrow ${d ? "done" : ""} ${open ? "open" : ""}`}>
                  <div className="taskrow-main">
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
                      <button className="btn sm primary" onClick={() => onAsk && onAsk(`I'm a PhD student working on "${step.title}". Walk me through, step by step, how to: ${t} Assume I'm new to this and give concrete first actions.`)}>
                        <Ico name="MessageCircle" size={13} color="#fff" /> Ask your advisors how
                      </button>
                      {skillsUnlocked && (
                        <button className="btn sm" onClick={() => onNav && onNav("skills")}>
                          <Ico name="Sparkles" size={13} /> Find a tool for this
                        </button>
                      )}
                      {!d && <button className="btn sm ghost" onClick={() => { toggleTask(t); setOpenTask(-1); }}><Ico name="Check" size={13} /> Mark done</button>}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="task-add">
              <input className="def-add-input" value={newTask} onChange={e => setNewTask(e.target.value)}
                placeholder="Add your own to-do for this section..."
                onKeyDown={e => e.key === "Enter" && addTask()} />
              <button className="btn sm" onClick={addTask} disabled={!newTask.trim()}><Ico name="Plus" size={13} /> Add</button>
            </div>
          </div>

          {/* What changes */}
          {(step.add.length > 0 || step.retire.length > 0) && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Replace" size={13} /></span> How your tools change here</div>
              <div className="changes">
                <div className="change-col add">
                  <div className="cc-h"><Ico name="PlusCircle" size={14} /> Unlocked now</div>
                  {step.add.length === 0 ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>Nothing new.</span>
                    : step.add.map(f => <span key={f} className="chip-feat"><Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}</span>)}
                </div>
                <div className="change-col ret">
                  <div className="cc-h"><Ico name="MinusCircle" size={14} /> Retires when done</div>
                  {step.retire.length === 0 ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>Nothing retires.</span>
                    : step.retire.map(f => <span key={f} className="chip-feat"><Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}</span>)}
                </div>
              </div>
            </>
          )}

          {chipOnly.length > 0 && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Boxes" size={13} /></span> Also active</div>
              <div>{chipOnly.map(f => (
                <span key={f} className="chip-feat">
                  <Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}
                  <button className="chipx" onClick={() => removeTool(f)} title="Remove this tool from the step"><Ico name="X" size={10} /></button>
                </span>
              ))}</div>
            </>
          )}

          {/* Complete CTA */}
          {isCurrent && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, padding: "18px 20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
              <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>
                {allDone ? <><b style={{ color: "var(--text)" }}>All steps checked.</b> Ready to celebrate this milestone.</> : `${step.subtasks.length - doneN} step${step.subtasks.length - doneN === 1 ? "" : "s"} left`}
              </div>
              <button className="btn primary lg" onClick={() => complete(step.id)} disabled={!allDone}>
                <Ico name="Flag" size={15} color="#fff" /> Complete milestone
              </button>
            </div>
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
  ["Persona / lens", "An advisor's point of view (methods, theory, writing, wellbeing…). Pick who answers in Chat."],
  ["Skill", "A specialized assistant that does a task and drops the result into your Workspace or Documents."],
  ["Deliverable", "Something your program requires you to produce — a form, an exam, a document."],
  ["Recovery / re-plan", "When something goes wrong, describe it and your plan re-routes with concrete steps."],
  ["ABD", "“All But Dissertation” — everything's done except writing and defending."],
  ["IRB", "Institutional Review Board — approval needed before research involving human participants."],
  ["Prelim / Comprehensive exam", "Early exams proving you've absorbed your field before advancing."],
  ["Candidacy", "Officially cleared to do dissertation research (the paperwork after prelims)."]
];
const HELP_FAQ = [
  ["Why don't I see Skills yet?", "Skills unlock after 5 chat messages — or turn on “Reveal everything now” in Settings → Feature unlocks."],
  ["How do I simplify my home screen?", "Set Display density to “Just what I need” in Settings."],
  ["Something went wrong with my research", "Use “Something came up?” on Home or My Plan — describe it in plain words and your plan re-routes around it."],
  ["Are my conversations private?", "Choose on-device / private models in Settings to keep processing local (slightly lower accuracy)."],
  ["How do I get every feature right now?", "Settings → Feature unlocks → Reveal everything now."]
];
const SETTINGS_INSTITUTIONS = window.UNIVERSITY_OPTIONS || [];
const SETTINGS_PROGRAMS = window.PROGRAM_OPTIONS || [];

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

function SettingsView({ roadmap = null, setRoadmap, theme, onToggleTheme, prefs = {}, setPrefs, engagement = {}, unlocked = {}, onRevealAll, onResetDrip, onToggleHidden, onRebuild, onReplayOnboarding, onSignOut }) {
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
  const unlockRows = [["multiple", "Compare advisors (Multiple mode)", "after 1 message", 1], ["skills", "Skills library", "after 5 messages", 5], ["personas10", "All 10 advisors", "after 15 messages", 15]];

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
// COMMAND PALETTE (⌘K) — jump anywhere, or type to capture a note/deadline.
// ============================================================================
function CommandPalette({ onClose, onNav, onSos, onToggleTheme, onReplayTour, onToast, skillsUnlocked = true }) {
  const [q, setQ] = useS2("");
  const inputRef = useR2(null);
  useE2(() => { inputRef.current && inputRef.current.focus(); }, []);

  const NAV = [
    ["home", "Home", "Home"], ["plan", "My Plan", "Map"], ["chat", "Chat", "MessageCircle"],
    ["skills", "Skills", "Sparkles"], ["insights", "Insights", "Lightbulb"],
    ["defense", "Defense Room", "Presentation"], ["documents", "Documents", "FileText"], ["settings", "Settings", "Settings"]
  ].filter(([id]) => id !== "skills" || skillsUnlocked)
   .map(([id, label, icon]) => ({ id: "nav-" + id, label: "Go to " + label, icon, run: () => { onNav(id); onClose(); } }));
  const ACTIONS = [
    { id: "act-newchat", label: "Start a new chat", icon: "Plus", run: () => { onNav("chat"); onClose(); } },
    { id: "act-help", label: "Help / get unstuck", icon: "LifeBuoy", run: () => { onNav("settings"); onClose(); } },
    { id: "act-sos", label: "Something came up (re-plan)", icon: "LifeBuoy", run: () => { onSos(); onClose(); } },
    { id: "act-theme", label: "Toggle light / dark theme", icon: "Moon", run: () => { onToggleTheme(); onClose(); } },
    { id: "act-tour", label: "Replay the welcome tour", icon: "Rocket", run: () => { onReplayTour(); onClose(); } }
  ];
  const ql = q.trim().toLowerCase();
  const matches = (ql ? [...NAV, ...ACTIONS].filter(c => c.label.toLowerCase().includes(ql)) : [...NAV, ...ACTIONS]);
  const captures = ql ? [
    { id: "cap-note", label: `Add note: “${q.trim()}”`, icon: "StickyNote", run: () => { const k = "phd-tool-notes"; const a = H.loadJSON(k, []); a.unshift({ id: "n" + Date.now(), text: q.trim(), at: Date.now() }); H.saveJSON(k, a); onToast && onToast("Note saved — find it in a Notes widget"); onClose(); } },
    { id: "cap-dl", label: `Add deadline: “${q.trim()}”`, icon: "Calendar", run: () => { const k = window.DEADLINES_KEY || "phd-coach-deadlines-v1"; const a = H.loadJSON(k, []); a.push({ id: "d" + Date.now(), label: q.trim(), date: "" }); H.saveJSON(k, a); onToast && onToast("Deadline added — set a date in the Deadlines widget"); onClose(); } }
  ] : [];
  const list = [...matches, ...captures];
  const onKeyDown = (e) => { if (e.key === "Escape") onClose(); else if (e.key === "Enter" && list[0]) list[0].run(); };

  return (
    <div className="backdrop cmd-backdrop" onClick={onClose}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-input">
          <Ico name="Search" size={16} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search actions, or type to add a note / deadline…" aria-label="Command search" />
          <kbd>esc</kbd>
        </div>
        <div className="cmd-list">
          {list.length === 0 && <div className="cmd-empty">No matches.</div>}
          {list.map((c, i) => (
            <button key={c.id} className="cmd-item" onClick={c.run}>
              <span className="cmd-i"><Ico name={c.icon} size={15} /></span> {c.label}
            </button>
          ))}
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
  skills: { icon: "Sparkles", title: "Skills are unlocked", to: "skills", cta: "Explore Skills",
    body: "Skills are specialized assistants that do the work — find a literature gap, outline a chapter, critique your methods. They drop results into your Workspace or Documents." },
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
  const [palette, setPalette] = useS2(false); // ⌘K command palette
  const [activity, setActivity] = useS2(() => H.loadJSON(H.ACT_KEY, {})); // per-step last-touched
  const touchStep = (id) => { if (id) setActivity(a => ({ ...a, [id]: Date.now() })); };
  const [chatSeed, setChatSeed] = useS2(null); // prefill the chat composer + jump there
  const askInChat = (q) => { setChatSeed(q); setView("chat"); };
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
  // A feature is "on" once its message threshold is reached (or reveal-all) AND
  // the user hasn't chosen to keep it hidden.
  const isHidden = (id) => (prefs.hidden || []).includes(id);
  const reached = (thr) => prefs.revealAll || engagement.messages >= thr;
  const unlocked = useM2(() => ({
    multiple:   reached(1)  && !isHidden("multiple"),
    skills:     reached(5)  && !isHidden("skills"),
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
  const revealAllNow = () => { setPrefs(p => ({ ...p, revealAll: true, hidden: [] })); setSeenUnlocks(["multiple", "skills", "personas10"]); setUnlockPopup(null); };
  const resetDrip = () => { setEngagement(e => ({ messages: 0, visits: e.visits || 0 })); setSeenUnlocks([]); setPrefs(p => ({ ...p, revealAll: false, hidden: [] })); setUnlockPopup(null); };

  useE2(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem(H.THEME_KEY, theme); } catch (e) {} }, [theme]);
  useE2(() => { H.saveJSON(H.RM_KEY, roadmap); }, [roadmap]);
  useE2(() => { H.saveJSON(H.TASK_KEY, [...doneTasks]); }, [doneTasks]);
  useE2(() => { H.saveJSON(H.ACT_KEY, activity); }, [activity]);
  useE2(() => { H.saveJSON(H.PREFS_KEY, prefs); }, [prefs]);
  useE2(() => { H.saveJSON(H.ENGAGE_KEY, engagement); }, [engagement]);
  useE2(() => { H.saveJSON(H.UNLOCKS_KEY, seenUnlocks); }, [seenUnlocks]);
  useE2(() => { setEngagement(e => ({ ...e, visits: (e.visits || 0) + 1 })); }, []); // count one visit per app load
  // Fire one unlock popup when a message threshold is first crossed (drip users only).
  useE2(() => {
    if (prefs.revealAll || unlockPopup) return;
    const order = ["multiple", "skills", "personas10"];
    const next = order.find(id => unlocked[id] && !seenUnlocks.includes(id));
    if (next) setUnlockPopup(next);
  }, [engagement.messages, prefs.revealAll]);
  // If Skills gets re-locked (reset drip) while viewing it, bounce home.
  useE2(() => { if (view === "skills" && !unlocked.skills) setView("home"); }, [view, unlocked.skills]);
  // ⌘K / Ctrl+K opens the command palette anywhere in the app.
  useE2(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setPalette(p => !p); }
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

  // 1) Not signed in → marketing landing / login. Auth is real (CoachAPI):
  // CoachLogin performs the backend login/signup and only calls onAuthed on
  // success. A brand-new account (isNew) lands in onboarding with a fresh plan.
  const onAuthed = (isNew) => {
    if (window.CoachAPI) window.MOCK_USER = window.CoachAPI.getUser();
    if (isNew) { setRoadmap(null); setDoneTasks(new Set()); }
    setAuthed(true);
    setView("home");
  };
  const handleAuthExpired = () => {
    if (window.CoachAPI) window.CoachAPI.clearAuth();
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

  // 2) Signed in, no plan yet → onboarding (onboarding hands up density/model prefs)
  if (!roadmap) {
    return <window.CoachOnboarding
      onAuthExpired={handleAuthExpired}
      onComplete={(rm, p) => { setRoadmap(rm); if (p) setPrefs(prev => ({ ...prev, ...p })); setView("home"); }} />;
  }

  const signOut = () => { if (window.CoachAPI) window.CoachAPI.clearAuth(); setAuthed(false); setGate("landing"); setView("home"); };
  // Sanitize view: Skills isn't reachable until unlocked, and Workspace is not
  // its own page — its tools live on Home (in the Tools popup), so redirect there.
  const v = (view === "skills" && !unlocked.skills) ? "home" : (view === "workspace" ? "home" : view);

  let body;
  if (v === "home") body = <window.CoachDashboard roadmap={roadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} onNav={setView} onOpenSos={() => setSosOpen(true)} onOpenStep={openWorkspace} focused={focused} theme={theme} />;
  else if (v === "plan") body = <PlanView roadmap={roadmap} setRoadmap={setRoadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} touchStep={touchStep} onCelebrate={setCelebrate} onOpenSos={() => setSosOpen(true)} onAsk={askInChat} onNav={setView} onOpenStep={openWorkspace} skillsUnlocked={unlocked.skills} />;
  else if (v === "chat") body = <window.CoachChatView roadmap={roadmap} setRoadmap={setRoadmap} onNav={setView} onToast={setToast} seed={chatSeed} onSeedConsumed={() => setChatSeed(null)} unlocked={unlocked} onMessage={bumpMessages} />;
  else if (v === "skills") body = <window.CoachSkills roadmap={roadmap} onNav={setView} />;
  else if (v === "insights") body = <window.CoachInsights onNav={setView} />;
  else if (v === "defense") body = <window.CoachDefenseRoom roadmap={roadmap} onNav={setView} onToast={setToast} />;
  else if (v === "documents") body = <window.CoachDocuments roadmap={roadmap} />;
  else body = <SettingsView roadmap={roadmap} setRoadmap={setRoadmap} theme={theme} onToggleTheme={toggleTheme}
    prefs={prefs} setPrefs={setPrefs} engagement={engagement} unlocked={unlocked}
    onRevealAll={revealAllNow} onResetDrip={resetDrip} onToggleHidden={toggleHidden}
    onRebuild={() => { if (confirm("Rebuild your plan from scratch? Progress clears.")) { setRoadmap(null); setDoneTasks(new Set()); } }}
    onReplayOnboarding={() => { setView("home"); setShowTour(true); }}
    onSignOut={signOut} />;

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <window.CoachRail view={view} onNav={setView} user={window.MOCK_USER} skillsUnlocked={unlocked.skills} onSignOut={signOut} />
      <main className="main" id="main-content" tabIndex={-1}>
        <div className="topbar">
          <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
            <Ico name="Compass" size={15} /> {roadmap.program?.name || "PhD Navigator"}
            {prefs.modelMode === "private" && <span className="private-pill" title="On-device / private models"><Ico name="ShieldCheck" size={12} /> Private</span>}
          </div>
          <div className="tb-r">
            <button className="btn sm" onClick={() => setPalette(true)} title="Command palette" aria-label="Open command palette"><Ico name="Search" size={15} /> Search</button>
            <button className="btn icon sm" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle light or dark theme"><Ico name={theme === "light" ? "Moon" : "Sun"} size={16} /></button>
            <button className="btn sm" onClick={() => setView("chat")}><Ico name="MessageCircle" size={15} /> Chat</button>
          </div>
        </div>
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
      {palette && <CommandPalette
        onClose={() => setPalette(false)}
        onNav={setView}
        onSos={() => setSosOpen(true)}
        onToggleTheme={toggleTheme}
        onReplayTour={() => { setView("home"); setShowTour(true); }}
        skillsUnlocked={unlocked.skills}
        onToast={setToast} />}
      {unlockPopup && <UnlockPopup id={unlockPopup}
        onDismiss={() => dismissUnlock(unlockPopup)}
        onKeepHidden={keepHidden}
        onAct={() => { const to = UNLOCK_CONTENT[unlockPopup].to; dismissUnlock(unlockPopup); setView(to); }} />}
      {toast && <div className="toast"><Ico name="CheckCircle2" size={15} /> {toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<CoachRoot />);
