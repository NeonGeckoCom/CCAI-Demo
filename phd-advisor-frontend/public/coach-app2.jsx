/* coach-app2.jsx — Plan/step view, recovery, chat, settings, router + mount.
   Loads after coach-app.jsx. */

const { useState: useS2, useEffect: useE2, useMemo: useM2, useRef: useR2 } = React;
const Ico = window.Icon;
const RE2 = window.RoadmapEngine;
const H = window.coachHelpers;

// ============================================================================
// PLAN / STEP VIEW  (spine + focused current step + live tools)
// ============================================================================
function PlanView({ roadmap, setRoadmap, doneTasks, setDoneTasks, activity, touchStep, onCelebrate, onOpenSos, onAsk, onNav, onOpenStep }) {
  const [selected, setSelected] = useS2(() => {
    const c = roadmap.steps.findIndex(s => s.status === "current");
    return c >= 0 ? c : 0;
  });
  const [openTask, setOpenTask] = useS2(-1); // which sub-task's "how to" drawer is open

  const step = roadmap.steps[selected];
  const fs = RE2.computeFeatureState(roadmap, selected);
  const liveTools = fs.active.filter(f => window.hasTool(f));
  const chipOnly = fs.active.filter(f => !window.hasTool(f));
  const stepNum = selected + 1;
  const isCurrent = step.status === "current" || step.status === "redo" || step.status === "paused";
  const isDone = step.status === "done";
  const tkey = (t) => `${step.id}::${t}`;
  const doneN = step.subtasks.filter(t => doneTasks.has(tkey(t))).length;
  const allDone = doneN === step.subtasks.length;
  const risks = RE2.risks ? RE2.risks(step.id) : [];
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

  const doneCount = roadmap.steps.filter(s => s.status === "done").length;
  const pct = Math.round((doneCount / roadmap.steps.length) * 100);

  let lastPhase = null;

  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 16 }}>
        <h1 className="display" style={{ fontSize: 24 }}>{roadmap.program?.name || "Your plan"}</h1>
        <div className="sub">{doneCount} of {roadmap.steps.length} milestones complete · {pct}%</div>
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
              </React.Fragment>
            );
          })}
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
                {step.deliverable && <span className="chip deliv-sat"><Ico name="CheckCircle2" size={12} /> Satisfies: {step.deliverable}</span>}
                {stepIsCurrentNow && stuck >= (H.STALL_DAYS || 14) && (
                  <span className="chip chip-risk"><Ico name="AlertTriangle" size={12} /> Stuck {stuck} days — let's unblock it</span>
                )}
              </div>
            </div>
            {!isCurrent && (
              <button className="btn" onClick={() => setCurrent(step.id)}>
                <Ico name={isDone ? "Undo2" : "MapPin"} size={14} /> {isDone ? "Step back here" : "I'm working here"}
              </button>
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
          {step.id === "committee" && window.CommitteeBuilder && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Users" size={13} /></span> Committee builder · score real names or get suggestions</div>
              <window.CommitteeBuilder />
            </>
          )}

          {/* Live tools */}
          {liveTools.length > 0 && (
            <>
              <div className="section-label"><span className="ic"><Ico name="Wrench" size={13} /></span> Your tools for this step · adapts as you move</div>
              <div className="toolgrid">
                {liveTools.map(f => <React.Fragment key={f}>{window.renderTool(f)}</React.Fragment>)}
              </div>
            </>
          )}

          {/* Checklist */}
          <div className="section-label"><span className="ic"><Ico name="ListChecks" size={13} /></span> Steps to complete · {doneN}/{step.subtasks.length}</div>
          <div className="tasklist">
            {step.subtasks.map((t, i) => {
              const d = doneTasks.has(tkey(t));
              const open = openTask === i;
              return (
                <div key={i} className={`taskrow ${d ? "done" : ""} ${open ? "open" : ""}`}>
                  <div className="taskrow-main">
                    <button className="cb" onClick={() => toggleTask(t)} aria-label={d ? "Mark not done" : "Mark done"}>{d && <Ico name="Check" size={12} color="#fff" />}</button>
                    <button className="taskrow-text" onClick={() => setOpenTask(open ? -1 : i)}>{t}</button>
                    <button className="taskrow-go" onClick={() => setOpenTask(open ? -1 : i)} aria-label="How do I do this?">
                      <span className="taskrow-help">How?</span> <Ico name={open ? "ChevronUp" : "ChevronDown"} size={15} />
                    </button>
                  </div>
                  {open && (
                    <div className="taskrow-actions">
                      <button className="btn sm primary" onClick={() => onAsk && onAsk(`I'm a PhD student working on "${step.title}". Walk me through, step by step, how to: ${t} Assume I'm new to this and give concrete first actions.`)}>
                        <Ico name="MessageCircle" size={13} color="#fff" /> Ask your advisors how
                      </button>
                      <button className="btn sm" onClick={() => onNav && onNav("skills")}>
                        <Ico name="Sparkles" size={13} /> Find a tool for this
                      </button>
                      {!d && <button className="btn sm ghost" onClick={() => { toggleTask(t); setOpenTask(-1); }}><Ico name="Check" size={13} /> Mark done</button>}
                    </div>
                  )}
                </div>
              );
            })}
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
              <div>{chipOnly.map(f => <span key={f} className="chip-feat"><Ico name={RE2.feature(f).icon} size={12} /> {RE2.feature(f).name}</span>)}</div>
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
          <button className="modal-x" onClick={onClose}><Ico name="X" size={14} /></button>
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
function SettingsView({ theme, onToggleTheme, onRebuild, onReplayOnboarding, onSignOut }) {
  return (
    <div className="page page-narrow">
      <div className="greeting"><h1 className="display" style={{ fontSize: 26 }}>Settings</h1><div className="sub">Make it yours.</div></div>
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
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="ico"><Ico name="Map" size={14} /></span> Your plan</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Rebuild plan</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Start the setup over from scratch</div></div>
          <button className="btn sm" onClick={onRebuild}><Ico name="RefreshCw" size={14} /> Rebuild</button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <div><div style={{ fontWeight: 600, fontSize: 14 }}>Replay welcome tour</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Walk through what each page does again</div></div>
          <button className="btn sm" onClick={onReplayOnboarding}><Ico name="Rocket" size={14} /> Take the tour</button>
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-h"><span className="ico"><Ico name="User" size={14} /></span> Account</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>Signed in as <strong style={{ color: "var(--text)" }}>{window.MOCK_USER.email}</strong></div>
          <button className="btn sm" onClick={onSignOut}><Ico name="LogOut" size={14} /> Sign out</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STEP WORKSPACE — click a milestone → a focused popup that DYNAMICALLY loads
// the right tools, guidance, checklist and "do the work" actions for that step.
// The tools come from the roadmap engine's per-step feature lifecycle, so each
// step shows different contents. (Backend can later enrich each section.)
// ============================================================================
// Per-step starter document (frontend default; backend can personalize).
const STEP_DOC = {
  proposal: "thesis-chapter", writing: "thesis-chapter", defense: "defense-slides",
  irb: "irb-protocol", submission: "dissertation-format", literature: "research-statement",
  committee: "faculty-hunt", analysis: "research-paper", "early-writing": "thesis-chapter", "first-paper": "conference-abstract"
};
function StepWorkspace({ roadmap, stepId, doneTasks, onToggleTask, onComplete, onAsk, onNav, onClose, onToast }) {
  const [openTask, setOpenTask] = useS2(-1);
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
  const risks = RE2.risks ? RE2.risks(step.id) : [];
  const tkey = (t) => `${step.id}::${t}`;
  const doneN = step.subtasks.filter(t => doneTasks.has(tkey(t))).length;
  const allDone = doneN === step.subtasks.length;
  const isCurrent = step.status === "current" || step.status === "redo" || step.status === "paused";
  const tpl = STEP_DOC[step.id] && (window.DOC_TEMPLATES || []).find(t => t.id === STEP_DOC[step.id]);

  const askHow = (what) => { onAsk && onAsk(`I'm a PhD student working on "${step.title}". Walk me through, step by step, how to: ${what} I'm new to this — give concrete first actions.`); onClose(); };
  const makeBoard = () => { if (window.CoachActions) { window.CoachActions.addWidget("kanban", step.subtasks.slice(0, 6)); onToast && onToast("Task board added to Workspace"); } };
  const startDoc = () => { if (window.CoachActions && tpl) { window.CoachActions.createDoc(tpl.id, `${step.title} — ${tpl.name}`, {}); onClose(); onNav && onNav("documents"); } };

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
            <button className="btn ghost" onClick={() => { onNav && onNav("skills"); onClose(); }}><Ico name="Sparkles" size={15} /> Browse skills</button>
          </div>

          {/* Committee builder — special interactive tool for that step */}
          {step.id === "committee" && window.CommitteeBuilder && (
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
      </div>
    </div>
  );
}

// ============================================================================
// COMMAND PALETTE (⌘K) — jump anywhere, or type to capture a note/deadline.
// ============================================================================
function CommandPalette({ onClose, onNav, onSos, onToggleTheme, onReplayTour, onToast }) {
  const [q, setQ] = useS2("");
  const inputRef = useR2(null);
  useE2(() => { inputRef.current && inputRef.current.focus(); }, []);

  const NAV = [
    ["home", "Home", "Home"], ["plan", "My Plan", "Map"], ["chat", "Chat", "MessageCircle"],
    ["skills", "Skills", "Sparkles"], ["insights", "Insights", "Lightbulb"],
    ["workspace", "Workspace", "LayoutDashboard"], ["documents", "Documents", "FileText"], ["settings", "Settings", "Settings"]
  ].map(([id, label, icon]) => ({ id: "nav-" + id, label: "Go to " + label, icon, run: () => { onNav(id); onClose(); } }));
  const ACTIONS = [
    { id: "act-newchat", label: "Start a new chat", icon: "Plus", run: () => { onNav("chat"); onClose(); } },
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
// ROOT
// ============================================================================
function CoachRoot() {
  const [roadmap, setRoadmap] = useS2(() => H.loadJSON(H.RM_KEY, null));
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

  useE2(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem(H.THEME_KEY, theme); } catch (e) {} }, [theme]);
  useE2(() => { H.saveJSON(H.RM_KEY, roadmap); }, [roadmap]);
  useE2(() => { H.saveJSON(H.TASK_KEY, [...doneTasks]); }, [doneTasks]);
  useE2(() => { H.saveJSON(H.ACT_KEY, activity); }, [activity]);
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

  // 2) Signed in, no plan yet → onboarding
  if (!roadmap) {
    return <window.CoachOnboarding onComplete={(rm) => { setRoadmap(rm); setView("home"); }} />;
  }

  let body;
  if (view === "home") body = <window.CoachDashboard roadmap={roadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} onNav={setView} onOpenSos={() => setSosOpen(true)} onOpenStep={openWorkspace} theme={theme} />;
  else if (view === "plan") body = <PlanView roadmap={roadmap} setRoadmap={setRoadmap} doneTasks={doneTasks} setDoneTasks={setDoneTasks} activity={activity} touchStep={touchStep} onCelebrate={setCelebrate} onOpenSos={() => setSosOpen(true)} onAsk={askInChat} onNav={setView} onOpenStep={openWorkspace} />;
  else if (view === "chat") body = <window.CoachChatView roadmap={roadmap} setRoadmap={setRoadmap} onNav={setView} onToast={setToast} seed={chatSeed} onSeedConsumed={() => setChatSeed(null)} />;
  else if (view === "skills") body = <window.CoachSkills roadmap={roadmap} onNav={setView} />;
  else if (view === "insights") body = <window.CoachInsights onNav={setView} />;
  else if (view === "workspace") body = <window.CoachWorkspace roadmap={roadmap} />;
  else if (view === "documents") body = <window.CoachDocuments />;
  else body = <SettingsView theme={theme} onToggleTheme={toggleTheme}
    onRebuild={() => { if (confirm("Rebuild your plan from scratch? Progress clears.")) { setRoadmap(null); setDoneTasks(new Set()); } }}
    onReplayOnboarding={() => { setView("home"); setShowTour(true); }}
    onSignOut={() => { if (window.CoachAPI) window.CoachAPI.clearAuth(); setAuthed(false); setGate("landing"); setView("home"); }} />;

  return (
    <div className="shell">
      <window.CoachRail view={view} onNav={setView} user={window.MOCK_USER} />
      <div className="main">
        <div className="topbar">
          <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
            <Ico name="Compass" size={15} /> {roadmap.program?.name || "PhD Navigator"}
          </div>
          <div className="tb-r">
            <button className="btn sm" onClick={() => setPalette(true)} title="Command palette" aria-label="Open command palette"><Ico name="Search" size={15} /> <kbd className="kbd-inline">⌘K</kbd></button>
            <button className="btn icon sm" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle light or dark theme"><Ico name={theme === "light" ? "Moon" : "Sun"} size={16} /></button>
            <button className="btn sm" onClick={() => setView("chat")}><Ico name="MessageCircle" size={15} /> Chat</button>
          </div>
        </div>
        {body}
      </div>

      <Celebration data={celebrate} onClose={() => setCelebrate(null)} />
      {showTour && <window.CoachTour onNav={setView} onClose={() => setShowTour(false)} />}
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
        onClose={() => setWsStep(null)} />}
      {palette && <CommandPalette
        onClose={() => setPalette(false)}
        onNav={setView}
        onSos={() => setSosOpen(true)}
        onToggleTheme={toggleTheme}
        onReplayTour={() => { setView("home"); setShowTour(true); }}
        onToast={setToast} />}
      {toast && <div className="toast"><Ico name="CheckCircle2" size={15} /> {toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<CoachRoot />);
