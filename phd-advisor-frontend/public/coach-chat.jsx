/* coach-chat.jsx — Chat v3
   - Left aside: choose PERSONAS (lenses) + run SKILLS (workflows)
   - Composer: Single ↔ Multiple toggle controls how many persona replies show
   - Skills actually mutate the Workspace + Documents stores (window.CoachActions)
   Exports window.CoachChatView. Shares scope; uses window.Icon + window.coachHelpers.
*/

const { useState: useSC, useEffect: useEC, useRef: useRC } = React;
const IcoC = window.Icon;
const HC = window.coachHelpers;

// ---- Actions the AI can take: write straight into the stores the views read ----
const WS_STORE = "phd-coach-workspace-v1";
const DOC_STORE = "phd-coach-docs-v1";
const cload = (k, d) => { try { const r = localStorage.getItem(k); return r != null ? JSON.parse(r) : d; } catch (e) { return d; } };
const csave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const CoachActions = {
  addWidget(type, seed) {
    const arr = cload(WS_STORE, []);
    arr.push({ id: `w-${type}-${Date.now()}`, type, size: "M", seed });
    csave(WS_STORE, arr);
  },
  createDoc(templateId, name, sections) {
    const store = cload(DOC_STORE, { projects: {}, activeId: null });
    const id = `p-${Date.now()}`;
    store.projects[id] = { id, name, templateId, sections: sections || {}, createdAt: Date.now() };
    store.activeId = id;
    csave(DOC_STORE, store);
    return id;
  }
};
window.CoachActions = CoachActions;

// ---- Skills: reusable workflows the chat can run ----------------------------
// Each returns an "action result" describing what changed + where to see it.
const SKILLS = [
  {
    id: "todo", name: "Build a to-do list", icon: "ListChecks", to: "workspace",
    blurb: "Turn this step into a Task Board on your Workspace.",
    run: (ctx) => {
      const tasks = (ctx.current.subtasks && ctx.current.subtasks.length ? ctx.current.subtasks.slice(0, 6)
        : ["Define the goal for this step", "Break it into 3 concrete actions", "Schedule the first one"]);
      CoachActions.addWidget("kanban", tasks);
      return { icon: "ListChecks", title: "Task Board created", to: "workspace", cta: "Open Workspace",
        body: `I added a Task Board to your Workspace with ${tasks.length} tasks drawn from “${ctx.current.title}.” Check them off as you go.`,
        items: tasks };
    }
  },
  {
    id: "meeting", name: "Draft advisor meeting prep", icon: "MessageSquare", to: "documents",
    blurb: "Generate a meeting-prep doc you can edit and bring to your 1:1.",
    run: (ctx) => {
      CoachActions.createDoc("meeting-prep", "Advisor Meeting Prep — this week", {
        agenda: `1. Progress on ${ctx.current.title}\n2. Open questions\n3. Decisions I need from you`,
        progress: `Currently working on “${ctx.current.title}.” ${ctx.current.objective}`,
        blockers: "• (Name anything slowing you down here)",
        decisions: "• (What do you need your advisor to decide or approve?)"
      });
      return { icon: "MessageSquare", title: "Meeting prep drafted", to: "documents", cta: "Open in Documents",
        body: "I created an editable Advisor Meeting Prep draft in Documents, pre-filled from where you are now. Add your blockers and you're ready." };
    }
  },
  {
    id: "outline", name: "Outline a chapter", icon: "List", to: "documents",
    blurb: "Scaffold a thesis chapter so writing has somewhere to start.",
    run: (ctx) => {
      CoachActions.createDoc("thesis-chapter", `Chapter outline — ${ctx.current.title}`, {
        "s-0": "Opening: the question this chapter answers and why it matters.",
        "s-1": "Background / prior work this chapter builds on.",
        "s-2": "Core argument or method — the spine of the chapter.",
        "s-3": "Evidence, results, or analysis.",
        "s-4": "What it means + the bridge to the next chapter."
      });
      return { icon: "List", title: "Chapter outline created", to: "documents", cta: "Open in Documents",
        body: "I scaffolded a thesis-chapter draft in Documents with five sections. Replace the prompts with your content." };
    }
  },
  {
    id: "reading", name: "Build a reading plan", icon: "BookOpen", to: "workspace",
    blurb: "Add a Reading Queue widget seeded with starter papers.",
    run: (ctx) => {
      const papers = ["Seminal paper in your area (most-cited)", "A recent review (last 2 years)", "The closest methods paper to your design", "One strong counter-argument to your thesis"];
      CoachActions.addWidget("reading-queue", papers);
      return { icon: "BookOpen", title: "Reading plan added", to: "workspace", cta: "Open Workspace",
        body: `I added a Reading Queue to your Workspace with ${papers.length} starting points tuned to “${ctx.current.title}.”`,
        items: papers };
    }
  },
  {
    id: "summary", name: "Summarize my week", icon: "TrendingUp", to: "workspace",
    blurb: "Drop a progress note into a Daily Documenter widget.",
    run: (ctx) => {
      const note = `Weekly summary · focused on “${ctx.current.title}.” ${ctx.current.objective} Next: pick the single most important task and protect two hours for it.`;
      CoachActions.addWidget("documenter", [note]);
      return { icon: "TrendingUp", title: "Weekly summary saved", to: "workspace", cta: "Open Workspace",
        body: "I summarized where you are into a Daily Documenter note on your Workspace." };
    }
  }
];
window.CHAT_SKILLS = SKILLS;

// ---- Persona reply generator (demo content; wire to backend later) ----------
function personaReply(advisor, current) {
  const lines = {
    methodologist: `**On “${current.title}”:** tighten the method before the scope.\n\n- Write the one decision this step hinges on\n- Name what evidence would settle it\n- Keep the design defensible, not perfect`,
    theorist: `**On “${current.title}”:** anchor it to a framework.\n\n- Which theory does this step advance?\n- State the construct you're actually measuring\n- Cut anything that doesn't serve the argument`,
    pragmatist: `**On “${current.title}”:** ship the smallest real version.\n\n- What can you finish this week?\n- Do that first; refine later\n- Book the next concrete action now`,
    empathetic: `**On “${current.title}”:** be kind to yourself here.\n\n- This step trips up most people — you're not behind\n- Pick one task and let the rest wait\n- Celebrate finishing, not perfecting`,
    socratic: `**On “${current.title}”:** a question first.\n\n- What would make this step *done* in one sentence?\n- What's the smallest test of that?\n- What are you avoiding, and why?`,
    minimalist: `**On “${current.title}”:** less, but better.\n\n- One objective, one next action\n- Delete the rest for now\n- Return when this is truly finished`
  };
  return lines[advisor.id] || `**On “${current.title}”:** here's how I'd approach it — keep scope tight and tie it to your objective.`;
}

// ============================================================================
function CoachChatView({ roadmap, setRoadmap, onNav, onToast, seed, onSeedConsumed }) {
  const current = roadmap.steps.find(s => s.status === "current") || roadmap.steps.find(s => s.status === "redo") || roadmap.steps[0];
  const advisors = window.ADVISORS || [];

  const [mode, setMode] = useSC(() => { try { return localStorage.getItem("phd-chat-mode") || "single"; } catch (e) { return "single"; } });
  const [active, setActive] = useSC(() => {
    try { const r = JSON.parse(localStorage.getItem("phd-chat-personas")); if (Array.isArray(r) && r.length) return r; } catch (e) {}
    return [advisors[0]?.id].filter(Boolean);
  });
  const [messages, setMessages] = useSC([]);
  const [input, setInput] = useSC("");
  const [pop, setPop] = useSC(null); // 'personas' | 'skills' | null
  const [sessionId, setSessionId] = useSC(null); // backend chat-session id
  const [busy, setBusy] = useSC(false);
  const endRef = useRC(null);
  const toolsRef = useRC(null);

  useEC(() => { try { localStorage.setItem("phd-chat-mode", mode); } catch (e) {} }, [mode]);
  useEC(() => { try { localStorage.setItem("phd-chat-personas", JSON.stringify(active)); } catch (e) {} }, [active]);
  useEC(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  // Arriving from a "Help me with this step" action — prefill the composer so the
  // student just reviews and hits Send (no surprise auto-send to the backend).
  useEC(() => { if (seed) { setInput(seed); onSeedConsumed && onSeedConsumed(); } }, [seed]);
  useEC(() => {
    if (!pop) return;
    const onDown = (e) => { if (toolsRef.current && !toolsRef.current.contains(e.target)) setPop(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pop]);

  // switching to single keeps only the first active persona
  const setSingle = () => { setMode("single"); setActive(a => a.slice(0, 1).length ? a.slice(0, 1) : [advisors[0].id]); };
  const setMulti = () => { setMode("multiple"); setActive(a => a.length ? a : advisors.slice(0, 3).map(x => x.id)); };

  const pickPersona = (id) => {
    if (mode === "single") { setActive([id]); return; }
    setActive(a => a.includes(id) ? (a.length > 1 ? a.filter(x => x !== id) : a) : (a.length < 3 ? [...a, id] : a));
  };

  const responders = () => {
    const chosen = advisors.filter(a => active.includes(a.id));
    const list = chosen.length ? chosen : [advisors[0]];
    return mode === "single" ? list.slice(0, 1) : list.slice(0, 3);
  };

  // Apply the client-side plan-fork flourish (kept from the prototype — it's a
  // UI feature layered on top of the real chat, not a backend call).
  const maybeFork = (t) => {
    if (setRoadmap && window.RoadmapEngine.shouldFork(roadmap, t)) {
      const fork = window.RoadmapEngine.detectFork(roadmap, t);
      const prev = roadmap;
      const res = window.RoadmapEngine.forkPlan(roadmap, fork);
      setTimeout(() => {
        setRoadmap(res.roadmap);
        setMessages(p => [...p, { id: "fk" + Date.now(), type: "forked", fork, prev, undone: false }]);
      }, 650);
    }
  };

  const send = async (txt) => {
    const t = (txt ?? input).trim(); if (!t || busy) return;
    const API = window.CoachAPI;
    const userMsg = { id: "u" + Date.now(), type: "user", content: t };
    setMessages(p => [...p, userMsg]);
    setInput("");
    setBusy(true);

    // Ensure a real backend chat-session, then stream the advisors' replies.
    let sid = sessionId;
    try {
      if (API && !sid) { sid = await API.createSession(t.slice(0, 30)); if (sid) setSessionId(sid); }
      if (API && sid) API.saveMessage(sid, { ...userMsg, timestamp: new Date().toISOString() });

      let got = false;
      if (API) {
        await API.streamChat({
          userInput: t, sessionId: sid,
          onEvent: ({ type, data }) => {
            if (type === "advisor") {
              got = true;
              const msg = {
                id: "a" + Date.now() + Math.random().toString(36).slice(2, 5),
                type: "advisor", personaId: data.persona_id,
                personaName: data.persona_name || data.persona_id, content: data.content
              };
              setMessages(p => [...p, msg]);
              if (sid) API.saveMessage(sid, { ...msg, persona_id: data.persona_id, timestamp: new Date().toISOString() });
            } else if (type === "clarification") {
              got = true;
              setMessages(p => [...p, { id: "c" + Date.now(), type: "advisor", personaId: (advisors[0] || {}).id, content: data.message }]);
            } else if (type === "error") {
              got = true;
              setMessages(p => [...p, { id: "e" + Date.now(), type: "advisor", personaId: (advisors[0] || {}).id, content: data.detail || "Sorry — something went wrong." }]);
            }
          }
        });
      }
      if (!got) throw new Error("no-response"); // fall through to offline demo
    } catch (e) {
      // Backend unreachable → demo replies so the chat still works offline.
      setMessages(p => [...p, ...responders().map((a, i) => ({
        id: "a" + Date.now() + i, type: "advisor", personaId: a.id, content: personaReply(a, current)
      }))]);
    } finally {
      setBusy(false);
    }

    maybeFork(t);
  };

  const runSkill = (skill) => {
    setPop(null);
    setMessages(p => [...p, { id: "u" + Date.now(), type: "user", content: `Run skill: ${skill.name}` }]);
    setTimeout(() => {
      const res = skill.run({ current, roadmap });
      setMessages(p => [...p, { id: "act" + Date.now(), type: "action", result: res }]);
    }, 500);
  };

  const undoFork = (msgId, prev) => {
    if (setRoadmap && prev) setRoadmap(prev);
    setMessages(p => p.map(m => m.id === msgId ? { ...m, undone: true } : m));
    if (onToast) onToast("Fork undone — your plan is back to how it was.");
  };

  const hasMsgs = messages.length > 0;
  // group consecutive advisor messages into a row
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === "advisor") { const g = []; while (i < messages.length && messages[i].type === "advisor") { g.push(messages[i]); i++; } i--; groups.push({ k: "a", g }); }
    else if (messages[i].type === "action") groups.push({ k: "act", m: messages[i] });
    else if (messages[i].type === "forked") groups.push({ k: "fk", m: messages[i] });
    else groups.push({ k: "u", m: messages[i] });
  }

  const activeNames = advisors.filter(a => active.includes(a.id)).map(a => a.name);
  const activeCount = Math.min(active.length, mode === "single" ? 1 : 3);

  return (
    <div className="chat-wrap">
      <div className="chat-context" style={{ marginTop: 14 }}>
        <IcoC name="MapPin" size={14} /> Chatting about: <strong>&nbsp;{current.title}</strong>
        <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => { setMessages([]); setSessionId(null); if (window.CoachAPI) window.CoachAPI.newChat().catch(() => {}); }}><IcoC name="Plus" size={13} /> New chat</button>
        <button className="btn sm ghost" onClick={() => onNav("plan")}>Open in plan <IcoC name="ArrowRight" size={13} /></button>
      </div>

      <div className="chat-scroll">
        {!hasMsgs ? (
          <>
            <div className="chat-welcome">
              <h2 className="display">How can I help with {current.title.toLowerCase()}?</h2>
              <p>{mode === "single" ? <>Answering as <strong>{activeNames[0]}</strong>. Add lenses or skills from the chat box below.</> : <>Comparing <strong>{activeNames.join(", ")}</strong>. Adjust lenses in the chat box below.</>}</p>
            </div>
            <div className="suggest-grid">
              {(window.CHAT_SUGGESTIONS || []).slice(0, 2).map(cat => (
                <div key={cat.title} className="suggest-cat">
                  <div className="sc-h"><span className="sc-i" style={{ background: cat.bg, color: cat.color }}><IcoC name={cat.icon} size={15} /></span><span className="sc-t" style={{ color: cat.color }}>{cat.title}</span></div>
                  {cat.items.map(q => <button key={q} className="suggest-btn" onClick={() => send(q)}>{q}</button>)}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {groups.map((gr, gi) => {
              if (gr.k === "u") return <div className="msg-user" key={gr.m.id}><div className="b">{gr.m.content}</div></div>;
              if (gr.k === "act") { const r = gr.m.result; return (
                <div className="action-card" key={gr.m.id}>
                  <div className="ac-h"><span className="ac-i"><IcoC name={r.icon} size={15} /></span><span className="ac-t">{r.title}</span><span className="ac-tag">Done</span></div>
                  <div className="ac-b">{r.body}</div>
                  {r.items && <div className="ac-items">{r.items.map((it, k) => <div className="ac-item" key={k}><span className="ac-dot2" /> {it}</div>)}</div>}
                  <button className="btn sm soft" style={{ marginTop: 4 }} onClick={() => onNav(r.to)}><IcoC name="ArrowRight" size={13} /> {r.cta}</button>
                </div>
              ); }
              if (gr.k === "fk") { const f = gr.m.fork; return (
                <div className={`fork-card ${gr.m.undone ? "undone" : ""}`} key={gr.m.id}>
                  <div className="fork-h"><span className="fork-i"><IcoC name="GitBranch" size={15} /></span><div><div className="fork-t">{gr.m.undone ? "Fork undone" : "I forked your plan"}<span className="ac-tag" style={{ marginLeft: 8 }}>{gr.m.undone ? "reverted" : "auto"}</span></div><div className="fork-s">{gr.m.undone ? "Your plan is back to how it was — nothing lost." : "Your plan is a recommendation, not a rule. I detected the best fit and personalized it for you."}</div></div></div>
                  {!gr.m.undone && (
                    <>
                      <div className="fork-applied">
                        <div className="fork-opt-h"><span className="fork-opt-i"><IcoC name={f.icon} size={14} /></span><span className="fork-opt-n">{f.title}</span><span className="fork-opt-e">{f.estimate}</span></div>
                        <div className="fork-why"><IcoC name="Sparkles" size={12} /> {f.reason}</div>
                        <div className="fork-opt-o">{f.objective}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <button className="btn sm soft" onClick={() => onNav("plan")}><IcoC name="ArrowRight" size={13} /> View in plan</button>
                        <button className="btn sm ghost" onClick={() => undoFork(gr.m.id, gr.m.prev)}><IcoC name="Undo2" size={13} /> Undo</button>
                      </div>
                    </>
                  )}
                </div>
              ); }
              return (
                <div className="msg-adv-row" key={gi}>
                  {gr.g.map(m => { const a = HC.advisorById(m.personaId); return (
                    <div className="msg-adv" key={m.id} style={{ borderTopColor: a.color }}>
                      <div className="ma-h"><div className="ma-i" style={{ background: a.color }}><IcoC name={a.icon} size={14} color="#fff" /></div><div><div className="ma-n">{m.personaName || a.name}</div><div className="ma-r">{a.role}</div></div></div>
                      <div className="ma-b" dangerouslySetInnerHTML={{ __html: HC.boldMd(m.content) }} />
                    </div>
                  ); })}
                </div>
              );
            })}
            {busy && (
              <div className="msg-adv-row">
                <div className="msg-adv" style={{ borderTopColor: "var(--primary)" }}>
                  <div className="ma-h"><div className="ma-i" style={{ background: "var(--primary)" }}><IcoC name="Loader" size={14} color="#fff" className="spin" /></div><div><div className="ma-n">Your advisors</div><div className="ma-r">thinking…</div></div></div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Ask about ${current.title.toLowerCase()}…`} />
          <div className="ci-row">
            <div className="composer-tools" ref={toolsRef}>
              {/* attach */}
              <button className="composer-btn icon-only" title="Attach a file"><IcoC name="Paperclip" size={16} /></button>

              {/* personas with individual on/off toggles */}
              <div style={{ position: "relative" }}>
                <button className={`composer-btn ${pop === "personas" ? "on" : ""}`} onClick={() => setPop(p => p === "personas" ? null : "personas")} title="Choose advisor lenses">
                  <IcoC name="Users" size={15} /> Personas <span className="cb-count">{activeCount}</span>
                </button>
                {pop === "personas" && (
                  <div className="composer-pop">
                    <div className="composer-pop-h"><IcoC name="Users" size={12} /> Advisor lenses</div>
                    <div className="composer-pop-note">{mode === "single" ? "Single mode: one lens replies — turning one on turns the others off." : "Multiple mode: turn on up to 3 lenses to compare."}</div>
                    <div className="persona-list">
                      {advisors.map(a => {
                        const on = active.includes(a.id);
                        const lockOff = mode === "multiple" && !on && active.length >= 3;
                        return (
                          <div key={a.id} className={`persona-pick ${on ? "on" : ""}`}>
                            <span className="pp-av" style={{ background: a.color }}><IcoC name={a.icon} size={14} color="#fff" /></span>
                            <span style={{ flex: 1, minWidth: 0 }}><span className="pp-n" style={{ display: "block" }}>{a.name}</span><span className="pp-r">{a.summary}</span></span>
                            <button className={`pp-switch ${on ? "on" : ""} ${lockOff ? "disabled" : ""}`} disabled={lockOff} onClick={() => pickPersona(a.id)} title={on ? "On" : "Off"} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* skills */}
              <div style={{ position: "relative" }}>
                <button className={`composer-btn ${pop === "skills" ? "on" : ""}`} onClick={() => setPop(p => p === "skills" ? null : "skills")} title="Attach a skill">
                  <IcoC name="Sparkles" size={15} /> Skill
                </button>
                {pop === "skills" && (
                  <div className="composer-pop">
                    <div className="composer-pop-h"><IcoC name="Sparkles" size={12} /> Run a skill</div>
                    <div className="composer-pop-note">Skills do the work — they produce a tool in your Workspace, a draft in Documents, or an answer here.</div>
                    <div className="skill-list">
                      {SKILLS.map(s => (
                        <button key={s.id} className="skill-card" onClick={() => runSkill(s)}>
                          <span className="sk-i"><IcoC name={s.icon} size={15} /></span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="sk-n" style={{ display: "block" }}>{s.name}</span>
                            <span className="sk-d">{s.blurb}</span>
                            <span className="sk-to"><IcoC name={s.to === "documents" ? "FileText" : "LayoutDashboard"} size={10} /> → {s.to}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* single / multiple toggle */}
              <div className="mode-seg" role="tablist" title="How many advisor lenses reply">
                <button className={mode === "single" ? "on" : ""} onClick={setSingle}><IcoC name="User" size={13} /> Single</button>
                <button className={mode === "multiple" ? "on" : ""} onClick={setMulti}><IcoC name="Users" size={13} /> Multiple</button>
              </div>
            </div>

            <button className="btn primary sm" disabled={!input.trim() || busy} onClick={() => send()}><IcoC name="Send" size={14} color="#fff" /> Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CoachChatView = CoachChatView;
