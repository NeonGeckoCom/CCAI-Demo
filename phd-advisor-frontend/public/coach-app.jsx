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
  const [step, setStep] = useState(0);
  const [program, setProgram] = useState(() => getOnboardingDefaults(profile).program);
  const [institution, setInstitution] = useState(() => getOnboardingDefaults(profile).institution);
  const [materials, setMaterials] = useState([]);   // {kind:'file'|'text', name, text?, file?}
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);       // raw discovery result
  const [items, setItems] = useState([]);          // editable milestone list
  const [editingIdx, setEditingIdx] = useState(-1);
  const [conflicts, setConflicts] = useState([]);          // [{id, topic, milestone, field, options}]
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolutions, setResolutions] = useState({});      // { [conflictId]: optionIndex | "skip" }
  const [startPosition, setStartPosition] = useState("coursework");
  const [writeStyle, setWriteStyle] = useState("unsure");
  const [publish, setPublish] = useState("unsure");
  const [densityChoice, setDensityChoice] = useState("balanced"); // everything | balanced | minimal
  const [modelMode, setModelMode] = useState("cloud");            // cloud | private
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
  const sourceNote = found?.extractionMethod === "llm_direct_plan"
    ? "Generated by AI from your full uploaded or pasted material - please verify"
    : found?.discoveryMode === "documents"
      ? "Parsed from your uploaded or pasted materials - please verify"
    : found?.discoveryMode === "web"
      ? "Sourced from public web search - please verify"
      : "Estimated from the built-in PhD milestone template - please verify";

  const applyDiscovery = (res) => {
    setFound(res);
    setItems(res.deliverables.map(d => ({ ...d, confirmed: false })));
    const cf = detectConflicts(res, materials);
    setConflicts(cf); setResolutions({}); setConflictOpen(cf.length > 0);
    setSearching(false); setStep(2);
  };

  const search = () => {
    setSearching(true); setFound(null); setSearchError("");
    // Save uploaded/pasted materials to the Documents section the moment the
    // student proceeds — not only at the very end of onboarding (finish()).
    persistOnboardingMaterialsToDocuments(materials).catch(() => {});
    RE.discoverDeliverables({ program, institution, materials }).then(applyDiscovery).catch((err) => {
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

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const deliverables = { ...found, deliverables: items.map(({ confirmed, ...d }) => d) };
    if (Array.isArray(found?.steps)) {
      if (found.extractionMethod === "llm_direct_plan") {
        deliverables.steps = found.steps;
      } else {
        const kept = new Set(deliverables.deliverables.map(d => (d.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
        deliverables.steps = found.steps.filter(step => {
          const key = (step.deliverable || step.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          return !kept.size || kept.has(key);
        });
      }
    }
    const rm = normalizeStoredRoadmap(RE.generateRoadmap({
      program: { name: program, institution }, deliverables, startPosition,
      workflow: { writeStyle, publish: publish === "yes" }
    }));
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

  const chooseResolution = (cid, choice) => setResolutions(p => ({ ...p, [cid]: choice }));
  const applyResolutions = () => {
    setItems(prev => prev.map(item => {
      const c = conflicts.find(cf => {
        const choice = resolutions[cf.id];
        if (choice === undefined || choice === "skip") return false;
        const a = (item.name || "").toLowerCase();
        const b = (cf.milestone || "").toLowerCase();
        return b && (a.includes(b) || b.includes(a));
      });
      if (!c) return item;
      const chosen = c.options[resolutions[c.id]];
      return chosen ? { ...item, when: chosen.value, conflictSource: chosen.source } : item;
    }));
    setConflictOpen(false);
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
            <p className="lead">We'll look for public requirements like handbooks, program pages, and graduate-school rules, then ask you to confirm what we find.</p>
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
            <p className="lead">Requirements often arrive as a pile of emails and PDFs. Drop anything here: handbooks, advisor emails, timelines, forms, or paste text straight from an email. We'll fold it all into your plan. You can always add more later.</p>

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
            {searchError && (
              <div style={{ background: "var(--rose-soft)", color: "var(--rose)", borderRadius: "var(--r-sm)", padding: "10px 12px", fontSize: 13, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <Icon name="AlertTriangle" size={15} /> {searchError}
              </div>
            )}

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
            <p className="lead">Please confirm each one for <strong>{found.degree}</strong> at {found.institution}{materials.length > 0 ? <>, cross-checked against your <strong>{materials.length} uploaded item{materials.length === 1 ? "" : "s"}</strong></> : ""}. Edit and remove what doesn't match. Your graduate office is always the final word.</p>
            {conflicts.length > 0 && (
              <button className="conflict-banner" onClick={() => setConflictOpen(true)}>
                <span className="cb-ico"><Icon name="AlertTriangle" size={14} /></span>
                <span className="cb-txt"><b>{conflicts.length} source conflict{conflicts.length === 1 ? "" : "s"}</b>. Your materials disagree on some dates. Resolve before we build the plan.</span>
                <span className="cb-go">Review <Icon name="ArrowRight" size={13} /></span>
              </button>
            )}
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
                <Icon name="FileCheck" size={16} /> AI read your uploaded or pasted materials to shape the plan.
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
            <p className="lead">Your plan starts from your real position. You can change all of this later.</p>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 8 }}>Current stage</label>
            <div className="opt-grid">
              {RE.START_POSITIONS.map(p => (
                <button key={p.id} className={`opt ${startPosition === p.id ? "sel" : ""}`} onClick={() => setStartPosition(p.id)}>
                  <span className="dot" /> {p.label}
                </button>
              ))}
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
            <p className="lead">PhD Navigator has a lot under the hood. Choose how much shows up at once. You can change this anytime in Settings.</p>
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
            <p className="lead">Your advisors are powered by AI. Choose where that runs. You can switch later in Settings.</p>
            <div className="onb-choice">
              <button className={`onb-choice-card ${modelMode === "cloud" ? "sel" : ""}`} onClick={() => setModelMode("cloud")}>
                <span className="occ-ico"><Icon name="Cloud" size={18} /></span>
                <span className="occ-t">Cloud models</span>
                <span className="occ-d">Best accuracy and the fullest capabilities. Your inputs are processed in the cloud.</span>
              </button>
              <button className={`onb-choice-card ${modelMode === "private" ? "sel" : ""}`} onClick={() => setModelMode("private")}>
                <span className="occ-ico"><Icon name="ShieldCheck" size={18} /></span>
                <span className="occ-t">On-device &amp; private</span>
                <span className="occ-d">Runs locally on your machine. Fully private, with slightly lower accuracy.</span>
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
      {conflictOpen && (
        <ConflictResolver
          conflicts={conflicts}
          resolutions={resolutions}
          onChoose={chooseResolution}
          onApply={applyResolutions}
          onClose={() => setConflictOpen(false)}
        />
      )}
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
    { id: "defense", label: "Defense Room", icon: "Presentation" },
    { id: "documents", label: "Documents", icon: "FileText" },
    { id: "settings", label: "Settings", icon: "Settings" }
  ].filter(it => it.id !== "skills" || skillsUnlocked); // Skills stays hidden until unlocked in chat
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
  { id: "notes",              name: "Notes",                 icon: "StickyNote",     desc: "A markdown scratchpad you can search." },
  { id: "reading-queue",      name: "Reading Queue",         icon: "ListChecks",     desc: "Papers to read, and what you've finished." },
  { id: "pomodoro",           name: "Focus Timer",           icon: "Timer",          desc: "Pomodoro sessions with break cycles." },
  { id: "bibliography",       name: "Bibliography",          icon: "BookMarked",     desc: "References, with BibTeX export." },
  { id: "deadlines",          name: "Deadlines",             icon: "Calendar",       desc: "Countdowns to what's coming up." },
  { id: "funding",            name: "Funding",               icon: "Landmark",       desc: "Grants and fellowships you're chasing." },
  { id: "documenter",         name: "Daily Documenter",      icon: "FileEdit",       desc: "A date-stamped research journal." },
  { id: "writing-tracker",    name: "Writing Scratchpad",    icon: "PenTool",        desc: "Draft prose without leaving Home." },
  { id: "lit-matrix",         name: "Literature Matrix",     icon: "Table2",         desc: "Compare papers side by side." },
  { id: "outline-builder",    name: "Outline",               icon: "List",           desc: "Build the shape of a chapter." },
  { id: "meeting-prep",       name: "Meeting Agenda",        icon: "MessageSquare",  desc: "Agenda + action items for advisor meetings." },
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
// DASHBOARD HOME — four blocks: greeting → timeline → action card → sidebar
// ============================================================================
function greetWord() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Home dashboard — design option "3a" (decluttered): a single line of context
// under the greeting, then three blocks — Today, your plan, and the workspace
// tools. Nothing competes with Today. All of it is wired to live app state:
// the checklist is the current step's subtasks, the plan snapshot reads the
// roadmap, and the context line surfaces the soonest real deadline + next gate.
function Dashboard({ roadmap, onNav, onOpenSos, doneTasks, setDoneTasks, activity, onOpenStep, focused }) {
  const steps = roadmap.steps;
  const current = steps.find(s => s.status === "current") || steps.find(s => s.status === "redo") || steps[0];
  const curIdx = steps.indexOf(current);
  const dts = doneTasks || new Set();

  // --- Tools on Home (up to HOME_TOOLS_MAX), chosen in the Tools popup -------
  const [homeTools, setHomeTools] = useState(loadHomeTools);
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const meetWith = (window.ADVISORS && window.ADVISORS[0] && window.ADVISORS[0].name) || "your advisor";

  return (
    <div className="page dash-home">
      <div className="greeting" style={{ marginBottom: 18 }}>
        <h1 className="display">{greetWord()}, {window.MOCK_USER.name.split(" ")[0]}.</h1>
        <div className="dh-context">
          {nd
            ? <span><Icon name="Calendar" size={13} /> Nearest deadline — <b className="accent">{nd.label}, {ndText}</b></span>
            : <span><Icon name="Calendar" size={13} /> No deadlines logged — add them in your Workspace</span>}
          {nextGate && <><span className="dh-mid">·</span><span>Next gate: <b>{nextGate.title}</b>{nextGate.estimate ? ` · ${nextGate.estimate}` : ""}</span></>}
        </div>
      </div>

      {/* Big-screen only: glanceable stat tiles (hidden below 1500px via CSS) */}
      {!focused && (
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
            <div className="dh-stat-l accent">Today</div>
            <div className="dh-stat-n">{doneToday}<span className="dh-stat-unit">/{todo.length} tasks</span></div>
            <div className="dh-stat-s">on {current.title}</div>
          </div>
          <div className="dh-stat">
            <div className="dh-stat-l sage">Next meeting</div>
            <div className="dh-stat-nm">{meetWith}</div>
            <div className="dh-stat-s">Prep doc is ready to send</div>
          </div>
        </div>
      )}

      <div className="dh-row">
        {/* TODAY */}
        <div className="dh-card dh-today">
          <div className="dh-card-head">
            <span className="dh-eyebrow accent">Today</span>
            <span className="dh-count">{doneToday} of {todo.length} done</span>
          </div>
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

        {/* YOUR PLAN */}
        <div className="dh-card dh-plan">
          <div className="dh-card-head"><span className="dh-eyebrow">Your plan</span></div>
          <div className="dh-track">
            <div className="dh-rail">
              {prevDone && <><span className="dh-node done"><Icon name="Check" size={10} color="#fff" /></span><span className="dh-line done" /></>}
              <span className="dh-node cur" />
              {next && <><span className="dh-line" /><span className="dh-node locked" /></>}
            </div>
            <div className="dh-track-body">
              {prevDone && <div className="dh-mile"><div className="dh-mile-t">{prevDone.title}</div><div className="dh-mile-s">Done</div></div>}
              <div className="dh-mile-cur">
                <div className="dh-mile-cur-t">{current.title}</div>
                <div className="dh-bar"><span style={{ width: `${Math.max(6, curPct)}%` }} /></div>
                <div className="dh-mile-s">{curHint}</div>
              </div>
              {next && (
                <div className="dh-mile">
                  <div className="dh-mile-t">{next.title} {next.gate && <span className="dh-gate">GATE</span>}</div>
                  <div className="dh-mile-s">{next.estimate || "Up next"}</div>
                </div>
              )}
            </div>
          </div>
          <div className="dh-plan-actions">
            <button className="btn primary" onClick={goStep}>Continue this step <Icon name="ArrowRight" size={14} color="#fff" /></button>
            <button className="btn" onClick={() => onNav("plan")}>Full plan</button>
          </div>
        </div>
      </div>

      {/* WORKSPACE TOOLS — the student's live tools, up to HOME_TOOLS_MAX.
          These are the app's real tools via window.renderTool, so they persist
          and stay fully functional; "All tools" opens the Tools popup, which is
          where tools are added and removed. There is no separate Tools page. */}
      {!focused && window.renderTool && (
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
          {toolsOpen && (
            <ToolsPopup selected={homeToolIds} onToggle={toggleTool} onClose={() => setToolsOpen(false)} />
          )}
        </>
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
