/* coach-skills.jsx — Skills library (Chen's specialized-LLM skills).
   Browse / filter / enable / run / create skills. Runnable skills build into
   Workspace or Documents via window.CoachActions; others open in Chat.
   Exports window.CoachSkills. Shares scope; uses window.Icon + coachHelpers.
*/

const { useState: useSK, useEffect: useEK } = React;
const IcoK = window.Icon;

const SK_EN_KEY = "phd-coach-skills-enabled-v1";
const SK_CUSTOM_KEY = "phd-coach-skills-custom-v1";
const skLoad = (k, d) => { try { const r = localStorage.getItem(k); return r != null ? JSON.parse(r) : d; } catch (e) { return d; } };
const skSave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

// run handlers for runnable skills — write into the real stores
function runSkill(id, roadmap) {
  const A = window.CoachActions; if (!A) return null;
  const cur = roadmap?.steps?.find(s => s.status === "current") || roadmap?.steps?.find(s => s.status === "redo") || roadmap?.steps?.[0] || { title: "your work", objective: "", subtasks: [] };
  switch (id) {
    case "todo": {
      const tasks = (cur.subtasks && cur.subtasks.length ? cur.subtasks.slice(0, 6) : ["Define the goal", "Break into 3 actions", "Schedule the first"]);
      A.addWidget("kanban", tasks); return { to: "workspace", msg: `Task Board added to Workspace (${tasks.length} tasks)` };
    }
    case "lit-gap": {
      A.addWidget("reading-queue", ["Most-cited paper in your area", "A recent review (last 2 yrs)", "Closest methods paper to your design", "A strong counter-argument to your thesis"]);
      return { to: "workspace", msg: "Reading plan added to Workspace" };
    }
    case "citation": {
      A.addWidget("bibliography", ["Smith & Lee (2023) — seminal framework", "Okafor et al. (2024) — recent review", "Chen (2022) — methods reference"]);
      return { to: "workspace", msg: "Citations added to Workspace bibliography" };
    }
    case "reviewer2": {
      A.addWidget("reviewer-2"); return { to: "workspace", msg: "Reviewer 2 critic added to Workspace" };
    }
    case "outline": {
      A.createDoc("thesis-chapter", `Chapter outline — ${cur.title}`, {
        "s-0": "Opening: the question this chapter answers and why it matters.",
        "s-1": "Background / prior work this chapter builds on.",
        "s-2": "Core argument or method — the spine of the chapter.",
        "s-3": "Evidence, results, or analysis.",
        "s-4": "What it means + bridge to the next chapter."
      });
      return { to: "documents", msg: "Chapter outline drafted in Documents" };
    }
    case "meeting": {
      A.createDoc("meeting-prep", "Advisor Meeting Prep — this week", {
        agenda: `1. Progress on ${cur.title}\n2. Open questions\n3. Decisions I need`,
        progress: `Currently working on “${cur.title}.” ${cur.objective}`,
        blockers: "• (Name anything slowing you down)",
        decisions: "• (What do you need decided or approved?)"
      });
      return { to: "documents", msg: "Meeting prep drafted in Documents" };
    }
    case "idp": {
      A.createDoc("idp", "My Individual Development Plan", {
        goals: `Near-term focus: ${cur.title}. ${cur.objective}\n\n1-year goal: …\n3-year goal: …`,
        skills: "Methods / technical: …\nWriting & communication: …\nProfessional (teaching, networking): …",
        milestones: (roadmap?.steps || []).filter(s => s.gate).map(s => `• ${s.title} — ${s.estimate}`).join("\n") || "• (Your gate milestones will list here)",
        mentoring: "Primary advisor: …\nCommittee / additional mentors: …\nMeeting cadence: …",
        career: "Target path (academic / industry / other): …\nWhat I need to get there: …",
        review: "Revisit this plan with my advisor every: (e.g. each semester)"
      });
      return { to: "documents", msg: "Individual Development Plan drafted in Documents" };
    }
    case "progress": {
      const steps = roadmap?.steps || [];
      const done = steps.filter(s => s.status === "done");
      const pct = steps.length ? Math.round((done.length / steps.length) * 100) : 0;
      const next = steps.find(s => s.status !== "done");
      A.createDoc("progress-report", "Progress Report", {
        summary: `${pct}% of the plan complete (${done.length}/${steps.length} milestones). Currently on “${cur.title}.”`,
        completed: done.length ? done.map(s => `• ${s.title}`).join("\n") : "• (Nothing marked complete yet)",
        current: `${cur.title} — ${cur.objective}`,
        blockers: "• (List anything blocking progress)",
        next: next ? `• ${next.title} (${next.estimate})` : "• Final defense / submission",
        asks: "• (What do you need from your committee?)"
      });
      return { to: "documents", msg: "Progress report generated in Documents" };
    }
    default: return null;
  }
}

function CreateSkillModal({ onClose, onCreate }) {
  const [name, setName] = useSK("");
  const [desc, setDesc] = useSK("");
  const [cat, setCat] = useSK("research");
  const [output, setOutput] = useSK("chat");
  const cats = (window.SKILL_CATEGORIES || []).filter(c => c.id !== "all");
  const can = name.trim() && desc.trim();
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-skill-title" onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><IcoK name="Wand2" size={18} /></div>
            <div><h2 className="display" id="create-skill-title">Create a skill</h2><p>No code needed. Describe the task in plain words — we'll tune a specialized assistant for it.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IcoK name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="field"><label>Skill name</label><div className="wrap" style={{ paddingLeft: 0 }}>
            <input style={{ paddingLeft: 14 }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Grant Reviewer" /></div></div>
          <div className="field"><label>What should it do?</label>
            <textarea className="modal-textarea" style={{ minHeight: 80 }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Read my draft like an NSF panelist and flag what would lose points." /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Category</label><div className="wrap" style={{ paddingLeft: 0 }}>
              <select style={{ paddingLeft: 14 }} value={cat} onChange={e => setCat(e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div></div>
            <div className="field"><label>Where does it output?</label><div className="wrap" style={{ paddingLeft: 0 }}>
              <select style={{ paddingLeft: 14 }} value={output} onChange={e => setOutput(e.target.value)}>
                <option value="chat">Chat reply</option><option value="workspace">Workspace widget</option><option value="documents">Document draft</option>
              </select></div></div>
          </div>
        </div>
        <div className="modal-f">
          <span style={{ fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}><IcoK name="Sparkles" size={12} /> Built on Chen's skills system</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!can} onClick={() => onCreate({ id: "custom-" + Date.now(), name: name.trim(), desc: desc.trim(), cat, output, icon: "Wand2", model: "Custom-LLM", custom: true })}>
              <IcoK name="Plus" size={14} color="#fff" /> Create skill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachSkills({ roadmap, onNav }) {
  const base = window.SKILL_LIBRARY || [];
  const cats = window.SKILL_CATEGORIES || [];
  const [custom, setCustom] = useSK(() => skLoad(SK_CUSTOM_KEY, []));
  const all = [...base, ...custom];
  const [enabled, setEnabled] = useSK(() => {
    const saved = skLoad(SK_EN_KEY, null);
    if (saved) return new Set(saved);
    return new Set(base.map(s => s.id)); // default: all library skills on
  });
  const [q, setQ] = useSK("");
  const [creating, setCreating] = useSK(false);
  const [toast, setToast] = useSK("");
  // Sections start closed — the page opens calm; expand only what you need.
  const [collapsed, setCollapsed] = useSK(() => new Set((window.SKILL_CATEGORIES || []).filter(c => c.id !== "all").map(c => c.id)));

  useEK(() => skSave(SK_EN_KEY, [...enabled]), [enabled]);
  useEK(() => skSave(SK_CUSTOM_KEY, custom), [custom]);
  useEK(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2400); return () => clearTimeout(t); }, [toast]);

  const toggle = (id) => setEnabled(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSection = (id) => setCollapsed(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const searching = q.trim().length > 0;
  const matches = (s) => `${s.name} ${s.desc} ${s.model}`.toLowerCase().includes(q.toLowerCase());
  const featured = base.filter(s => s.featured && enabled.has(s.id)).slice(0, 3);
  // All skills, grouped under their category. Compact rows keep the full
  // library present without a wall of cards.
  const sections = cats.filter(c => c.id !== "all")
    .map(c => ({ ...c, skills: all.filter(s => s.cat === c.id) }))
    .filter(c => c.skills.length > 0);

  const doRun = (s) => {
    if (s.runnable) { const r = runSkill(s.id, roadmap); if (r) { setToast(r.msg); } }
    else { onNav("chat"); }
  };

  const outLabel = (o) => o === "documents" ? "Documents" : o === "workspace" ? "Workspace" : "Chat";
  const outIcon = (o) => o === "documents" ? "FileText" : o === "workspace" ? "LayoutDashboard" : "MessageCircle";

  const Tile = ({ s }) => {
    const on = enabled.has(s.id);
    return (
      <div className={`sk-tile ${on ? "" : "off"} ${s.cat === "critic" ? "critic" : ""}`}>
        <div className="sk-tile-top">
          <span className="sk-tile-i"><IcoK name={s.icon} size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sk-tile-n">{s.name}{s.custom && <span className="sk-custom">custom</span>}</div>
            <div className="sk-tile-model"><IcoK name="Cpu" size={11} /> {s.model}</div>
          </div>
          <button className={`pp-switch ${on ? "on" : ""}`} onClick={() => toggle(s.id)} title={on ? "Enabled" : "Disabled"} />
        </div>
        <div className="sk-tile-d">{s.desc}</div>
        <div className="sk-tile-foot">
          <span className="sk-out"><IcoK name={outIcon(s.output)} size={11} /> → {outLabel(s.output)}</span>
          <button className="btn sm soft" disabled={!on} onClick={() => doRun(s)}>
            {s.runnable ? <><IcoK name="Play" size={12} /> Run</> : <><IcoK name="MessageCircle" size={12} /> Use in chat</>}
          </button>
        </div>
      </div>
    );
  };

  const searchResults = searching ? all.filter(matches) : [];

  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 26 }}>Skills</h1>
        <div className="sub">Specialized assistants that do the work. Turn them on, run them, or use them in Chat.</div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <div className="field" data-ptour="sk-search" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <div className="wrap"><span className="fi"><IcoK name="Search" size={15} /></span>
            <input placeholder="Search skills…" aria-label="Search skills" value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        <button className="btn primary" data-ptour="sk-create" onClick={() => setCreating(true)}><IcoK name="Plus" size={15} color="#fff" /> Create a skill</button>
      </div>

      {searching ? (
        <>
          <div className="section-label"><span className="ic"><IcoK name="Search" size={13} /></span> Results · {searchResults.length}</div>
          <div className="sk-grid-3">{searchResults.map(s => <Tile key={s.id} s={s} />)}</div>
          {searchResults.length === 0 && <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 14, padding: "40px 0" }}>No skills match — try a different search.</div>}
        </>
      ) : (
        <>
          {featured.length > 0 && (
            <>
              <div className="section-label"><span className="ic"><IcoK name="Star" size={13} /></span> Suggested for where you are now</div>
              <div className="sk-grid" style={{ marginBottom: 22 }}>
                {featured.map(s => <Tile key={s.id} s={s} />)}
              </div>
            </>
          )}

          {sections.map(c => {
            const isOpen = !collapsed.has(c.id);
            const onCount = c.skills.filter(s => enabled.has(s.id)).length;
            return (
              <div className="sk-sec" key={c.id}>
                <button className="sk-sec-h" onClick={() => toggleSection(c.id)} aria-expanded={isOpen}>
                  <span className="sk-sec-i"><IcoK name={c.icon} size={14} /></span>
                  <span className="sk-sec-t">{c.label}</span>
                  <span className="sk-sec-count">{onCount} of {c.skills.length} on</span>
                  <IcoK name={isOpen ? "ChevronUp" : "ChevronDown"} size={15} />
                </button>
                {isOpen && <div className="sk-grid-3">{c.skills.map(s => <Tile key={s.id} s={s} />)}</div>}
              </div>
            );
          })}
        </>
      )}

      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreate={(s) => { setCustom(p => [...p, s]); setEnabled(p => new Set(p).add(s.id)); setCreating(false); setToast(`“${s.name}” created`); }} />}
      {toast && <div className="toast"><IcoK name="CheckCircle2" size={15} /> {toast}</div>}
    </div>
  );
}

window.CoachSkills = CoachSkills;
