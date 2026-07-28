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

function normalizeStoredRoadmap(roadmap) {
  if (!roadmap || !Array.isArray(roadmap.steps)) return roadmap;
  const handbookPlan = roadmap.deliverables?.extractionMethod === "llm_direct_plan"
    || roadmap.steps.some(step => step && step.handbookDerived);
  if (!handbookPlan) return roadmap;

  let changed = false;
  const steps = roadmap.steps.map(step => {
    if (!step) return step;
    const handbookStep = step.handbookDerived || (!step.custom && !step.recovery);
    if (!handbookStep || step.gate === true) return step;
    changed = true;
    return { ...step, gate: true, handbookDerived: true };
  });
  return changed ? { ...roadmap, steps } : roadmap;
}

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
const DEFAULT_ONBOARDING_PROGRAM = "PhD, Information Science";
const DEFAULT_ONBOARDING_INSTITUTION = "University of Colorado Boulder";
const ONBOARDING_PLACEHOLDERS = new Set(["string", "undefined", "null", "none", "n/a", "na", "unknown", "choose your program", "select your program", "choose your university", "select your university"]);

const cleanOnboardingValue = (value) => {
  const text = String(value || "").trim();
  if (!text || ONBOARDING_PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
};

function getOnboardingDefaults(profile) {
  const apiUser = (window.CoachAPI && window.CoachAPI.getUser && window.CoachAPI.getUser()) || {};
  const mockUser = window.MOCK_USER || {};
  const prefs = loadJSON(PREFS_KEY, {}) || {};
  const storedRoadmap = loadJSON(RM_KEY, null) || {};
  return {
    program: firstOnboardingDefault(
      DEFAULT_ONBOARDING_PROGRAM,
      profileProgramValue(profile),
      profile?.researchArea,
      prefs.program,
      storedRoadmap.program?.name,
      profileProgramValue(apiUser),
      apiUser.researchArea,
      profileProgramValue(mockUser),
      mockUser.researchArea
    ),
    institution: firstOnboardingDefault(
      DEFAULT_ONBOARDING_INSTITUTION,
      profileInstitutionValue(profile),
      prefs.institution,
      storedRoadmap.program?.institution,
      profileInstitutionValue(apiUser),
      profileInstitutionValue(mockUser)
    )
  };
}
const shouldReplaceOnboardingDefault = (current, fallback) => {
  const clean = cleanOnboardingValue(current);
  return !clean || clean === fallback;
};
const firstOnboardingDefault = (fallback, ...values) => {
  let fallbackCandidate = "";
  const cleaned = values.map(cleanOnboardingValue);
  cleaned.forEach(value => {
    if (value && !fallbackCandidate) fallbackCandidate = value;
  });
  return cleaned.find(value => value && value !== fallback) || fallbackCandidate || fallback;
};
const profileProgramValue = (profile) => {
  if (!profile) return "";
  return profile.program && typeof profile.program === "object" ? profile.program.name : profile.program;
};
const profileInstitutionValue = (profile) => {
  if (!profile) return "";
  if (profile.institution) return profile.institution;
  return profile.program && typeof profile.program === "object" ? profile.program.institution : "";
};

// ============================================================================
// SOURCE-CONFLICT DETECTION
// ----------------------------------------------------------------------------
// When two uploaded/pasted sources disagree (e.g. an advisor email says quals
// are Year 2 but the handbook PDF says Year 3), we surface it so the student
// resolves it before we build the plan.
//
// DATA CONTRACT — the backend discovery response will populate `found.conflicts`
// once wired (it already extracts every file's text server-side). Until then we
// run a light client-side scan over pasted text. Either way the shape is:
//   conflicts: [{
//     id:        string,
//     topic:     string,                     // human label, e.g. "Qualifying exam timing"
//     milestone: string,                     // milestone name this affects (matched to items)
//     field:     "when",                     // which attribute disagrees
//     options:   [{ source: string, value: string }, ...]
//   }]
// ============================================================================
// Value regexes are per-probe so a timing conflict extracts a year/semester and
// a coursework conflict extracts a credit count — never the wrong kind of number.
const CONFLICT_TIME_RE = /\b(?:end of |before |after |by |no later than )?(?:year|yr)\s?\d(?:\s?[-–]\s?(?:year|yr)?\s?\d)?\b|\b(?:spring|fall|summer|autumn|winter)\s?\d{2,4}\b|\bsemester\s?\d\b/i;
const CONFLICT_CREDIT_RE = /\b\d{1,3}\s?(?:credit hours|credits|credit|hours)\b/i;
const CONFLICT_PROBES = [
  { milestone: "Qualifying / comprehensive exam", topic: "Qualifying / comprehensive exam timing", re: /qualif|comprehensive exam|\bprelim|\bquals\b|candidacy exam/i, valueRe: CONFLICT_TIME_RE },
  { milestone: "Dissertation proposal / prospectus", topic: "Proposal / prospectus timing", re: /proposal|prospectus/i, valueRe: CONFLICT_TIME_RE },
  { milestone: "Coursework / credit requirements", topic: "Coursework / credit requirement", re: /credit hours?|\bcredits\b|coursework/i, valueRe: CONFLICT_CREDIT_RE },
  { milestone: "Dissertation defense / oral exam", topic: "Dissertation defense timing", re: /dissertation defense|thesis defense|final oral|oral defense/i, valueRe: CONFLICT_TIME_RE },
  { milestone: "Annual review / progress report", topic: "Annual review timing", re: /annual (?:review|progress|evaluation)|progress report/i, valueRe: CONFLICT_TIME_RE },
];

function detectConflicts(found, materials) {
  // Prefer backend-provided conflicts (covers PDFs/Word) once discovery fills them.
  if (found && Array.isArray(found.conflicts) && found.conflicts.length) return found.conflicts;
  // Client fallback: only pasted/typed text is readable in the browser. Uploaded
  // PDF/Word text lives on the backend, so those are covered once it fills conflicts.
  const sources = (materials || [])
    .filter(m => (m.text || "").trim())
    .map(m => ({ source: m.name || "Pasted text", text: m.text }));
  if (sources.length < 2) return [];
  const conflicts = [];
  CONFLICT_PROBES.forEach((probe, pi) => {
    const vals = [];
    sources.forEach(src => {
      const idx = src.text.search(probe.re);
      if (idx < 0) return;
      const snippet = src.text.slice(Math.max(0, idx - 40), idx + 180);
      const vm = snippet.match(probe.valueRe);
      if (vm) vals.push({ source: src.source, value: vm[0].replace(/\s+/g, " ").trim() });
    });
    const distinct = new Set(vals.map(v => v.value.toLowerCase().replace(/^yr/, "year")));
    if (vals.length >= 2 && distinct.size >= 2) {
      conflicts.push({ id: `c${pi}`, topic: probe.topic, milestone: probe.milestone, field: "when", options: vals });
    }
  });
  return conflicts;
}

function ConflictResolver({ conflicts, resolutions, onChoose, onApply, onClose }) {
  const total = conflicts.length;
  const resolved = conflicts.filter(c => resolutions[c.id] !== undefined).length;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Resolve source conflicts">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="GitCompare" size={18} /></div>
            <div>
              <h2 className="display">Your sources disagree</h2>
              <p>We found {total} place{total === 1 ? "" : "s"} where your materials give different answers. Pick the one to trust. Your graduate office is always the final word.</p>
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="conflict-list">
            {conflicts.map(c => (
              <div key={c.id} className="conflict">
                <div className="conflict-topic"><Icon name="AlertTriangle" size={13} /> {c.topic}</div>
                <div className="conflict-opts">
                  {c.options.map((o, oi) => {
                    const sel = resolutions[c.id] === oi;
                    return (
                      <button key={oi} className={`conflict-opt ${sel ? "sel" : ""}`} onClick={() => onChoose(c.id, oi)}>
                        <span className={`co-radio ${sel ? "on" : ""}`}>{sel && <Icon name="Check" size={11} color="#fff" />}</span>
                        <span className="co-val">{o.value}</span>
                        <span className="co-src"><Icon name="FileText" size={10} /> {o.source}</span>
                      </button>
                    );
                  })}
                  <button className={`conflict-opt subtle ${resolutions[c.id] === "skip" ? "sel" : ""}`} onClick={() => onChoose(c.id, "skip")}>
                    <span className={`co-radio ${resolutions[c.id] === "skip" ? "on" : ""}`}>{resolutions[c.id] === "skip" && <Icon name="Check" size={11} color="#fff" />}</span>
                    <span className="co-val" style={{ fontWeight: 500, color: "var(--text-2)" }}>Not sure yet, decide later</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-f">
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{resolved} of {total} resolved</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Skip for now</button>
            <button className="btn primary" onClick={onApply} disabled={resolved === 0}><Icon name="Check" size={14} color="#fff" /> Apply choices</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ONBOARDING
// ============================================================================
function Onboarding({ onComplete, onAuthExpired, profile }) {
  // Single-step onboarding: upload (or paste) program materials → the AI reads
  // them and builds the plan directly. Program/institution come silently from
  // the signup profile; density/model/start-position use sensible defaults the
  // student can change later in Settings.
  const [program, setProgram] = useState(() => getOnboardingDefaults(profile).program);
  const [institution, setInstitution] = useState(() => getOnboardingDefaults(profile).institution);
  const [materials, setMaterials] = useState([]);   // {kind:'file'|'text', name, text?, file?}
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);
  const [searching, setSearching] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const defaults = getOnboardingDefaults(profile);
    const nextProgram = cleanOnboardingValue(defaults.program);
    const nextInstitution = cleanOnboardingValue(defaults.institution);
    if (nextProgram && nextProgram !== DEFAULT_ONBOARDING_PROGRAM) {
      setProgram(prev => shouldReplaceOnboardingDefault(prev, DEFAULT_ONBOARDING_PROGRAM) ? nextProgram : prev);
    }
    if (nextInstitution && nextInstitution !== DEFAULT_ONBOARDING_INSTITUTION) {
      setInstitution(prev => shouldReplaceOnboardingDefault(prev, DEFAULT_ONBOARDING_INSTITUTION) ? nextInstitution : prev);
    }
  }, [profile?.program, profile?.institution]);

  const hasUploadedFiles = materials.some(m => m.kind === "file" && m.file);
  const readableMaterialCount = materials.filter(m => (m.text || "").trim()).length;
  const searchStatus = hasUploadedFiles
    ? "Reading your uploaded documents with AI"
    : readableMaterialCount > 0
      ? "Reading your pasted materials with AI"
      : materials.length > 0
        ? "Checking your materials and public sources"
        : "Searching public program pages";

  const finishWith = async (res) => {
    if (finishing) return;
    setFinishing(true);
    const deliverables = { ...res, deliverables: (res.deliverables || []).map(d => ({ ...d })) };
    if (Array.isArray(res?.steps)) deliverables.steps = res.steps;
    const rm = normalizeStoredRoadmap(RE.generateRoadmap({
      program: { name: program, institution }, deliverables, startPosition: "coursework",
      workflow: { writeStyle: "unsure", publish: false }
    }));
    rm.materials = materials.map(({ file, ...material }) => material);
    const prefs = { density: "full", revealAll: false, modelMode: "cloud", institution, program };
    try { await persistOnboardingMaterialsToDocuments(materials); } catch (e) {}
    onComplete(rm, prefs);
  };

  const search = () => {
    setSearching(true); setSearchError("");
    // Save uploaded/pasted materials to the Documents section immediately.
    persistOnboardingMaterialsToDocuments(materials).catch(() => {});
    RE.discoverDeliverables({ program, institution, materials }).then((res) => {
      setSearching(false);
      finishWith(res);
    }).catch((err) => {
      setSearching(false);
      if (err?.status === 401) {
        window.CoachAPI && window.CoachAPI.clearAuth && window.CoachAPI.clearAuth();
        setSearchError("Your sign-in session expired or that account was removed. Please sign in or create a new account, then upload the handbook again.");
        if (onAuthExpired) setTimeout(onAuthExpired, 1400);
        return;
      }
      setSearchError(err?.message || "Could not generate a plan from that material. Please try a clearer handbook export.");
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
    const name = t.length > 46 ? t.slice(0, 46) + "..." : t;
    setMaterials(p => [...p, { kind: "text", name, text: t }]);
    setPasteText(""); setPasteOpen(false);
  };
  const removeMaterial = (i) => setMaterials(p => p.filter((_, j) => j !== i));

  const busy = searching || finishing;
  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-logo"><Icon name="Compass" size={24} color="#fff" /></div>

        <h1 className="display">Add your program documents.</h1>
        <p className="lead">
          Drop your handbook, advisor emails, timelines, or forms — or paste text straight from an email.
          We'll read everything with AI and build your full plan
          {program ? <> for <strong>{program}</strong>{institution ? <> at {institution}</> : null}</> : null}.
          You can always add more later, and everything is editable afterwards.
        </p>

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

        {busy && <div className="search-state"><Icon name="Search" size={16} className="spin" /> {finishing ? "Building your plan" : searchStatus}{program ? <> for <strong>&nbsp;{program}&nbsp;</strong></> : null}…</div>}
        {searchError && (
          <div style={{ background: "var(--rose-soft)", color: "var(--rose)", borderRadius: "var(--r-sm)", padding: "10px 12px", fontSize: 13, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="AlertTriangle" size={15} /> {searchError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn primary lg" onClick={search} disabled={busy}>
            {busy ? <><Icon name="Loader" size={15} color="#fff" className="spin" /> Building your plan…</>
              : materials.length > 0 ? <><Icon name="Sparkles" size={15} color="#fff" /> Build my plan from {materials.length} item{materials.length === 1 ? "" : "s"}</>
              : <>Skip — use the standard template <Icon name="ArrowRight" size={15} color="#fff" /></>}
          </button>
        </div>
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
    { id: "meetings", label: "Meetings", icon: "MessageSquare" },
    { id: "skills", label: "Skills", icon: "Sparkles" },
    { id: "insights", label: "Insights", icon: "Lightbulb" },
    { id: "defense", label: "Defense Room", icon: "Presentation" },
    { id: "documents", label: "Documents", icon: "FileText" },
    { id: "wellness", label: "Wellbeing", icon: "Heart" },
    { id: "settings", label: "Settings", icon: "Settings" }
  ].filter(it => it.id !== "skills"); // Skills page temporarily hidden for beta
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-brand">
        <div className="rail-mark"><Icon name="Compass" size={20} color="#fff" /></div>
        <div><div className="t1">PhD Navigator</div><div className="t2">know the path ahead</div></div>
      </div>
      <div className="rail-label">Workspace</div>
      {items.map(it => (
        <button key={it.id} data-tour={it.id} className={`rail-item ${view === it.id ? "active" : ""}`} onClick={() => onNav(it.id)} aria-current={view === it.id ? "page" : undefined}>
          <Icon name={it.icon} size={18} /> <span>{it.label}</span>
          {it.badge && <span className="badge">{it.badge}</span>}
        </button>
      ))}
      <div className="rail-spacer" />
      <div className="rail-user">
        <button type="button" className="rail-user-btn" onClick={() => onNav("settings")} aria-label={`Account and settings for ${user.name}`}>
          <span className="av" aria-hidden="true">{user.initials}</span>
          <span className="rail-user-id">
            <span className="nm">{user.name}</span>
            <span className="em" title={user.email}>{user.email}</span>
          </span>
        </button>
        {onSignOut && (
          <button type="button" className="rail-signout" title="Sign out" aria-label="Sign out" onClick={onSignOut}>
            <Icon name="LogOut" size={16} />
          </button>
        )}
      </div>
    </nav>
  );
}

// ============================================================================
// HOME TOOLS — the Workspace row on the dashboard.
//
// These are the app's real, functional tools (window.renderTool / TOOL_REGISTRY),
// not previews: each one persists its own data under `phd-tool-<id>`. The student
// picks which ones sit on Home from the Tools popup — up to HOME_TOOLS_MAX.
// ============================================================================
const HOME_TOOLS_KEY = "phd-coach-home-tools-v1";
const HOME_TOOLS_MAX = 6;
// Each entry is { id, size }. Sizes map to a 6-column grid: S = 3 per row,
// M = 2 per row, L = full row.
const HOME_TOOL_SIZES = ["S", "M", "L"];
const HOME_TOOLS_DEFAULT = [
  { id: "pomodoro", size: "M" },
  { id: "reading-queue", size: "M" },
  { id: "notes", size: "M" }
];
const nextToolSize = (size) => HOME_TOOL_SIZES[(HOME_TOOL_SIZES.indexOf(size) + 1) % HOME_TOOL_SIZES.length] || "M";
const toolSizeLabel = { S: "Small", M: "Medium", L: "Large" };

const HOME_TOOL_CATALOG = [
  { id: "notes",              name: "Notes",                 icon: "StickyNote",     desc: "Sticky notes — typed or voice-recorded, saved to Documents." },
  { id: "reading-queue",      name: "Reading Queue",         icon: "ListChecks",     desc: "Papers to read — add by hand, AI, email, or upload." },
  { id: "pomodoro",           name: "Focus Timer",           icon: "Timer",          desc: "Pomodoro sessions with break cycles." },
  { id: "bibliography",       name: "Bibliography",          icon: "BookMarked",     desc: "Cite anything — paste a URL, DOI, or ISBN. APA, MLA, Chicago, BibTeX." },
  { id: "deadlines",          name: "Deadlines",             icon: "Calendar",       desc: "Countdowns that sync to your calendar." },
  { id: "funding",            name: "Funding",               icon: "Landmark",       desc: "Grants and fellowships — planner with budgets and AI source-finding." },
  { id: "documenter",         name: "Journal & Drafts",      icon: "FileEdit",       desc: "A date-stamped research journal and scratchpad for draft prose." },
  { id: "lit-matrix",         name: "Literature Matrix",     icon: "Table2",         desc: "Compare papers side by side." },
  { id: "meeting-prep",       name: "Meeting Agenda",        icon: "MessageSquare",  desc: "Agendas with AI drafting, recurring meetings, notes that feed advisor memory, and action items." },
  { id: "pilot-checklist",    name: "Pilot Checklist",       icon: "ClipboardCheck", desc: "Track a pilot study end to end." },
  { id: "proquest-checklist", name: "Submission Checklist",  icon: "FileCheck",      desc: "Everything ProQuest needs from you." },
  { id: "formatting-check",   name: "Formatting Checklist",  icon: "AlignLeft",      desc: "Graduate-school formatting rules." }
];

const loadHomeTools = () => {
  const v = loadJSON(HOME_TOOLS_KEY, null);
  if (!Array.isArray(v)) return HOME_TOOLS_DEFAULT;
  // Accept the legacy shape (array of id strings) and the current { id, size }
  // shape; drop ids no longer in the catalog, normalize size, and hold the cap.
  return v
    .map(e => (typeof e === "string" ? { id: e, size: "M" } : e))
    .filter(e => e && HOME_TOOL_CATALOG.some(t => t.id === e.id))
    .map(e => ({ id: e.id, size: HOME_TOOL_SIZES.includes(e.size) ? e.size : "M" }))
    .slice(0, HOME_TOOLS_MAX);
};

// The Tools popup: toggle tools on and off Home. Tools live on Home only —
// there is no separate Tools page.
function ToolsPopup({ selected, onToggle, onClose }) {
  const closeRef = useRef(null);
  const full = selected.length >= HOME_TOOLS_MAX;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    if (closeRef.current) closeRef.current.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-popup-title"
        style={{ maxWidth: 720 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-h">
          <div>
            <h2 className="display" id="tools-popup-title">Tools</h2>
            <p>Pick up to {HOME_TOOLS_MAX} tools to keep on your Home page. Everything you put in them is saved.</p>
          </div>
          <button ref={closeRef} className="modal-x" onClick={onClose} aria-label="Close tools"><Icon name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="ht-count" aria-live="polite">
            {selected.length} of {HOME_TOOLS_MAX} added{full ? " · remove one to add another" : ""}
          </div>
          <div className="ht-grid">
            {HOME_TOOL_CATALOG.map(t => {
              const on = selected.includes(t.id);
              const disabled = !on && full;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ht-tile ${on ? "on" : ""}`}
                  onClick={() => onToggle(t.id)}
                  disabled={disabled}
                  aria-pressed={on}
                  title={disabled ? `Remove a tool first — you can keep ${HOME_TOOLS_MAX} on Home` : undefined}
                >
                  <span className="ht-i"><Icon name={t.icon} size={17} /></span>
                  <span className="ht-txt">
                    <span className="ht-n">{t.name}</span>
                    <span className="ht-d">{t.desc}</span>
                  </span>
                  <span className="ht-mark" aria-hidden="true">
                    <Icon name={on ? "Check" : "Plus"} size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="modal-f">
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
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
// REMINDERS — a lightweight "don't drop anything" system in four horizons:
// urgent / this week / this semester / this year. Lives on Home (compact, next
// to This Week) and on My Plan (full four-bucket board). localStorage first,
// best-effort server sync via the workspace "reminders" section.
// ============================================================================
const REM_KEY = "phd-coach-reminders-v1";
const REM_BUCKETS = [
  { id: "urgent", label: "Urgent", icon: "AlertTriangle", accent: "var(--rose)" },
  { id: "week", label: "This week", icon: "ListChecks", accent: "var(--primary-deep)" },
  { id: "semester", label: "This semester", icon: "CalendarRange", accent: "var(--amber)" },
  { id: "year", label: "This year", icon: "CalendarDays", accent: "var(--sage)" },
];
function RemindersPanel({ mode = "home", onNav }) {
  const [items, setItems] = useState(() => loadJSON(REM_KEY, []));
  const [text, setText] = useState("");
  const [bucket, setBucket] = useState(mode === "home" ? "week" : "urgent");
  const syncTimer = useRef(null);

  useEffect(() => { saveJSON(REM_KEY, items); }, [items]);
  // Pull once from the server (adopt server copy if local is empty), then
  // debounce-push changes back. Best-effort — offline just stays local.
  useEffect(() => {
    if (!(window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed())) return;
    window.CoachAPI.getWorkspaceState().then(state => {
      const remote = state && state.sections && state.sections.reminders;
      if (Array.isArray(remote) && remote.length && loadJSON(REM_KEY, []).length === 0) setItems(remote);
    }).catch(() => {});
  }, []);
  const persist = (next) => {
    setItems(next);
    if (!(window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed())) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      window.CoachAPI.putWorkspaceSection("reminders", next).catch(() => {});
    }, 800);
  };

  const add = () => {
    const t = text.trim(); if (!t) return;
    persist([{ id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, text: t, bucket, done: false, createdAt: Date.now() }, ...items]);
    setText("");
  };
  const toggle = (id) => persist(items.map(r => r.id === id ? { ...r, done: !r.done } : r));
  const remove = (id) => persist(items.filter(r => r.id !== id));
  const open = items.filter(r => !r.done);

  // Plain render helpers (NOT inner components) — using them as elements keeps
  // the <input> identity stable across renders so it never loses focus mid-type.
  const renderRow = (r, showBucket) => {
    const b = REM_BUCKETS.find(x => x.id === r.bucket) || REM_BUCKETS[1];
    return (
      <div key={r.id} className={`rem-row ${r.done ? "done" : ""}`}>
        <button className="dh-cb" onClick={() => toggle(r.id)} aria-label={r.done ? "Mark not done" : "Mark done"}>
          {r.done && <Icon name="Check" size={12} color="#fff" />}
        </button>
        <span className="rem-t">{r.text}</span>
        {showBucket && <span className="rem-chip" style={{ color: b.accent }}>{b.label}</span>}
        <button className="rem-del" onClick={() => remove(r.id)} aria-label="Delete reminder"><Icon name="X" size={12} /></button>
      </div>
    );
  };

  const addBar = (
    <div className="rem-add">
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Remember to…"
        onKeyDown={e => { if (e.key === "Enter") add(); }} />
      <select value={bucket} onChange={e => setBucket(e.target.value)} aria-label="Reminder horizon">
        {REM_BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      <button className="btn icon sm primary" onClick={add} aria-label="Add reminder"><Icon name="Plus" size={14} color="#fff" /></button>
    </div>
  );

  if (mode === "home") {
    // Compact: every horizon shown, grouped by urgency (urgent → this year).
    return (
      <div className="dh-card" style={{ marginBottom: 0, height: "100%" }}>
        <div className="dh-card-head">
          <span className="dh-eyebrow">Reminders</span>
          <span className="dh-count">{open.length} open</span>
        </div>
        {addBar}
        {open.length === 0 ? (
          <div className="dh-today-empty"><p>Nothing to remember right now. Add anything you can't afford to drop.</p></div>
        ) : (
          REM_BUCKETS.map(b => {
            const bucketItems = open.filter(r => r.bucket === b.id);
            if (!bucketItems.length) return null;
            return (
              <div key={b.id} className="rem-group">
                <div className="rem-group-h" style={{ color: b.accent }}><Icon name={b.icon} size={11} /> {b.label} <span className="dh-count">{bucketItems.length}</span></div>
                {bucketItems.map(r => renderRow(r, false))}
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Full board (My Plan): four horizon columns.
  return (
    <div className="rem-board">
      <div className="dh-card-head" style={{ marginBottom: 10 }}>
        <span className="dh-eyebrow">Reminders</span>
        <span className="dh-count">{open.length} open · done ones auto-fade</span>
      </div>
      {addBar}
      <div className="rem-cols">
        {REM_BUCKETS.map(b => {
          const bucketItems = items.filter(r => r.bucket === b.id).sort((a, x) => (a.done ? 1 : 0) - (x.done ? 1 : 0));
          return (
            <div key={b.id} className="rem-col">
              <div className="rem-col-h" style={{ color: b.accent }}><Icon name={b.icon} size={13} /> {b.label} <span className="dh-count">{bucketItems.filter(r => !r.done).length}</span></div>
              {bucketItems.length === 0
                ? <div className="rem-empty">—</div>
                : bucketItems.map(r => renderRow(r, false))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
window.RemindersPanel = RemindersPanel;

// ============================================================================
// DASHBOARD HOME — four blocks: greeting → timeline → action card → sidebar
// ============================================================================
function greetWord() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Home dashboard — design option "3a" (decluttered): a single line of context
// under the greeting, then a hideable horizontal journey timeline, This Week,
// your plan, and the workspace tools. All of it is wired to live app state:
// the checklist is the current step's subtasks, the plan snapshot reads the
// roadmap, and the context line surfaces the soonest real deadline + next gate.
const TL_HIDE_KEY = "phd-coach-hometl-hidden-v1";
const BRIEF_CACHE_KEY = "phd-coach-brief-v1";
const BRIEF_TTL_MS = 10 * 60 * 1000;

// --- Customizable home layout ----------------------------------------------
// Every section of Home is a block the student can hide or reorder — you can
// run six tools and nothing else, or lead with the journey. Order + visibility
// persist per browser under HOME_LAYOUT_KEY.
const HOME_LAYOUT_KEY = "phd-coach-home-layout-v1";
const HOME_SECTIONS = [
  { id: "journey", name: "Your journey", icon: "Route", desc: "Horizontal milestone timeline with your current step and plan actions." },
  { id: "stats", name: "Stat tiles", icon: "LayoutDashboard", desc: "Plan progress, next deadline, and next meeting at a glance." },
  { id: "week", name: "This week", icon: "ListChecks", desc: "This step's tasks and reminders, side by side, plus deadlines due in the next 7 days." },
  { id: "tools", name: "Workspace tools", icon: "Wrench", desc: "Your picked tools — notes, deadlines, reading, funding, and more." }
];
function loadHomeLayout() {
  const stored = loadJSON(HOME_LAYOUT_KEY, null);
  const base = HOME_SECTIONS.map(s => ({ id: s.id, on: true }));
  if (!Array.isArray(stored)) return base;
  const known = stored.filter(e => e && HOME_SECTIONS.some(s => s.id === e.id))
    .map(e => ({ id: e.id, on: e.on !== false }));
  // Insert any section missing from the saved layout at its canonical position
  // (so a newly added block like Reminders lands next to its neighbors and is
  // visible, not appended out of sight at the very bottom).
  HOME_SECTIONS.forEach((s, idx) => {
    if (!known.some(e => e.id === s.id)) {
      known.splice(Math.min(idx, known.length), 0, { id: s.id, on: true });
    }
  });
  return known;
}

// The Customize popup: toggle sections on/off and reorder them.
function HomeCustomizePopup({ layout, onToggle, onMove, onReset, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Customize Home">
        <div className="modal-h">
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="LayoutDashboard" size={18} /></div>
            <div><h2 className="display">Make Home yours</h2><p>Show only what you use, in the order you want it. Want six tools and nothing else? Turn the rest off.</p></div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="hc-list">
            {layout.map((e, i) => {
              const meta = HOME_SECTIONS.find(s => s.id === e.id) || {};
              return (
                <div key={e.id} className={`hc-row ${e.on ? "" : "off"}`}>
                  <span className="hc-ico"><Icon name={meta.icon || "Box"} size={15} /></span>
                  <div className="hc-txt">
                    <span className="hc-n">{meta.name}</span>
                    <span className="hc-d">{meta.desc}</span>
                  </div>
                  <span className="hc-move">
                    <button disabled={i === 0} onClick={() => onMove(e.id, -1)} aria-label={`Move ${meta.name} up`}><Icon name="ChevronUp" size={14} /></button>
                    <button disabled={i === layout.length - 1} onClick={() => onMove(e.id, 1)} aria-label={`Move ${meta.name} down`}><Icon name="ChevronDown" size={14} /></button>
                  </span>
                  <button className={`hc-toggle ${e.on ? "on" : ""}`} onClick={() => onToggle(e.id)} aria-pressed={e.on} aria-label={`${e.on ? "Hide" : "Show"} ${meta.name}`}>
                    <Icon name={e.on ? "Eye" : "EyeOff"} size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={onReset}><Icon name="RotateCcw" size={14} /> Reset layout</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// Session-start calendar brief: pulled once per session (10-min TTL) from the
// backend, which merges Google/Outlook events + deadlines + faculty cadence
// through Gemini. Returns null while loading / when signed out.
function useCalendarBrief() {
  const [brief, setBrief] = useState(() => {
    try {
      const c = JSON.parse(sessionStorage.getItem(BRIEF_CACHE_KEY) || "null");
      if (c && Date.now() - c.at < BRIEF_TTL_MS) return c.data;
    } catch (e) {}
    return null;
  });
  useEffect(() => {
    if (brief) return;
    const api = window.CoachAPI;
    if (!api || !api.isAuthed || !api.isAuthed() || !api.calendarBrief) return;
    let alive = true;
    api.calendarBrief().then(data => {
      if (!alive || !data) return;
      setBrief(data);
      try { sessionStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return brief;
}
// Journey timeline v3: ONE continuous line running through every milestone
// node, with a gradient progress fill up to where you are. Nodes sit on the
// line; titles hang beneath; gates get a small amber flag pip on the node.
function JourneyTimeline({ steps, doneTasks, onSelect }) {
  const n = steps.length || 1;
  // True pagination: only as many milestones as fit the available width are
  // rendered; arrows + dots page through the rest. No horizontal scrolling.
  const outerRef = useRef(null);
  const [perPage, setPerPage] = useState(8);
  const [page, setPage] = useState(null); // null → open on the current milestone's page

  // You can work several milestones in parallel — every current/redo step is
  // "active". The line fills to the furthest active one; each active node
  // wears its own subtask-progress ring.
  const activeIdxs = steps.map((s, i) => (s.status === "current" || s.status === "redo") ? i : -1).filter(i => i >= 0);
  const anchor = activeIdxs.length ? Math.max(...activeIdxs)
    : Math.min(n - 1, steps.filter(s => s.status === "done").length);

  useEffect(() => {
    const measure = () => {
      const el = outerRef.current; if (!el) return;
      setPerPage(Math.max(3, Math.floor((el.clientWidth - 56) / 118)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [n]);

  const pages = Math.max(1, Math.ceil(n / perPage));
  const curPage = Math.min(page == null ? Math.floor(anchor / perPage) : page, pages - 1);
  const start = curPage * perPage;
  const slice = steps.slice(start, start + perPage);
  const m = slice.length || 1;
  const edge = 50 / m; // line spans first-node-center → last-node-center
  // Fill relative to this page: pages fully behind progress are full, ahead are empty.
  const fillPct = Math.round(Math.min(1, Math.max(0, (anchor - start) / Math.max(1, m - 1))) * 100);
  const canL = curPage > 0;
  const canR = curPage < pages - 1;
  const RING_C = 2 * Math.PI * 20; // r=20 circle circumference
  const progressOf = (s) => {
    const subs = s.subtasks || [];
    if (!subs.length || !doneTasks) return null;
    const done = subs.filter(t => doneTasks.has(`${s.id}::${t}`)).length;
    return { done, total: subs.length, pct: done / subs.length };
  };
  return (
    <div className="jn2-outer" ref={outerRef}>
      {canL && <button className="jn2-arrow left" onClick={() => setPage(curPage - 1)} aria-label="Earlier milestones"><Icon name="ChevronLeft" size={16} /></button>}
      {canR && <button className="jn2-arrow right" onClick={() => setPage(curPage + 1)} aria-label="Later milestones"><Icon name="ChevronRight" size={16} /></button>}
    <div className="jn2 paged">
      <div className="jn2-inner">
        <div className="jn2-track" style={{ left: `${edge}%`, right: `${edge}%` }} aria-hidden="true">
          <span className="jn2-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="jn2-items" role="list">
          {slice.map((s, j) => {
            const i = start + j;
            const active = s.status === "current" || s.status === "redo";
            const cls = s.status === "done" ? "done" : active ? "current" : s.recovery ? "recovery" : "locked";
            const prog = active ? progressOf(s) : null;
            return (
              <button key={s.id} className={`jn2-item ${cls}`} role="listitem" onClick={() => onSelect(s, i)}
                title={`${s.title}${s.estimate ? ` · ${s.estimate}` : ""}${s.gate ? " · gate" : ""}${prog ? ` · ${prog.done}/${prog.total} tasks done` : ""}`}>
                <span className={`jn2-node ${cls}`}>
                  {prog && (
                    <svg className="jn2-ring" viewBox="0 0 44 44" aria-hidden="true">
                      <circle className="jn2-ring-bg" cx="22" cy="22" r="20" />
                      <circle className="jn2-ring-fg" cx="22" cy="22" r="20"
                        strokeDasharray={`${Math.max(0.001, prog.pct) * RING_C} ${RING_C}`} />
                    </svg>
                  )}
                  {s.status === "done" ? <Icon name="Check" size={12} color="#fff" />
                    : s.recovery ? <Icon name="AlertTriangle" size={11} color="#fff" /> : i + 1}
                  {s.gate && <span className="jn2-gatedot" title="Gate — a major checkpoint"><Icon name="Flag" size={7} color="#fff" /></span>}
                </span>
                <span className="jn2-label">{s.title}</span>
                {prog && <span className="jn2-sub">{prog.done}/{prog.total} tasks</span>}
              </button>
            );
          })}
        </div>
      </div>
      {pages > 1 && (
        <div className="jn2-dots" role="tablist" aria-label="Timeline pages">
          {Array.from({ length: pages }).map((_, p) => (
            <button key={p} className={`jn2-dot ${p === curPage ? "on" : ""}`} onClick={() => setPage(p)}
              aria-label={`Milestones ${p * perPage + 1}–${Math.min(n, (p + 1) * perPage)}`} />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}

const fmtMeetTime = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch (e) { return ""; }
};

function Dashboard({ roadmap, onNav, onOpenSos, doneTasks, setDoneTasks, activity, onOpenStep, focused }) {
  const steps = roadmap.steps;
  const current = steps.find(s => s.status === "current") || steps.find(s => s.status === "redo") || steps[0];
  const curIdx = steps.indexOf(current);
  const dts = doneTasks || new Set();

  // --- Journey timeline (horizontal, hideable) ------------------------------
  const [tlHidden, setTlHidden] = useState(() => { try { return localStorage.getItem(TL_HIDE_KEY) === "1"; } catch (e) { return false; } });
  useEffect(() => { try { localStorage.setItem(TL_HIDE_KEY, tlHidden ? "1" : "0"); } catch (e) {} }, [tlHidden]);

  // --- Customizable section layout ------------------------------------------
  const [layout, setLayout] = useState(loadHomeLayout);
  const [customize, setCustomize] = useState(false);
  useEffect(() => { saveJSON(HOME_LAYOUT_KEY, layout); }, [layout]);
  const toggleSection = (id) => setLayout(prev => prev.map(e => e.id === id ? { ...e, on: !e.on } : e));
  const moveSection = (id, dir) => setLayout(prev => {
    const i = prev.findIndex(e => e.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const n = prev.slice(); const [m] = n.splice(i, 1); n.splice(j, 0, m); return n;
  });

  // --- Calendar brief (next meeting, Gemini summary) ------------------------
  const brief = useCalendarBrief();

  // --- Tools on Home (up to HOME_TOOLS_MAX), chosen in the Tools popup -------
  const [homeTools, setHomeTools] = useState(loadHomeTools);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false); // Meeting Agenda modal (home card front door)
  useEffect(() => { saveJSON(HOME_TOOLS_KEY, homeTools); }, [homeTools]);
  const homeToolIds = homeTools.map(t => t.id);
  const toggleTool = (id) => setHomeTools(prev =>
    prev.some(t => t.id === id) ? prev.filter(t => t.id !== id)
      : prev.length >= HOME_TOOLS_MAX ? prev
        : [...prev, { id, size: "M" }]);
  const resizeTool = (id) => setHomeTools(prev =>
    prev.map(t => t.id === id ? { ...t, size: nextToolSize(t.size) } : t));
  const removeTool = (id) => setHomeTools(prev => prev.filter(t => t.id !== id));
  const toolName = (id) => (HOME_TOOL_CATALOG.find(t => t.id === id) || {}).name || "tool";

  // --- Today: the current step's checklist, toggled in place ----------------
  const subs = current.subtasks || [];
  const todo = subs.map(t => ({ t, key: `${current.id}::${t}`, done: dts.has(`${current.id}::${t}`) }));
  const doneToday = todo.filter(x => x.done).length;
  const shownTodo = todo.slice(0, 6);
  const toggleTask = (key) => setDoneTasks && setDoneTasks(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // --- Plan snapshot: last done · current (with progress) · next ------------
  const prevDone = steps.slice(0, curIdx).reverse().find(s => s.status === "done");
  const next = steps.slice(curIdx + 1).find(s => s.status !== "done") || steps[curIdx + 1];
  const curPct = subs.length ? Math.round((doneToday / subs.length) * 100)
    : Math.min(100, Math.round((curIdx / Math.max(1, steps.length)) * 100));
  const pendingFirst = todo.find(x => !x.done);
  const curHint = pendingFirst ? `${pendingFirst.t} — the last piece` : (current.objective || "");
  const goStep = () => onOpenStep ? onOpenStep(current.id) : onNav("plan");

  // --- Context line: soonest real deadline (from the Deadlines tool store) ---
  const today = new Date(new Date().toDateString());
  const upcoming = (loadJSON("phd-coach-deadlines-v1", []) || [])
    .filter(d => d && d.date)
    .map(d => ({ ...d, days: Math.ceil((new Date(d.date + "T00:00:00") - today) / 86400000) }))
    .filter(d => !isNaN(d.days) && d.days >= 0)
    .sort((a, b) => a.days - b.days);
  const nd = upcoming[0];
  const ndText = nd ? (nd.days === 0 ? "due today" : nd.days === 1 ? "due tomorrow" : `in ${nd.days} days`) : null;
  const nextGate = steps.slice(curIdx).find(s => s.gate && s.status !== "done");

  // Big-screen stat strip (design 1a/2a tiles). Progress + Today are live;
  // the deadline tile reads the nearest real deadline. The meeting tile is a
  // demo placeholder until a calendar/meeting source is wired to the backend.
  const doneCount = steps.filter(s => s.status === "done").length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const fmtMonthDay = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (e) { return iso; } };
  const nextMeeting = brief && brief.next_meeting;
  const calConnected = brief && Array.isArray(brief.connected) && brief.connected.length > 0;
  const weekDeadlines = upcoming.filter(d => d.days <= 7);

  // --- Section renderers (each Home block is a toggleable, orderable unit) ---
  const sections = {
    journey: () => (
      <div className="dh-tl">
        <div className="dh-tl-head">
          <span className="dh-eyebrow">Your journey</span>
          <span className="dh-ws-sub">{doneCount} of {steps.length} milestones · {pct}%</span>
          <button className="btn sm jn-fullplan" onClick={() => onNav("plan")}><Icon name="Map" size={13} /> Full plan <Icon name="ArrowRight" size={12} /></button>
          <button className="linkish dh-tl-toggle" style={{ marginLeft: 0 }} onClick={() => setTlHidden(h => !h)}>
            {tlHidden ? <><Icon name="ChevronDown" size={13} /> Show timeline</> : <><Icon name="ChevronUp" size={13} /> Hide</>}
          </button>
        </div>
        {!tlHidden && (
          <JourneyTimeline steps={steps} doneTasks={dts} onSelect={(s) => onOpenStep ? onOpenStep(s.id) : onNav("plan")} />
        )}
      </div>
    ),
    stats: () => (
      <div className="dh-stats">
        <div className="dh-stat">
          <div className="dh-stat-l">Plan progress</div>
          <div className="dh-stat-n">{pct}%</div>
          <div className="dh-stat-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="dh-stat-s">{doneCount} of {steps.length} milestones</div>
        </div>
        <div className="dh-stat">
          <div className="dh-stat-l amber">Next deadline</div>
          {nd ? (
            <>
              <div className="dh-stat-nm">{nd.label}</div>
              <div className="dh-stat-s">{fmtMonthDay(nd.date)} · <b className="amber">{ndText}</b></div>
            </>
          ) : (
            <>
              <div className="dh-stat-nm">Nothing due soon</div>
              <div className="dh-stat-s">You're clear this week</div>
            </>
          )}
        </div>
        <div className="dh-stat">
          <div className="dh-stat-l sage">Next meeting</div>
          {nextMeeting ? (
            <>
              <div className="dh-stat-nm">{nextMeeting.title}</div>
              <div className="dh-stat-s">{fmtMeetTime(nextMeeting.start) || "Soon"}{nextMeeting.with ? ` · ${nextMeeting.with}` : ""}</div>
            </>
          ) : calConnected ? (
            <>
              <div className="dh-stat-nm">Nothing scheduled</div>
              <div className="dh-stat-s">Your calendar is clear</div>
            </>
          ) : (
            <>
              <div className="dh-stat-nm">No calendar linked</div>
              <button className="linkish dh-stat-link" onClick={() => onNav("settings")}>Connect Google or Outlook →</button>
            </>
          )}
        </div>
      </div>
    ),
    week: () => (
      <>
      <div className="dh-half-row">
      <div className="dh-card dh-today" style={{ marginBottom: 0, height: "100%" }}>
        <div className="dh-card-head">
          <span className="dh-eyebrow accent">This week</span>
          <span className="dh-count">{doneToday} of {todo.length} done</span>
        </div>
        {weekDeadlines.length > 0 && (
          <div className="dh-week-dls">
            {weekDeadlines.slice(0, 3).map(d => (
              <div key={d.id || d.label} className="dh-week-dl">
                <Icon name="CalendarClock" size={13} />
                <span className="dh-task-t">{d.label}</span>
                <span className={`dl-chip ${d.days === 0 ? "past" : "soon"}`}>{d.days === 0 ? "today" : d.days === 1 ? "tomorrow" : `in ${d.days}d`}</span>
              </div>
            ))}
          </div>
        )}
        {shownTodo.length > 0 ? (
          <div className="dh-tasks">
            {shownTodo.map((x, i) => (
              <div key={i} className={`dh-task ${x.done ? "done" : ""}`}>
                <button className="dh-cb" onClick={() => toggleTask(x.key)} aria-label={x.done ? "Mark not done" : "Mark done"}>
                  {x.done && <Icon name="Check" size={12} color="#fff" />}
                </button>
                <span className="dh-task-t">{x.t}</span>
                <span className="dh-task-meta">{current.title}</span>
              </div>
            ))}
            {todo.length > shownTodo.length && (
              <button className="linkish dh-more" onClick={goStep}>+{todo.length - shownTodo.length} more on this step</button>
            )}
          </div>
        ) : (
          <div className="dh-today-empty">
            <p>No to-dos on this step yet.</p>
            <button className="btn sm" onClick={goStep}><Icon name="Plus" size={13} /> Add to-dos in the plan</button>
          </div>
        )}
      </div>
      <RemindersPanel mode="home" onNav={onNav} />
      </div>
      {(() => {
          // Meeting notes, promoted: the latest conversations and what you owe.
          // The card is the front door — it opens the real Meeting Agenda tool
          // directly (create, edit, view all), not the widget picker.
          const meetings = [...(loadJSON("phd-coach-meetings-v1", []) || [])]
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 2);
          return (
            <div className="dh-card" style={{ margin: "14px 0 18px" }}>
              <div className="dh-card-head">
                <span className="dh-eyebrow">Meeting notes</span>
                <button className="linkish dh-more" style={{ margin: 0 }} onClick={() => setMeetingsOpen(true)}>Open meeting log →</button>
              </div>
              {meetings.length === 0 ? (
                <div className="dh-today-empty">
                  <p>No meetings logged yet. Notes you take here feed your coach's memory.</p>
                  <button className="btn sm primary" onClick={() => setMeetingsOpen(true)}><Icon name="Plus" size={13} color="#fff" /> Log a meeting</button>
                </div>
              ) : (
                <>
                  {meetings.map((m, i) => {
                    const openActs = (m.actions || []).filter(a => a && !a.done);
                    return (
                      <button key={i} className="dh-meet clickable" onClick={() => setMeetingsOpen(true)} title="Open this meeting">
                        <div className="dh-meet-h"><Icon name="Users" size={13} /> <strong>{m.withName || "Advisor"}</strong><span className="dh-meet-d">{m.date || ""}</span></div>
                        {m.notes && <div className="dh-meet-n">{String(m.notes).slice(0, 140)}{String(m.notes).length > 140 ? "…" : ""}</div>}
                        {openActs.length > 0 && <div className="dh-meet-a"><Icon name="ListChecks" size={11} /> {openActs.length} open action item{openActs.length === 1 ? "" : "s"}</div>}
                      </button>
                    );
                  })}
                  <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setMeetingsOpen(true)}><Icon name="Plus" size={13} /> Log a meeting</button>
                </>
              )}
            </div>
          );
        })()}
      </>
    ),
    tools: () => window.renderTool ? (
      <>
        <div className="dh-ws-head">
          <span className="dh-eyebrow">Workspace</span>
          <span className="dh-ws-sub">{homeTools.length} of {HOME_TOOLS_MAX} tools · working on {current.title}</span>
          <button className="linkish dh-ws-all" onClick={() => setToolsOpen(true)}>All tools →</button>
        </div>
        {homeTools.length === 0 ? (
          <button className="dh-tools-empty" onClick={() => setToolsOpen(true)}>
            <Icon name="Plus" size={18} /> Add up to {HOME_TOOLS_MAX} tools to your Home page
          </button>
        ) : (
          <div className="dh-tools">
            {homeTools.map(t => (
              <div key={t.id} className={`dh-tool-slot size-${t.size}`}>
                <div className="dh-tool-ctl">
                  <button
                    type="button"
                    className="dh-tool-size"
                    onClick={() => resizeTool(t.id)}
                    title={`Resize ${toolName(t.id)} (now ${toolSizeLabel[t.size]}) — Small fits 3 per row, Medium 2, Large fills the row`}
                    aria-label={`Resize ${toolName(t.id)}, currently ${toolSizeLabel[t.size]}`}
                  >{t.size}</button>
                  <button
                    type="button"
                    className="dh-tool-rm"
                    onClick={() => removeTool(t.id)}
                    title={`Remove ${toolName(t.id)} from Home`}
                    aria-label={`Remove ${toolName(t.id)} from Home`}
                  ><Icon name="X" size={13} /></button>
                </div>
                {window.renderTool(t.id)}
              </div>
            ))}
          </div>
        )}
      </>
    ) : null
  };

  return (
    <div className="page dash-home">
      <div className="greeting dh-greet-row" style={{ marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="display">{greetWord()}, {window.MOCK_USER.name.split(" ")[0]}.</h1>
          <div className="dh-context">
            {nd
              ? <span><Icon name="Calendar" size={13} /> Nearest deadline — <b className="accent">{nd.label}, {ndText}</b></span>
              : <span><Icon name="Calendar" size={13} /> No deadlines logged — add them in your Workspace</span>}
            {nextGate && <><span className="dh-mid">·</span><span>Next gate: <b>{nextGate.title}</b>{nextGate.estimate ? ` · ${nextGate.estimate}` : ""}</span></>}
          </div>
          {brief && brief.brief && (
            <div className="dh-brief"><Icon name="Sparkles" size={13} /> {brief.brief}</div>
          )}
        </div>
        <button className="btn sm ghost dh-customize" onClick={() => setCustomize(true)} title="Choose which sections show on Home, and in what order">
          <Icon name="SlidersHorizontal" size={14} /> Customize
        </button>
      </div>

      {layout.filter(e => e.on).map(e => (
        <React.Fragment key={e.id}>{sections[e.id] ? sections[e.id]() : null}</React.Fragment>
      ))}
      {layout.every(e => !e.on) && (
        <button className="dh-tools-empty" onClick={() => setCustomize(true)}>
          <Icon name="LayoutDashboard" size={18} /> Everything's hidden — open Customize to bring sections back
        </button>
      )}

      {toolsOpen && (
        <ToolsPopup selected={homeToolIds} onToggle={toggleTool} onClose={() => setToolsOpen(false)} />
      )}
      {meetingsOpen && (
        <div className="backdrop" onClick={() => setMeetingsOpen(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Meeting log">
            <div className="modal-h">
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-soft)", color: "var(--primary-deep)", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="MessageSquare" size={18} /></div>
                <div><h2 className="display">Meeting log</h2><p>Agendas, notes, and action items. Everything you write here feeds your coach's memory and Documents.</p></div>
              </div>
              <button className="modal-x" onClick={() => setMeetingsOpen(false)} aria-label="Close"><Icon name="X" size={14} /></button>
            </div>
            <div className="modal-b">
              {window.renderTool && window.hasTool && window.hasTool("meeting-prep")
                ? window.renderTool("meeting-prep")
                : <p style={{ fontSize: 13, color: "var(--text-2)" }}>The meeting tool didn't load — refresh the page and try again.</p>}
            </div>
          </div>
        </div>
      )}
      {customize && (
        <HomeCustomizePopup layout={layout} onToggle={toggleSection} onMove={moveSection}
          onReset={() => setLayout(HOME_SECTIONS.map(s => ({ id: s.id, on: true })))}
          onClose={() => setCustomize(false)} />
      )}
      <button className="sos" onClick={onOpenSos}><Icon name="LifeBuoy" size={15} /> Something came up?</button>
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

window.coachHelpers = { RM_KEY, TASK_KEY, THEME_KEY, ACT_KEY, PREFS_KEY, ENGAGE_KEY, UNLOCKS_KEY, STALL_DAYS, loadJSON, saveJSON, normalizeStoredRoadmap, boldMd, PHASE_TIPS, advisorById, greetWord, stallDays };
