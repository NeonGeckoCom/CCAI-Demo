/* coach-app.jsx — PhD Navigator (v2.1, wireframe-feedback round)
   Onboarding (confirm-milestones flow), Rail, Dashboard (timeline-first).
   Reuses window.RoadmapEngine + window.renderTool/hasTool.
*/

const { useState, useEffect, useMemo, useRef } = React;
const Icon = window.Icon;
const RE = window.RoadmapEngine;

const RM_KEY = "phd-coach-roadmap-v1";
const TASK_KEY = "phd-coach-tasks-v1";
const THEME_KEY = "phd-coach-theme";
const ONBOARDING_DOC_STORE = "phd-coach-docs-v1";

const loadJSON = (k, d) => { try { const r = localStorage.getItem(k); return r != null ? JSON.parse(r) : d; } catch (e) { return d; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const boldMd = (s) => (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const readFileAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });
const extOfName = (name) => (String(name || "").split(".").pop() || "").toLowerCase();

async function materialToDocumentProject(material) {
  const now = Date.now();
  const id = `onb-${now}-${Math.random().toString(36).slice(2, 7)}`;
  if (material.kind === "text" && (material.text || "").trim()) {
    const name = material.name || "Pasted requirement";
    return {
      id, name, uploaded: true, kind: "text", source: "Onboarding materials",
      fileName: `${name.replace(/\.[^.]+$/, "")}.txt`,
      content: material.text,
      createdAt: now,
      onboardingKey: `text:${name}:${material.text.length}`
    };
  }

  if (!material.file) return null;
  const file = material.file;
  const ext = extOfName(file.name);
  const base = {
    id,
    name: file.name.replace(/\.[^.]+$/, ""),
    uploaded: true,
    fileName: file.name,
    mime: file.type || material.type || "",
    size: file.size || material.size || 0,
    source: "Onboarding materials",
    createdAt: now,
    onboardingKey: `file:${file.name}:${file.size || 0}:${file.lastModified || 0}`
  };

  if (["pdf", "doc", "docx", "xlsx", "pptx"].includes(ext)) {
    const dataUrl = await readFileAs(file, "readAsDataURL");
    const kind = ext === "pdf" ? "pdf" : ext === "xlsx" ? "xlsx" : ext === "pptx" ? "pptx" : "docx";
    return {
      ...base,
      kind,
      dataUrl: ext === "pdf" ? dataUrl : undefined,
      rawDataUrl: dataUrl,
      content: ""
    };
  }

  const text = await readFileAs(file, "readAsText");
  return { ...base, kind: "text", content: String(text || "") };
}

async function persistOnboardingMaterialsToDocuments(materials) {
  const projects = [];
  for (const material of materials || []) {
    try {
      const project = await materialToDocumentProject(material);
      if (project) projects.push(project);
    } catch (e) {}
  }
  if (!projects.length) return;

  const store = loadJSON(ONBOARDING_DOC_STORE, { projects: {}, activeId: null });
  const existingKeys = new Set(Object.values(store.projects || {}).map(project => project.onboardingKey).filter(Boolean));
  let firstAddedId = null;
  for (const project of projects) {
    if (project.onboardingKey && existingKeys.has(project.onboardingKey)) continue;
    store.projects[project.id] = project;
    if (!firstAddedId) firstAddedId = project.id;
    existingKeys.add(project.onboardingKey);
  }
  if (!store.activeId && firstAddedId) store.activeId = firstAddedId;
  saveJSON(ONBOARDING_DOC_STORE, store);
}

// Encouraging, phase-specific tips
const PHASE_TIPS = {
  Start: "Small starts compound. Spend 20 minutes today just skimming your handbook — that's a real win.",
  Topic: "A good question beats a perfect one. Write three rough versions; your chair will help you choose.",
  Literature: "Stop reading when you can recite your gap from memory. Two more papers won't change the committee's mind.",
  Proposal: "Your proposal is a promise, not a contract. Aim for defensible, not flawless.",
  Methods: "Submit the protocol you can defend, not the one you wish you had. Amendments are fast.",
  Data: "Log every deviation as you go. The dataset you cite at defense is the one you can reproduce.",
  Writing: "Don't polish — produce. The bad first draft is the only one your committee can react to.",
  Defense: "Most defenses are won in the first 3 minutes. Open with the question, the gap, the headline finding.",
  Submission: "Reserve a full week for formatting alone. Graduate schools reject for margins faster than for content.",
  Recovery: "Setbacks aren't failure — they're data. You've got a plan now; take the next small step."
};

const advisorById = (id) => (window.ADVISORS || []).find(a => a.id === id) || { name: "Advisor", role: "", color: "#D9774B", icon: "User" };

// Autocomplete pools (BACKEND: institution/program typeahead API)
const INSTITUTIONS = window.UNIVERSITY_OPTIONS || ["University of Colorado Boulder", "University of Colorado Denver", "Colorado State University", "University of Michigan", "University of Washington", "University of California, Berkeley", "Stanford University", "Massachusetts Institute of Technology", "Georgia Institute of Technology", "University of Texas at Austin"];
const PROGRAMS = window.PROGRAM_OPTIONS || ["PhD, Information Science", "PhD, Computer Science", "PhD, Neuroscience", "PhD, Psychology", "PhD, Sociology", "PhD, Education", "PhD, Mechanical Engineering", "PhD, Biology", "PhD, Economics", "PhD, English"];

// ============================================================================
// ONBOARDING
// ============================================================================
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [program, setProgram] = useState("PhD, Information Science");
  const [institution, setInstitution] = useState("University of Colorado Boulder");
  const [materials, setMaterials] = useState([]);   // {kind:'file'|'text', name, text?, file?}
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);       // raw discovery result
  const [items, setItems] = useState([]);          // editable milestone list
  const [editingIdx, setEditingIdx] = useState(-1);
  const [startPosition, setStartPosition] = useState("coursework");
  const [writeStyle, setWriteStyle] = useState("unsure");
  const [publish, setPublish] = useState("unsure");
  const [densityChoice, setDensityChoice] = useState("balanced"); // everything | balanced | minimal
  const [modelMode, setModelMode] = useState("cloud");            // cloud | private
  const [finishing, setFinishing] = useState(false);

  const hasUploadedFiles = materials.some(m => m.kind === "file" && m.file);
  const readableMaterialCount = materials.filter(m => (m.text || "").trim()).length;
  const searchStatus = hasUploadedFiles
    ? "Parsing your uploaded documents"
    : readableMaterialCount > 0
      ? "Parsing your pasted materials"
      : materials.length > 0
        ? "Checking your materials and public sources"
        : "Searching public program pages";
  const sourceNote = found?.discoveryMode === "documents"
    ? "Parsed from your uploaded or pasted materials - please verify"
    : found?.discoveryMode === "web"
      ? "Sourced from public web search - please verify"
      : "Estimated from the built-in PhD milestone template - please verify";

  const search = () => {
    setSearching(true); setFound(null);
    RE.discoverDeliverables({ program, institution, materials }).then(res => {
      setFound(res);
      setItems(res.deliverables.map(d => ({ ...d, confirmed: false })));
      setSearching(false); setStep(2);
    }).catch(() => {
      const res = RE.genericDeliverables ? RE.genericDeliverables(program) : { degree: program || "PhD program", deliverables: [] };
      res.institution = institution || "your institution";
      res.discoveryMode = "fallback";
      setFound(res);
      setItems(res.deliverables.map(d => ({ ...d, confirmed: false })));
      setSearching(false); setStep(2);
    });
  };

  const addFiles = (fileList) => {
    const adds = [...fileList].map(f => ({
      kind: "file",
      name: f.name,
      type: f.type || "",
      size: f.size || 0,
      file: f
    }));
    if (adds.length) setMaterials(p => [...p, ...adds]);
  };
  const addPaste = () => {
    const t = pasteText.trim(); if (!t) return;
    const name = t.length > 46 ? t.slice(0, 46) + "…" : t;
    setMaterials(p => [...p, { kind: "text", name, text: t }]);
    setPasteText(""); setPasteOpen(false);
  };
  const removeMaterial = (i) => setMaterials(p => p.filter((_, j) => j !== i));

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const deliverables = { ...found, deliverables: items.map(({ confirmed, ...d }) => d) };
    const rm = RE.generateRoadmap({
      program: { name: program, institution }, deliverables, startPosition,
      workflow: { writeStyle, publish: publish === "yes" }
    });
    rm.materials = materials.map(({ file, ...material }) => material);
    // Map the density choice → {density, revealAll}; pass prefs up to CoachRoot.
    const prefs = {
      density: densityChoice === "minimal" ? "focused" : "full",
      revealAll: densityChoice === "everything",
      modelMode,
      institution,
      program
    };
    try { await persistOnboardingMaterialsToDocuments(materials); } catch (e) {}
    onComplete(rm, prefs);
  };

  const confirmItem = (i) => setItems(p => p.map((d, j) => j === i ? { ...d, confirmed: !d.confirmed } : d));
  const removeItem = (i) => setItems(p => p.filter((_, j) => j !== i));
  const editItem = (i, name) => setItems(p => p.map((d, j) => j === i ? { ...d, name } : d));
  const uploadHandbook = () => {
    setStep(1);
    setTimeout(() => fileRef.current?.click(), 0);
  };

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-logo"><Icon name="Compass" size={24} color="#fff" /></div>
        <div className="onb-dots">{[0,1,2,3,4,5].map(i => <span key={i} className={i <= step ? "on" : ""} />)}</div>

        {step === 0 && (
          <>
            <h1 className="display">Tell us your program.</h1>
            <p className="lead">We'll look for public requirements — handbooks, program pages, graduate-school rules — and ask you to confirm what we find.</p>
            <div className="field">
              <label>Your program</label>
              <window.AcademicCombo
                value={program}
                onChange={setProgram}
                options={PROGRAMS}
                placeholder="e.g. PhD, Neuroscience"
                icon="GraduationCap"
              />
            </div>
            <div className="field">
              <label>Institution</label>
              <window.AcademicCombo
                value={institution}
                onChange={setInstitution}
                options={INSTITUTIONS}
                placeholder="Choose your institution"
                icon="Building2"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn primary lg" onClick={() => setStep(1)} disabled={!program.trim()}>
                Continue <Icon name="ArrowRight" size={15} color="#fff" />
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="display">Add what you already have.</h1>
            <p className="lead">Requirements often arrive as a pile of emails and PDFs. Drop anything here — handbooks, advisor emails, timelines, forms — or paste text straight from an email. We'll fold it all into your plan. You can always add more later.</p>

            <input ref={fileRef} type="file" multiple style={{ display: "none" }}
              onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => fileRef.current?.click()}>
                <Icon name="Upload" size={14} /> Upload files
              </button>
              <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setPasteOpen(o => !o)}>
                <Icon name="ClipboardPaste" size={14} /> Paste text
              </button>
            </div>

            {pasteOpen && (
              <div style={{ marginBottom: 12 }}>
                <textarea className="modal-textarea" style={{ minHeight: 90 }} value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste an email, a list of requirements, deadlines…" autoFocus />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button className="btn sm soft" onClick={addPaste} disabled={!pasteText.trim()}><Icon name="Plus" size={13} /> Add text</button>
                </div>
              </div>
            )}

            {materials.length > 0 && (
              <div className="mat-list">
                {materials.map((m, i) => (
                  <div key={i} className="mat-row">
                    <span className="mat-ico"><Icon name={m.kind === "file" ? "FileText" : "AlignLeft"} size={14} /></span>
                    <span className="mat-name">{m.name}</span>
                    <span className="mat-kind">{m.kind === "file" ? "document" : "pasted text"}</span>
                    <button className="dv-act danger" onClick={() => removeMaterial(i)} title="Remove"><Icon name="X" size={13} /></button>
                  </div>
                ))}
              </div>
            )}

            {searching && <div className="search-state"><Icon name="Search" size={16} className="spin" /> {searchStatus} for <strong>&nbsp;{program}&nbsp;</strong> requirements…</div>}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
              <button className="btn ghost" onClick={() => setStep(0)} disabled={searching}><Icon name="ArrowLeft" size={14} /> Back</button>
              <button className="btn primary lg" onClick={search} disabled={searching}>
                {searching ? <><Icon name="Search" size={15} color="#fff" /> Searching…</>
                  : materials.length > 0 ? <>Continue with {materials.length} item{materials.length === 1 ? "" : "s"} <Icon name="ArrowRight" size={15} color="#fff" /></>
                  : <>Skip for now <Icon name="ArrowRight" size={15} color="#fff" /></>}
              </button>
            </div>
          </>
        )}

        {step === 2 && found && (
          <>
            <h1 className="display">We found these possible milestones.</h1>
            <p className="lead">Please confirm each one for <strong>{found.degree}</strong> at {found.institution}{materials.length > 0 ? <> — cross-checked against your <strong>{materials.length} uploaded item{materials.length === 1 ? "" : "s"}</strong></> : ""} — or edit and remove what doesn't match. Your graduate office is always the final word.</p>
            <div className="deliv-list">
              {items.map((d, i) => (
                <div key={i} className={`deliv ${d.confirmed ? "confirmed" : ""}`}>
                  <button className={`dv-confirm ${d.confirmed ? "on" : ""}`} onClick={() => confirmItem(i)} title={d.confirmed ? "Confirmed" : "Confirm"}>
                    <Icon name="Check" size={13} color={d.confirmed ? "#fff" : undefined} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    {editingIdx === i ? (
                      <input className="dv-edit-input" value={d.name} autoFocus
                        onChange={e => editItem(i, e.target.value)}
                        onBlur={() => setEditingIdx(-1)}
                        onKeyDown={e => e.key === "Enter" && setEditingIdx(-1)} />
                    ) : (
                      <div className="dv-n">{d.name}</div>
                    )}
                    <button className="dv-source" onClick={e => e.preventDefault()} title={`Source: ${d.source}`}>
                      <Icon name="ExternalLink" size={10} /> {d.source}
                    </button>
                  </div>
                  <div className="dv-actions">
                    <span className="dv-w">{d.when}</span>
                    <button className="dv-act" onClick={() => setEditingIdx(editingIdx === i ? -1 : i)} title="Edit"><Icon name="Pencil" size={13} /></button>
                    <button className="dv-act danger" onClick={() => removeItem(i)} title="Remove"><Icon name="X" size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            {materials.length > 0 ? (
              <div className="search-state" style={{ background: "var(--sage-soft)", color: "var(--sage)" }}>
                <Icon name="FileCheck" size={16} /> Using your uploaded or pasted materials to shape the plan.
              </div>
            ) : (
              <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={uploadHandbook}>
                <Icon name="Upload" size={14} /> Add handbook or materials
              </button>
            )}
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
              <Icon name={found.discoveryMode === "documents" ? "FileText" : "Globe"} size={12} /> {sourceNote}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
              <button className="btn ghost" onClick={() => setStep(1)}><Icon name="ArrowLeft" size={14} /> Back</button>
              <button className="btn primary lg" onClick={() => setStep(3)} disabled={items.length === 0}>
                Confirm & continue <Icon name="ArrowRight" size={15} color="#fff" />
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="display">Where are you today?</h1>
            <p className="lead">Your plan starts from your real position. Not sure is a fine answer — you can change all of this later.</p>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 8 }}>Current stage</label>
            <div className="opt-grid" style={{ marginBottom: 18 }}>
              {RE.START_POSITIONS.map(p => (
                <button key={p.id} className={`opt ${startPosition === p.id ? "sel" : ""}`} onClick={() => setStartPosition(p.id)}>
                  <span className="dot" /> {p.label}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 8 }}>When do you like to write?</label>
            <div className="opt-grid three" style={{ marginBottom: 18 }}>
              <button className={`opt ${writeStyle === "as-you-go" ? "sel" : ""}`} onClick={() => setWriteStyle("as-you-go")}><span className="dot" /> As I go</button>
              <button className={`opt ${writeStyle === "at-end" ? "sel" : ""}`} onClick={() => setWriteStyle("at-end")}><span className="dot" /> Mostly at the end</button>
              <button className={`opt ${writeStyle === "unsure" ? "sel" : ""}`} onClick={() => setWriteStyle("unsure")}><span className="dot" /> Not sure yet</button>
            </div>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 8 }}>Aiming to publish along the way?</label>
            <div className="opt-grid three">
              <button className={`opt ${publish === "yes" ? "sel" : ""}`} onClick={() => setPublish("yes")}><span className="dot" /> Yes, target papers</button>
              <button className={`opt ${publish === "no" ? "sel" : ""}`} onClick={() => setPublish("no")}><span className="dot" /> Dissertation-first</button>
              <button className={`opt ${publish === "unsure" ? "sel" : ""}`} onClick={() => setPublish("unsure")}><span className="dot" /> Not sure yet</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
              <button className="btn ghost" onClick={() => setStep(2)}><Icon name="ArrowLeft" size={14} /> Back</button>
              <button className="btn primary lg" onClick={() => setStep(4)}>Continue <Icon name="ArrowRight" size={15} color="#fff" /></button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="display">How much do you want to see?</h1>
            <p className="lead">PhD Navigator has a lot under the hood. Choose how much shows up at once — you can change this anytime in Settings.</p>
            <div className="onb-choice">
              <button className={`onb-choice-card ${densityChoice === "everything" ? "sel" : ""}`} onClick={() => setDensityChoice("everything")}>
                <span className="occ-ico"><Icon name="LayoutDashboard" size={18} /></span>
                <span className="occ-t">Show me everything</span>
                <span className="occ-d">Full dashboard and every tool, advisor, and skill available right away.</span>
              </button>
              <button className={`onb-choice-card ${densityChoice === "balanced" ? "sel" : ""}`} onClick={() => setDensityChoice("balanced")}>
                <span className="occ-ico"><Icon name="Scale" size={18} /></span>
                <span className="occ-t">Balanced <span className="occ-rec">recommended</span></span>
                <span className="occ-d">Full layout, but advanced features unlock gradually as you use the app.</span>
              </button>
              <button className={`onb-choice-card ${densityChoice === "minimal" ? "sel" : ""}`} onClick={() => setDensityChoice("minimal")}>
                <span className="occ-ico"><Icon name="Minimize2" size={18} /></span>
                <span className="occ-t">Just what I need</span>
                <span className="occ-d">A calm home with one clear next action; features unlock as you go.</span>
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
              <button className="btn ghost" onClick={() => setStep(3)}><Icon name="ArrowLeft" size={14} /> Back</button>
              <button className="btn primary lg" onClick={() => setStep(5)}>Continue <Icon name="ArrowRight" size={15} color="#fff" /></button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className="display">Cloud or private models?</h1>
            <p className="lead">Your advisors are powered by AI. Choose where that runs — you can switch later in Settings.</p>
            <div className="onb-choice">
              <button className={`onb-choice-card ${modelMode === "cloud" ? "sel" : ""}`} onClick={() => setModelMode("cloud")}>
                <span className="occ-ico"><Icon name="Cloud" size={18} /></span>
                <span className="occ-t">Cloud models</span>
                <span className="occ-d">Best accuracy and the fullest capabilities. Your inputs are processed in the cloud.</span>
              </button>
              <button className={`onb-choice-card ${modelMode === "private" ? "sel" : ""}`} onClick={() => setModelMode("private")}>
                <span className="occ-ico"><Icon name="ShieldCheck" size={18} /></span>
                <span className="occ-t">On-device &amp; private</span>
                <span className="occ-d">Runs locally on your machine — fully private, with slightly lower accuracy.</span>
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
              <Icon name="Info" size={12} /> You can change models, density, and more anytime in Settings.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
              <button className="btn ghost" onClick={() => setStep(4)}><Icon name="ArrowLeft" size={14} /> Back</button>
              <button className="btn primary lg" onClick={finish} disabled={finishing}>
                <Icon name={finishing ? "Loader" : "Sparkles"} size={15} color="#fff" className={finishing ? "spin" : ""} />
                {finishing ? "Saving materials..." : "Build my plan"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// RAIL (sidebar nav)
// ============================================================================
function Rail({ view, onNav, user, skillsUnlocked = true, onSignOut }) {
  const items = [
    { id: "home", label: "Home", icon: "Home" },
    { id: "plan", label: "My Plan", icon: "Map", badge: "live" },
    { id: "chat", label: "Chat", icon: "MessageCircle" },
    { id: "skills", label: "Skills", icon: "Sparkles" },
    { id: "insights", label: "Insights", icon: "Lightbulb" },
    { id: "workspace", label: "Workspace", icon: "LayoutDashboard" },
    { id: "documents", label: "Documents", icon: "FileText" },
    { id: "settings", label: "Settings", icon: "Settings" }
  ].filter(it => it.id !== "skills" || skillsUnlocked); // Skills stays hidden until unlocked in chat
  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="rail-mark"><Icon name="Compass" size={20} color="#fff" /></div>
        <div><div className="t1">PhD Navigator</div><div className="t2">know the path ahead</div></div>
      </div>
      <div className="rail-label">Workspace</div>
      {items.map(it => (
        <button key={it.id} data-tour={it.id} className={`rail-item ${view === it.id ? "active" : ""}`} onClick={() => onNav(it.id)}>
          <Icon name={it.icon} size={18} /> <span>{it.label}</span>
          {it.badge && <span className="badge">{it.badge}</span>}
        </button>
      ))}
      <div className="rail-spacer" />
      <div className="rail-user">
        <div className="av" onClick={() => onNav("settings")}>{user.initials}</div>
        <div className="rail-user-id" onClick={() => onNav("settings")}><div className="nm">{user.name}</div><div className="em">{user.email}</div></div>
        {onSignOut && <button className="rail-signout" title="Sign out" aria-label="Sign out" onClick={(e) => { e.stopPropagation(); onSignOut(); }}><Icon name="LogOut" size={16} /></button>}
      </div>
    </aside>
  );
}

// ============================================================================
// HORIZONTAL TIMELINE — the single source of "where am I"
// ============================================================================
function Timeline({ steps, onSelect }) {
  return (
    <div className="tl">
      {steps.map((s, i) => {
        const cls = s.status === "done" ? "done" : (s.status === "current" || s.status === "redo") ? "current"
          : s.recovery ? "recovery" : "locked";
        return (
          <button key={s.id} className={`tl-item ${cls}`} onClick={() => onSelect(s, i)} title={`${s.title} · ${s.estimate}`}>
            <span className={`tl-dot ${cls} ${s.gate ? "gate" : ""}`}>
              {s.status === "done" ? <Icon name="Check" size={11} color="#fff" />
                : s.recovery ? <Icon name="AlertTriangle" size={10} color="#fff" /> : i + 1}
            </span>
            <span className="tl-label">{s.title}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// DASHBOARD HOME — four blocks: greeting → timeline → action card → sidebar
// ============================================================================
function greetWord() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Dashboard({ roadmap, onNav, onOpenSos, doneTasks, setDoneTasks, activity, onOpenStep, focused }) {
  const steps = roadmap.steps;
  // Focused/minimal mode: trim the timeline to completed + current(+recovery).
  const tlSteps = focused ? steps.filter(s => ["done", "current", "redo"].includes(s.status) || s.recovery) : steps;
  const doneCount = steps.filter(s => s.status === "done").length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const current = steps.find(s => s.status === "current") || steps.find(s => s.status === "redo") || steps[0];
  const curIdx = steps.indexOf(current);
  const fs = RE.computeFeatureState(roadmap, curIdx);
  const liveTools = fs.active.filter(f => window.hasTool(f)).slice(0, 2);
  const tip = PHASE_TIPS[current.phase] || PHASE_TIPS.Start;
  const nextGate = steps.slice(curIdx).find(s => s.gate && s.status !== "done");

  // Gentle accountability: the first thing you committed to on this step but haven't ticked.
  const dts = doneTasks || new Set();
  const pending = (current.subtasks || []).filter(t => !dts.has(`${current.id}::${t}`));
  const nudge = pending[0];
  const reopened = steps.find(s => s.status === "redo" || s.recovery);
  const stuck = stallDays(roadmap, activity);
  const atRisk = stuck >= STALL_DAYS;

  const checkNudge = () => {
    if (!nudge || !setDoneTasks) return;
    setDoneTasks(prev => { const n = new Set(prev); n.add(`${current.id}::${nudge}`); return n; });
  };

  return (
    <div className="page">
      <div className="greeting">
        <h1 className="display">{greetWord()}, {window.MOCK_USER.name.split(" ")[0]}.</h1>
        <div className="sub">
          You're <button className="linkish" onClick={() => onNav("plan")}>{pct}% through your plan</button> — right
          now you're on <button className="linkish" onClick={() => onNav("plan")}>{current.title}</button>.
        </div>
      </div>

      {/* TODAY — one focused next action, to cut cognitive load */}
      <div className={`today ${atRisk ? "at-risk" : ""}`}>
        <div className="today-l">
          <div className="today-eyebrow">
            <Icon name="Sun" size={13} /> Today · {current.title}
            {atRisk && <span className="risk-pill"><Icon name="AlertTriangle" size={11} /> stuck {stuck}d</span>}
          </div>
          {nudge ? (
            <div className="today-action">
              <button className="today-check" onClick={checkNudge} title="Mark done"><span /></button>
              <span className="today-text">{nudge}</span>
            </div>
          ) : (
            <div className="today-action"><Icon name="CheckCircle2" size={16} color="var(--sage)" /> <span className="today-text">All steps here are checked — ready to complete this milestone.</span></div>
          )}
        </div>
        <button className="btn primary" onClick={() => onOpenStep ? onOpenStep(current.id) : onNav("plan")}>
          {nudge ? "Work on this" : "Complete milestone"} <Icon name="ArrowRight" size={15} color="#fff" />
        </button>
      </div>

      <Timeline steps={tlSteps} onSelect={(s) => onOpenStep ? onOpenStep(s.id) : onNav("plan")} />

      {/* Gentle accountability nudge — one, not a guilt machine */}
      {!focused && nudge && (
        <button className="nudge" onClick={() => onNav("plan")}>
          <span className="nudge-ico"><Icon name="Hand" size={15} /></span>
          <span className="nudge-body"><b>Picking up where you left off.</b> You set out to <b>{nudge.toLowerCase()}</b> — want to knock that out today?</span>
          <span className="nudge-go"><Icon name="ArrowRight" size={15} /></span>
        </button>
      )}

      {!focused && <div className="dash">
        <div className="dash-col">
          <div className="where">
            <span className="phase-tag"><Icon name="MapPin" size={12} /> You are here · {current.phase}</span>
            <h2 className="display">{current.title}</h2>
            <p className="obj">{current.objective}</p>
            <div className="where-actions">
              <button className="btn primary" onClick={() => onNav("plan")}><Icon name="ArrowRight" size={15} color="#fff" /> Continue this step</button>
              <button className="btn" onClick={() => onNav("chat")}><Icon name="MessageCircle" size={15} /> Ask a question</button>
            </div>
          </div>

          {/* Recovery, first-class */}
          <div className="recover-card" onClick={onOpenSos}>
            <div className="recover-ico"><Icon name="LifeBuoy" size={20} color="#fff" /></div>
            <div style={{ flex: 1 }}>
              <div className="recover-t">{reopened ? "You're in recovery mode" : "Something go wrong?"}</div>
              <div className="recover-d">{reopened ? "Your plan was re-routed to get you back on track. Open it to see your recovery steps." : "Data rejected, committee change, null result — tell us in plain words and your whole plan re-routes around it."}</div>
            </div>
            <button className="btn" onClick={(e) => { e.stopPropagation(); onOpenSos(); }}><Icon name="Wand2" size={15} /> {reopened ? "Review plan" : "Re-plan"}</button>
          </div>
        </div>

        <div className="dash-col">
          {nextGate && (
            <div className="card card-pad">
              <div className="card-h"><span className="ico"><Icon name="Flag" size={14} /></span> Next checkpoint</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{nextGate.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4 }}>{nextGate.estimate}{nextGate.deliverable ? ` · satisfies: ${nextGate.deliverable}` : ""}</div>
            </div>
          )}

          {liveTools.length > 0 && (
            <div className="card card-pad">
              <div className="card-h"><span className="ico"><Icon name="Wrench" size={14} /></span> Tools for this step</div>
              <div className="qtools">
                {liveTools.map(f => {
                  const feat = RE.feature(f);
                  return (
                    <button key={f} className="qtool" onClick={() => onNav("plan")}>
                      <span className="qt-ico"><Icon name={feat.icon} size={16} /></span>
                      <span className="qt-n">{feat.name}</span>
                      <span className="qt-d">{feat.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tip tip-coach">
            <span className="tip-ico"><Icon name="Lightbulb" size={15} color="#fff" /></span>
            <div className="tip-body"><b>Tip.</b> {tip}</div>
          </div>
        </div>
      </div>}

      {!focused && <button className="sos" onClick={onOpenSos}><Icon name="LifeBuoy" size={15} /> Something came up?</button>}
    </div>
  );
}

window.CoachOnboarding = Onboarding;
window.CoachRail = Rail;
window.CoachDashboard = Dashboard;
// Activity timestamps per milestone → power stall / at-risk detection.
const ACT_KEY = "phd-coach-activity-v1";
// Progressive-disclosure storage keys (shared so every module agrees).
const PREFS_KEY = "phd-coach-prefs-v1";       // { density, revealAll, modelMode }
const ENGAGE_KEY = "phd-coach-engagement-v1"; // { messages, visits }
const UNLOCKS_KEY = "phd-coach-unlocks-v1";   // string[] of unlock ids already shown
const STALL_DAYS = 14; // a current step untouched this long is flagged "at risk"
// Days the current step has gone untouched (falls back to roadmap creation date).
function stallDays(roadmap, activity) {
  if (!roadmap || !roadmap.steps) return 0;
  const cur = roadmap.steps.find(s => s.status === "current") || roadmap.steps.find(s => s.status === "redo");
  if (!cur) return 0;
  const last = (activity && activity[cur.id]) || roadmap.createdAt || Date.now();
  return Math.max(0, Math.floor((Date.now() - last) / 86400000));
}

window.coachHelpers = { RM_KEY, TASK_KEY, THEME_KEY, ACT_KEY, PREFS_KEY, ENGAGE_KEY, UNLOCKS_KEY, STALL_DAYS, loadJSON, saveJSON, boldMd, PHASE_TIPS, advisorById, greetWord, stallDays };
