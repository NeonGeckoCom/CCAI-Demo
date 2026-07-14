/* ============================================================================
   roadmap-engine.js — Dynamic PhD Roadmap engine
   ----------------------------------------------------------------------------
   This file is the "sudo-code framework" for the backend AI model that:
     1. takes a student's PROGRAM + DELIVERABLES (discovered online via Perplexity),
     2. figures out WHERE THEY ARE today,
     3. generates a DYNAMIC, personalized roadmap (a Lego-style instruction manual),
     4. tracks progress against the deliverables and celebrates milestones,
     5. RE-PLANS when something goes wrong (a step fails / data rejected / scope cut).

   Everything that would be a network/LLM call in production is written as a
   clearly-marked async function with a deterministic MOCK fallback so the
   prototype runs offline. Search for `BACKEND:` to find every integration point.

   It exposes a single global: window.RoadmapEngine
   ============================================================================ */

(function () {
  // --------------------------------------------------------------------------
  // FEATURE CATALOG
  // Every tool/widget the app can surface. The roadmap turns these on and off
  // per milestone — that is the heart of "what features are shown / removed /
  // added" the product spec asks for.
  // --------------------------------------------------------------------------
  const FEATURES = {
    "topic-explorer":    { name: "Topic Explorer",        icon: "Lightbulb",     blurb: "Brainstorm & narrow candidate research questions." },
    "advisor-matcher":   { name: "Advisor Matcher",       icon: "Users",         blurb: "Rank faculty whose work overlaps your topic." },
    "feasibility-check": { name: "Feasibility Check",      icon: "Crosshair",     blurb: "Is this question doable in your timeline?" },
    "lit-matrix":        { name: "Literature Matrix",      icon: "BookOpen",      blurb: "Track every paper: claim, method, gap." },
    "gap-finder":        { name: "Gap Finder",             icon: "Search",        blurb: "Surfaces the hole your work fills." },
    "reading-queue":     { name: "Reading Queue",          icon: "ListChecks",    blurb: "Prioritized papers to read next." },
    "bibliography":      { name: "Bibliography",           icon: "BookMarked",    blurb: "Citations + BibTeX export." },
    "proposal-builder":  { name: "Proposal Builder",       icon: "FileText",      blurb: "Draft & structure your prelim proposal." },
    "prelim-prep":       { name: "Prelim Prep",            icon: "ClipboardCheck",blurb: "Mock questions + reading list." },
    "irb-protocol":      { name: "IRB Protocol Builder",   icon: "ShieldCheck",   blurb: "Consent, recruitment, submission packet." },
    "methods-designer":  { name: "Methods Designer",       icon: "FlaskConical",  blurb: "Lock unit of analysis, design, power." },
    "data-tracker":      { name: "Data Collection Tracker",icon: "Database",      blurb: "Monitor collection against your plan." },
    "pilot-checklist":   { name: "Pilot Checklist",        icon: "ListTodo",      blurb: "De-risk before full collection." },
    "analysis-pipeline": { name: "Analysis Pipeline",      icon: "GitBranch",     blurb: "Versioned, reproducible analysis steps." },
    "viz-studio":        { name: "Figure Studio",          icon: "BarChart3",     blurb: "Grayscale-safe, caption-first figures." },
    "writing-tracker":   { name: "Writing Tracker",        icon: "PenTool",       blurb: "Daily word goals + streak heatmap." },
    "outline-builder":   { name: "Outline Builder",        icon: "List",          blurb: "Chapter/section scaffolding." },
    "latex-pad":         { name: "LaTeX Scratchpad",       icon: "Sigma",         blurb: "Live-render equations." },
    "reviewer-2":        { name: "Reviewer 2",             icon: "Gavel",         blurb: "Harsh peer-review-style critique." },
    "defense-deck":      { name: "Defense Deck Builder",   icon: "Presentation",  blurb: "Slides + speaker notes." },
    "qa-simulator":      { name: "Q&A Simulator",          icon: "MessageSquare", blurb: "Hardest committee questions." },
    "formatting-check":  { name: "Formatting Checker",     icon: "ClipboardCheck",blurb: "Margins, fonts, ToC vs. grad-school rules." },
    "proquest-checklist":{ name: "ProQuest Checklist",     icon: "UploadCloud",   blurb: "Final submission packet." },
    "meeting-prep":      { name: "Meeting Agenda",         icon: "CalendarClock", blurb: "Agenda + asks for each 1:1." },
    "conference-tracker":{ name: "Conference Tracker",     icon: "Send",          blurb: "CFP deadlines + travel funding." },
    "pomodoro":          { name: "Focus Timer",            icon: "Timer",         blurb: "Pomodoro work cycles." },
    "burnout-check":     { name: "Well-being Check-in",    icon: "Heart",         blurb: "Catch burnout before it catches you." }
  };

  // --------------------------------------------------------------------------
  // MILESTONE LIBRARY
  // The superset of milestones. generateRoadmap() selects/orders/personalizes
  // these. Each milestone declares the FEATURES it adds and retires — that
  // lifecycle is what makes the UI feel like it's "getting out of your way."
  // `phase` groups milestones; `gate` marks the standard PhD checkpoints.
  // --------------------------------------------------------------------------
  const MILESTONES = [
    {
      id: "orientation", phase: "Start", title: "Get Oriented", icon: "Compass",
      objective: "Set up your workspace and understand what your program actually requires of you.",
      estimate: "Week 1", gate: false,
      subtasks: [
        "Upload your PhD handbook",
        "Confirm credit + residency requirements",
        "Skim the deliverables we found for your program"
      ],
      add: ["meeting-prep", "burnout-check"], retire: []
    },
    {
      id: "topic-ideas", phase: "Topic", title: "Shape a Topic", icon: "Lightbulb",
      objective: "Go from a broad area to one defensible, doable research question.",
      estimate: "Weeks 2–8", gate: false,
      subtasks: [
        "Draft 3 candidate questions",
        "Pressure-test each for feasibility + data access",
        "Pick one with your chair's sign-off"
      ],
      add: ["topic-explorer", "feasibility-check"], retire: []
    },
    {
      id: "committee", phase: "Topic", title: "Build Your Committee", icon: "Users",
      objective: "Recruit a chair (and co-chair?) plus members whose expertise covers your methods.",
      estimate: "By end of Y2", gate: true,
      subtasks: [
        "Shortlist 6–8 aligned faculty",
        "Decide single chair vs. co-chair",
        "Confirm at least one outside member"
      ],
      add: ["advisor-matcher"], retire: []
    },
    {
      id: "literature", phase: "Literature", title: "Own the Literature", icon: "BookOpen",
      objective: "Build a defensible map of the field and name the exact gap you fill.",
      estimate: "Y2–Y3", gate: false,
      subtasks: [
        "Log the 20 most-cited papers in your gap",
        "Maintain a single literature matrix",
        "Write the gap statement in 3 sentences"
      ],
      add: ["lit-matrix", "gap-finder", "reading-queue", "bibliography"], retire: ["topic-explorer", "feasibility-check", "advisor-matcher"]
    },
    {
      id: "proposal", phase: "Proposal", title: "Write the Proposal", icon: "FileText",
      objective: "Turn your gap + plan into a proposal your committee will approve.",
      estimate: "Y2–Y3", gate: true,
      subtasks: [
        "Draft aims + hypotheses",
        "Map each aim to a method",
        "Circulate to committee 3 weeks ahead"
      ],
      add: ["proposal-builder", "methods-designer", "reviewer-2"], retire: ["gap-finder"]
    },
    {
      id: "prelim", phase: "Proposal", title: "Pass the Preliminary Exam", icon: "ClipboardCheck",
      objective: "Defend your direction and prove you've absorbed the field.",
      estimate: "End of Y2", gate: true,
      subtasks: [
        "Circulate reading list 6 weeks ahead",
        "Mock the oral with peers",
        "Schedule with the full committee"
      ],
      add: ["prelim-prep", "qa-simulator"], retire: ["proposal-builder"]
    },
    {
      id: "candidacy", phase: "Proposal", title: "Advance to Candidacy", icon: "Award",
      objective: "Make it official — file the paperwork that confirms you're ABD and cleared for research.",
      estimate: "After prelim", gate: true,
      subtasks: [
        "Confirm coursework + residency requirements are met",
        "File candidacy paperwork with the graduate school",
        "Verify your committee is officially registered"
      ],
      add: [], retire: []
    },
    {
      id: "irb", phase: "Methods", title: "Clear IRB", icon: "ShieldCheck",
      objective: "Get human-subjects approval before a single data point is collected.",
      estimate: "Before collection", gate: false,
      subtasks: [
        "Upload your institution's IRB process",
        "Draft consent + recruitment materials",
        "Submit ≥8 weeks before planned start"
      ],
      add: ["irb-protocol"], retire: ["prelim-prep", "qa-simulator"]
    },
    {
      id: "pilot", phase: "Methods", title: "Run a Pilot", icon: "ListTodo",
      objective: "De-risk your protocol on a tiny sample before committing months.",
      estimate: "2–4 weeks", gate: false,
      subtasks: [
        "Run 1 week of pilot collection",
        "Check the analysis pipeline end-to-end on pilot data",
        "Adjust protocol + re-submit IRB amendment if needed"
      ],
      add: ["pilot-checklist", "data-tracker", "analysis-pipeline"], retire: ["irb-protocol"]
    },
    {
      id: "collection", phase: "Data", title: "Collect Your Data", icon: "Database",
      objective: "Execute the protocol and keep collection aligned to plan, weekly.",
      estimate: "Y3–Y4", gate: true,
      subtasks: [
        "Collect against your target N",
        "Log every deviation in a research journal",
        "Hold weekly 30-min check-ins with chair"
      ],
      add: [], retire: ["pilot-checklist", "methods-designer"]
    },
    {
      id: "analysis", phase: "Data", title: "Analyze & Visualize", icon: "BarChart3",
      objective: "Turn raw data into defensible results and grayscale-safe figures.",
      estimate: "Y4", gate: false,
      subtasks: [
        "Freeze the analysis pipeline + commit the script",
        "One chart per finding — test in grayscale",
        "Write captions that stand alone"
      ],
      add: ["viz-studio"], retire: ["data-tracker"]
    },
    {
      id: "writing", phase: "Writing", title: "Write the Dissertation", icon: "PenTool",
      objective: "Draft, structure, and revise the document — chapters first, intro last.",
      estimate: "Y4–Y5", gate: false,
      subtasks: [
        "Adopt institutional formatting from day one",
        "Hit a daily word floor",
        "Send chapters to chair on a fixed cadence"
      ],
      add: ["writing-tracker", "outline-builder", "latex-pad"], retire: ["analysis-pipeline"]
    },
    {
      id: "defense", phase: "Defense", title: "Defend", icon: "Presentation",
      objective: "Build the talk, rehearse, and walk in expecting a conversation.",
      estimate: "End of Y5", gate: true,
      subtasks: [
        "Build a 25-min talk (~20 slides)",
        "Mock the defense twice",
        "Prep a 1-page handout of key figures"
      ],
      add: ["defense-deck", "qa-simulator"], retire: ["viz-studio", "reviewer-2"]
    },
    {
      id: "submission", phase: "Submission", title: "Submit the Dissertation", icon: "UploadCloud",
      objective: "Format, sign, and upload your finished dissertation. The last 5% nobody warns you about.",
      estimate: "After defense", gate: true,
      subtasks: [
        "Final format pass vs. grad-school template",
        "Collect committee + dean signatures",
        "Upload final PDF to ProQuest + repository"
      ],
      add: ["formatting-check", "proquest-checklist"], retire: ["writing-tracker", "outline-builder", "latex-pad", "defense-deck", "qa-simulator"]
    }
  ];

  // Optional milestones woven in based on workflow prefs (write-as-you-go, publishing track…)
  const OPTIONAL_MILESTONES = {
    "write-as-you-go": {
      id: "early-writing", phase: "Writing", title: "Write As You Go", icon: "PenTool",
      objective: "Capture methods + lit prose now, while it's fresh — not all at the end.",
      estimate: "Ongoing from Y2", gate: false, afterId: "literature",
      subtasks: ["Draft the methods section during collection", "Keep a running related-work doc", "Bank 250 words/day"],
      add: ["writing-tracker", "outline-builder"], retire: []
    },
    "publish-track": {
      id: "first-paper", phase: "Data", title: "Ship a First Paper", icon: "Send",
      objective: "Carve a publishable unit out of Aim 1 and submit to a venue.",
      estimate: "Y3–Y4", gate: false, afterId: "analysis",
      subtasks: ["Pick a target venue + deadline", "Reframe Aim 1 as a standalone paper", "Submit + track reviews"],
      add: ["conference-tracker"], retire: []
    }
  };

  // --------------------------------------------------------------------------
  // PROGRAM → DELIVERABLES  (BACKEND: Perplexity online search)
  // In production this is a live web search. Mocked here with a small DB +
  // a generic fallback so any typed program returns something sensible.
  // --------------------------------------------------------------------------
  const PROGRAM_DB = {
    "information science": {
      degree: "PhD, Information Science",
      deliverables: [
        { name: "Program of Study form", when: "Year 1", source: "Graduate School handbook" },
        { name: "Comprehensive examination", when: "End of Y2", source: "Department PhD guide" },
        { name: "Dissertation proposal defense", when: "Y2–Y3", source: "Department PhD guide" },
        { name: "IRB approval (human subjects)", when: "Before collection", source: "Institutional IRB" },
        { name: "Dissertation + oral defense", when: "Y5", source: "Graduate School handbook" },
        { name: "Final dissertation submission", when: "After defense", source: "Graduate School" }
      ]
    },
    "neuroscience": {
      degree: "PhD, Neuroscience",
      deliverables: [
        { name: "Lab rotations (3)", when: "Year 1", source: "Program timeline" },
        { name: "Qualifying exam", when: "End of Y2", source: "Program handbook" },
        { name: "Thesis proposal / committee meeting", when: "Y2–Y3", source: "Program handbook" },
        { name: "IACUC/IRB protocol approval", when: "Before experiments", source: "Institutional review" },
        { name: "Annual committee meetings", when: "Yearly", source: "Program handbook" },
        { name: "Dissertation defense + ProQuest", when: "Y5–Y6", source: "Graduate School" }
      ]
    }
  };

  function genericDeliverables(programText) {
    return {
      degree: programText || "PhD program",
      deliverables: [
        { name: "Plan / program of study", when: "Year 1", source: "Perplexity · web search" },
        { name: "Qualifying / comprehensive exam", when: "End of Y2", source: "Perplexity · web search" },
        { name: "Dissertation proposal defense", when: "Y2–Y3", source: "Perplexity · web search" },
        { name: "Ethics / IRB approval", when: "Before collection", source: "Perplexity · web search" },
        { name: "Dissertation + oral defense", when: "Final year", source: "Perplexity · web search" },
        { name: "Final repository submission", when: "After defense", source: "Perplexity · web search" }
      ]
    };
  }

  const DISCOVERY_PATTERNS = [
    { name: "Plan / program of study", when: "Year 1", re: /\b(program|plan) of study\b|\bdegree plan\b|\bstudy plan\b/i },
    { name: "Coursework / credit requirements", when: "Years 1-2", re: /\b(coursework|course requirements|required credits|credit hours|core courses)\b/i },
    { name: "Lab rotations", when: "Year 1", re: /\b(lab )?rotations?\b|\brotation reports?\b/i },
    { name: "Advisor / committee selection", when: "Year 1-2", re: /\b(select|choose|appoint|form).{0,60}\b(advisor|supervisor|committee|chair)\b|\bdoctoral committee\b/i },
    { name: "Annual review / progress report", when: "Yearly", re: /\bannual (review|progress|evaluation)\b|\bprogress report\b|\byearly committee\b/i },
    { name: "Qualifying / comprehensive exam", when: "End of Year 2", re: /\b(qualifying|comprehensive|preliminary|prelim|candidacy) exam(?:ination)?\b|\bquals\b|\bcomps\b/i },
    { name: "Dissertation proposal / prospectus", when: "Years 2-3", re: /\b(dissertation|thesis) (proposal|prospectus)\b|\bproposal defense\b|\bdefend.{0,40}(proposal|prospectus)\b/i },
    { name: "Advance to candidacy", when: "After exam/proposal", re: /\badvance(d)? to candidacy\b|\badmission to candidacy\b|\bcandidacy form\b/i },
    { name: "Ethics / IRB approval", when: "Before data collection", re: /\b(IRB|IACUC|human subjects|ethics approval|research ethics|institutional review)\b/i },
    { name: "Teaching / TA requirement", when: "During enrollment", re: /\b(teaching|TA|teaching assistant|pedagogy) requirement\b/i },
    { name: "Dissertation writing", when: "Final phase", re: /\bwrite .{0,40}(dissertation|thesis)\b|\bdissertation chapters?\b|\bthesis chapters?\b/i },
    { name: "Dissertation defense / oral exam", when: "Final year", re: /\b(dissertation|thesis) defense\b|\boral defense\b|\bfinal oral\b|\bfinal examination\b/i },
    { name: "Final dissertation submission", when: "After defense", re: /\b(final|submit|submission|deposit).{0,60}\b(dissertation|thesis)\b|\bProQuest\b|\brepository submission\b|\bgraduate school submission\b/i }
  ];

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function delayResult(result, ms) {
    return new Promise((resolve) => setTimeout(() => resolve(result), ms));
  }

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSource(value, fallback) {
    const source = cleanText(value || fallback);
    return source.length > 80 ? source.slice(0, 77) + "..." : source;
  }

  function formatWhen(value) {
    const cleaned = cleanText(value);
    return /^y\s*\d/i.test(cleaned) ? cleaned.replace(/^y/i, "Year ") : cleaned;
  }

  function inferWhen(evidence, fallback, anchorPattern) {
    const text = cleanText(evidence);
    const timeRe = /\b(end of )?y(?:ear)?\s*[1-7](?:\s*[-–]\s*(?:y|year)?\s*[1-7])?\b|\b(years?|semesters?)\s*[1-7](?:\s*[-–]\s*[1-7])?\b|\b(final year|yearly|annually|before [a-z ]{3,36}|after [a-z ]{3,36}|prior to [a-z ]{3,36}|no later than [a-z ]{3,36})\b/ig;
    let anchor = 0;
    if (anchorPattern) {
      anchorPattern.lastIndex = 0;
      const anchorMatch = anchorPattern.exec(text);
      anchor = anchorMatch ? anchorMatch.index + Math.floor(anchorMatch[0].length / 2) : 0;
      anchorPattern.lastIndex = 0;
    }
    const matches = [];
    let match;
    while ((match = timeRe.exec(text)) !== null) {
      matches.push({
        value: formatWhen(match[0]),
        index: match.index + Math.floor(match[0].length / 2)
      });
    }
    if (!matches.length) return fallback;
    const score = (item) => Math.abs(item.index - anchor) + (item.index < anchor ? 45 : 0);
    matches.sort((a, b) => score(a) - score(b));
    return matches[0].value;
  }

  function evidenceFragments(text) {
    const lines = (text || "").split(/\r?\n+/).map(cleanText).filter(s => s.length >= 12 && s.length <= 500);
    const sentences = ((text || "").match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [])
      .map(cleanText)
      .filter(s => s.length >= 12 && s.length <= 500);
    return [...lines, ...sentences].slice(0, 700);
  }

  function dedupeDeliverables(deliverables) {
    const seen = new Set();
    return (deliverables || []).filter((item) => {
      const key = cleanText(item.name).toLowerCase().replace(/[^a-z0-9]+/g, " ");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }

  function normalizeDiscoveryResult(result, { program, institution, mode, defaultSource }) {
    const out = result ? clone(result) : genericDeliverables(program);
    out.degree = out.degree || program || "PhD program";
    out.institution = out.institution || institution || "your institution";
    out.discoveryMode = out.discoveryMode || mode || "fallback";
    const sourceFallback = out.extractionMethod === "llm_direct_plan" ? "" : (defaultSource || "Discovery result");
    out.deliverables = dedupeDeliverables((out.deliverables || []).map((item) => ({
      name: cleanText(item.name),
      when: cleanText(item.when) || (out.extractionMethod === "llm_direct_plan" ? "" : "Program-specific"),
      source: normalizeSource(item.source, sourceFallback)
    })));
    if (Array.isArray(out.steps)) out.steps = normalizeGeneratedSteps(out.steps);
    return out;
  }

  function normalizeToolIds(ids) {
    const raw = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    return raw.map(cleanText).filter(id => FEATURES[id]);
  }

  function normalizeGeneratedSteps(steps) {
    const used = new Set();
    return (steps || []).map((step, index) => {
      const title = cleanText(step.title || step.name);
      const subtasks = (Array.isArray(step.subtasks) ? step.subtasks : [])
        .map(cleanText)
        .filter(Boolean)
        .slice(0, 8);
      if (!title || subtasks.length === 0) return null;
      const source = cleanText(step.source || step.deliverableSource);
      const node = {
        id: uniqueStepId(`handbook-${title || index + 1}`, used),
        phase: cleanText(step.phase),
        title,
        icon: cleanText(step.icon) || "Flag",
        objective: cleanText(step.objective),
        estimate: cleanText(step.estimate || step.when),
        gate: step.gate !== false,
        deliverable: cleanText(step.deliverable || title),
        deliverableSource: source,
        source,
        handbookDerived: true,
        subtasks,
        add: normalizeToolIds(step.add || step.tools || step.toolIds || step.tool_ids),
        retire: normalizeToolIds(step.retire),
        status: "locked"
      };
      return node;
    }).filter(Boolean);
  }

  function localTemplateDeliverables(program, institution) {
    const key = (program || "").toLowerCase();
    let hit = null;
    for (const k of Object.keys(PROGRAM_DB)) if (key.includes(k)) hit = PROGRAM_DB[k];
    const result = hit ? clone(hit) : genericDeliverables(program);
    result.discoveryMode = "fallback";
    result.deliverables = (result.deliverables || []).map(d => ({
      ...d,
      source: /perplexity|web search/i.test(d.source || "") ? "Built-in milestone template" : d.source
    }));
    return normalizeDiscoveryResult(result, {
      program,
      institution,
      mode: "fallback",
      defaultSource: "Built-in milestone template"
    });
  }

  function parseMaterialsForDeliverables({ program, institution, materials }) {
    const chunks = (materials || [])
      .map(m => ({ name: m.name || "Uploaded material", text: cleanText(m.text || "") }))
      .filter(m => m.text.length > 0);

    if (!chunks.length) return null;

    const deliverables = [];
    chunks.forEach((chunk) => {
      const fragments = evidenceFragments(chunk.text);
      DISCOVERY_PATTERNS.forEach((pattern) => {
        const hit = fragments.find(f => pattern.re.test(f));
        if (!hit && !pattern.re.test(chunk.text)) return;
        let when = inferWhen(hit || chunk.text, pattern.when, pattern.re);
        if (pattern.name === "Dissertation defense / oral exam" && /^after\b/i.test(when)) when = pattern.when;
        deliverables.push({
          name: pattern.name,
          when,
          source: chunk.name
        });
      });
    });

    if (!deliverables.length) {
      const fallback = localTemplateDeliverables(program, institution);
      fallback.discoveryMode = "fallback";
      return fallback;
    }

    return normalizeDiscoveryResult({
      degree: program || "PhD program",
      institution: institution || "your institution",
      discoveryMode: "documents",
      deliverables
    }, {
      program,
      institution,
      mode: "documents",
      defaultSource: "Uploaded material"
    });
  }

  function backendBase() {
    if (window.CoachAPI && window.CoachAPI.base) return window.CoachAPI.base();
    const configured = (window.PHD_API_BASE || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    if (window.location && /^https?:$/.test(window.location.protocol)) {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
    return "http://localhost:8000";
  }

  function normalizeBackendBase(value) {
    return cleanText(value).replace(/\/+$/, "");
  }

  function backendCandidates() {
    const seen = new Set();
    const out = [];
    const add = (value) => {
      const base = normalizeBackendBase(value);
      if (base && !seen.has(base)) {
        seen.add(base);
        out.push(base);
      }
    };
    add(backendBase());
    if (window.location && /^https?:$/.test(window.location.protocol)) {
      const proto = window.location.protocol;
      const host = window.location.hostname;
      add(`${proto}//${host}:8000`);
      if (host === "localhost") add(`${proto}//127.0.0.1:8000`);
      if (host === "127.0.0.1") add(`${proto}//localhost:8000`);
    }
    add("http://localhost:8000");
    add("http://127.0.0.1:8000");
    return out;
  }

  function isNetworkFetchError(error) {
    const message = String(error?.message || "");
    return error?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(message);
  }

  function materialHasFile(materials) {
    return (materials || []).some(m => m && m.file);
  }

  function serializableMaterials(materials) {
    return (materials || []).map(m => ({
      kind: m.kind || "text",
      name: m.name || "Uploaded material",
      type: m.type || "",
      size: m.size || 0,
      text: m.text || ""
    }));
  }

  function serializableTools() {
    return Object.entries(FEATURES).map(([id, feature]) => ({
      id,
      name: feature.name || id,
      blurb: feature.blurb || ""
    }));
  }

  function buildDiscoveryRequest({ program, institution, materials }) {
    const token = window.CoachAPI && window.CoachAPI.token ? window.CoachAPI.token() : null;
    const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
    const hasFiles = materialHasFile(materials);
    if (!hasFiles) {
      return {
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ program, institution, materials: serializableMaterials(materials), tools: serializableTools() })
      };
    }

    const form = new FormData();
    form.append("program", program || "");
    form.append("institution", institution || "");
    form.append("materials", JSON.stringify(serializableMaterials(materials)));
    form.append("tools", JSON.stringify(serializableTools()));
    (materials || []).forEach((material) => {
      if (material && material.file) {
        form.append("files", material.file, material.name || material.file.name || "uploaded-file");
      }
    });
    return { headers: authHeaders, body: form };
  }

  async function fetchOnlineDeliverables({ program, institution, materials = [] }) {
    if (!window.fetch) return null;
    const hasMaterials = (materials || []).length > 0;
    const controller = window.AbortController ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 180000) : null;
    const request = buildDiscoveryRequest({ program, institution, materials });
    let lastNetworkError = null;
    try {
      for (const base of backendCandidates()) {
        try {
          const response = await fetch(`${base}/api/discover-deliverables`, {
            method: "POST",
            ...request,
            signal: controller ? controller.signal : undefined
          });
          if (!response.ok) {
            if (!hasMaterials) return null;
            let detail = "";
            try {
              const err = await response.json();
              detail = err && (err.detail || err.message);
            } catch (e) {}
            const error = new Error(detail || "The handbook plan generator could not complete.");
            error.status = response.status;
            throw error;
          }
          const result = await response.json();
          if (!result || !Array.isArray(result.deliverables) || result.deliverables.length === 0) {
            if (hasMaterials) throw new Error("The handbook plan generator returned no milestones.");
            return null;
          }
          return normalizeDiscoveryResult(result, {
            program,
            institution,
            mode: "web",
            defaultSource: "Public web search"
          });
        } catch (e) {
          if (isNetworkFetchError(e) && !(controller && controller.signal && controller.signal.aborted)) {
            lastNetworkError = e;
            continue;
          }
          if (hasMaterials) throw e;
          return null;
        }
      }
      if (lastNetworkError && hasMaterials) {
        const error = new Error("Could not reach the backend on port 8000. Make sure the backend is running, then hard-refresh. If you set a custom API base, clear localStorage['phd-api-base'].");
        error.status = 0;
        throw error;
      }
      return null;
    } catch (e) {
      if (hasMaterials) throw e;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function discoverDeliverables({ program, institution, materials = [] }) {
    const hasMaterials = (materials || []).length > 0;

    let online = null;
    try {
      online = await fetchOnlineDeliverables({ program, institution, materials });
    } catch (e) {
      // A handbook plan can only come from the backend — nothing local can read
      // the file. But an unreachable backend used to dead-end onboarding, so we
      // now degrade to the built-in template and say so loudly (`degradedReason`
      // is rendered as a warning, and discoveryMode stays "fallback" so the UI
      // never claims the handbook was parsed).
      //
      // Only a genuinely unreachable backend (status 0) degrades. A real HTTP
      // failure — expired session (401), unreadable handbook — must still throw,
      // or the student would silently get a plan that ignored their upload.
      if (!hasMaterials || e?.status !== 0) throw e;
      const local = await delayResult(localTemplateDeliverables(program, institution), 400);
      local.degradedReason = "We couldn't reach the plan generator, so your handbook was not read. This is the built-in template for your program — treat every milestone as a guess. Your upload is saved in Documents; start the backend and rebuild the plan to personalise it.";
      return local;
    }
    if (online) return online;

    // Backend answered but produced nothing usable from the handbook — that is a
    // real parsing failure, not an outage, so keep surfacing it.
    if (hasMaterials) throw new Error("The handbook plan generator is unavailable. No local fallback plan was created.");

    return delayResult(localTemplateDeliverables(program, institution), 650);
  }

  // --------------------------------------------------------------------------
  // START POSITIONS — where the student is today. Determines which milestones
  // are pre-completed when the roadmap is generated.
  // --------------------------------------------------------------------------
  const START_POSITIONS = [
    { id: "just-starting",      label: "Just starting",                  completedThrough: null },
    { id: "coursework",         label: "Coursework / exploration",       completedThrough: "orientation" },
    { id: "prelims",            label: "Preparing for prelims / quals",  completedThrough: "proposal" },
    { id: "committee-proposal", label: "Forming committee / proposal",   completedThrough: "topic-ideas" },
    { id: "researching",        label: "Conducting research",            completedThrough: "pilot" },
    { id: "writing-up",         label: "Writing dissertation",           completedThrough: "analysis" }
  ];

  const DELIVERABLE_RULES = [
    {
      key: "program-study", templateId: "orientation", phase: "Start", icon: "ClipboardList", gate: true,
      re: /\b(program|plan) of study\b|\bdegree plan\b|\bstudy plan\b/i,
      objective: (name) => `File or confirm the official ${name} exactly as your program requires it.`,
      subtasks: (name, source) => [
        `Find the exact ${name} wording in ${source}`,
        "List every credit, residency, and approval condition attached to it",
        "Confirm the form or plan with your advisor or graduate office"
      ],
      add: ["meeting-prep", "burnout-check"], retire: []
    },
    {
      key: "coursework", templateId: "orientation", phase: "Start", icon: "BookOpen", gate: true,
      re: /\b(coursework|course requirements|required credits|credit hours|core courses)\b/i,
      objective: (name) => `Complete the coursework and credit rules named in your program materials: ${name}.`,
      subtasks: (name, source) => [
        `Extract the required courses and credits from ${source}`,
        "Map remaining courses to terms without overloading dissertation work",
        "Check prerequisites, minimum grades, and transfer or waiver rules"
      ],
      add: ["meeting-prep"], retire: []
    },
    {
      key: "rotations", templateId: "topic-ideas", phase: "Start", icon: "RefreshCw", gate: true,
      re: /\b(lab )?rotations?\b|\brotation reports?\b/i,
      objective: () => "Finish the required rotation sequence and use it to choose a viable research home.",
      subtasks: (name, source) => [
        `Confirm the rotation count, timing, and evaluation rule in ${source}`,
        "Schedule rotations with faculty whose methods fit your interests",
        "Document what each rotation teaches you about fit, data, and mentoring"
      ],
      add: ["topic-explorer", "advisor-matcher"], retire: []
    },
    {
      key: "committee", templateId: "committee", phase: "Topic", icon: "Users", gate: true,
      re: /\b(advisor|supervisor|committee|chair|doctoral committee)\b/i,
      objective: (name) => `Form the advising structure your handbook requires: ${name}.`,
      subtasks: (name, source) => [
        `Read the membership, chair, and outside-member rules in ${source}`,
        "Shortlist people who cover topic, method, and institutional requirements",
        "Confirm appointments and file any required committee paperwork"
      ],
      add: ["advisor-matcher", "meeting-prep"], retire: []
    },
    {
      key: "annual-review", templateId: "committee", phase: "Progress", icon: "CalendarCheck", gate: false,
      re: /\bannual (review|progress|evaluation)\b|\bprogress report\b|\byearly committee\b/i,
      objective: (name) => `Prepare the recurring progress checkpoint required by your program: ${name}.`,
      subtasks: (name, source) => [
        `Confirm the cadence, format, and signer rules in ${source}`,
        "Collect evidence of coursework, research, teaching, and milestones",
        "Turn committee feedback into the next version of the plan"
      ],
      add: ["meeting-prep"], retire: []
    },
    {
      key: "qualifying-exam", templateId: "prelim", phase: "Proposal", icon: "ClipboardCheck", gate: true,
      re: /\b(qualifying|comprehensive|preliminary|prelim|candidacy) exam(?:ination)?\b|\bquals\b|\bcomps\b/i,
      objective: (name) => `Prepare for and pass the exam requirement named in your handbook: ${name}.`,
      subtasks: (name, source) => [
        `Confirm exam format, timing, committee rules, and retake policy in ${source}`,
        "Build the reading list or study scope around the handbook language",
        "Schedule mock questions before the official exam window"
      ],
      add: ["prelim-prep", "qa-simulator"], retire: ["topic-explorer", "feasibility-check", "advisor-matcher"]
    },
    {
      key: "proposal", templateId: "proposal", phase: "Proposal", icon: "FileText", gate: true,
      re: /\b(dissertation|thesis) (proposal|prospectus)\b|\bproposal defense\b|\bdefend.{0,40}(proposal|prospectus)\b|\bprospectus\b/i,
      objective: (name) => `Write and defend the proposal milestone your program requires: ${name}.`,
      subtasks: (name, source) => [
        `Check proposal format, timing, and circulation rules in ${source}`,
        "Map each research aim to method, data, and committee expertise",
        "Send the draft early enough to satisfy the handbook timeline"
      ],
      add: ["proposal-builder", "methods-designer", "reviewer-2"], retire: ["gap-finder"]
    },
    {
      key: "candidacy", templateId: "candidacy", phase: "Proposal", icon: "Award", gate: true,
      re: /\badvance(d)? to candidacy\b|\badmission to candidacy\b|\bcandidacy form\b/i,
      objective: () => "Complete the candidacy paperwork and status change required by your program.",
      subtasks: (name, source) => [
        `Confirm the candidacy trigger and form requirements in ${source}`,
        "Verify coursework, exams, proposal, and committee records are complete",
        "File the candidacy form and save confirmation"
      ],
      add: [], retire: []
    },
    {
      key: "irb", templateId: "irb", phase: "Methods", icon: "ShieldCheck", gate: true,
      re: /\b(IRB|IACUC|human subjects|ethics approval|research ethics|institutional review)\b/i,
      objective: () => "Secure the required ethics or protocol approval before collecting usable data.",
      subtasks: (name, source) => [
        `Confirm whether ${name} applies to your project using ${source}`,
        "Draft consent, recruitment, instrument, and data-management materials",
        "Wait for approval before collecting dissertation data"
      ],
      add: ["irb-protocol", "methods-designer"], retire: ["prelim-prep", "qa-simulator"]
    },
    {
      key: "teaching", templateId: "orientation", phase: "Professional", icon: "Presentation", gate: true,
      re: /\b(teaching|TA|teaching assistant|pedagogy) requirement\b/i,
      objective: (name) => `Plan and complete the teaching requirement in your program materials: ${name}.`,
      subtasks: (name, source) => [
        `Confirm teaching load, eligible roles, and documentation in ${source}`,
        "Place teaching terms around exams, proposal, and data collection",
        "Save appointment or completion evidence for annual review"
      ],
      add: ["meeting-prep"], retire: []
    },
    {
      key: "writing", templateId: "writing", phase: "Writing", icon: "PenTool", gate: false,
      re: /\bwrite .{0,40}(dissertation|thesis)\b|\bdissertation chapters?\b|\bthesis chapters?\b|\bdissertation writing\b/i,
      objective: () => "Draft and revise the dissertation writing milestone described by your program.",
      subtasks: (name, source) => [
        `Check chapter, formatting, and review expectations in ${source}`,
        "Set a chapter delivery cadence with your chair",
        "Keep formatting aligned with graduate school rules from the first draft"
      ],
      add: ["writing-tracker", "outline-builder", "latex-pad"], retire: ["analysis-pipeline"]
    },
    {
      key: "defense", templateId: "defense", phase: "Defense", icon: "Presentation", gate: true,
      re: /\b(dissertation|thesis) defense\b|\boral defense\b|\bfinal oral\b|\bfinal examination\b/i,
      objective: (name) => `Prepare for and complete the final defense requirement: ${name}.`,
      subtasks: (name, source) => [
        `Confirm defense scheduling, committee, and announcement rules in ${source}`,
        "Build the talk around question, gap, method, findings, and contribution",
        "Rehearse Q&A against likely committee concerns"
      ],
      add: ["defense-deck", "qa-simulator"], retire: ["viz-studio", "reviewer-2"]
    },
    {
      key: "submission", templateId: "submission", phase: "Submission", icon: "UploadCloud", gate: true,
      re: /\b(final|submit|submission|deposit).{0,60}\b(dissertation|thesis)\b|\bProQuest\b|\brepository submission\b|\bgraduate school submission\b/i,
      objective: () => "Submit the final dissertation package required by your program and graduate school.",
      subtasks: (name, source) => [
        `Confirm final upload, formatting, signature, and deadline rules in ${source}`,
        "Run the final format check before collecting approvals",
        "Upload the accepted dissertation and save proof of submission"
      ],
      add: ["formatting-check", "proquest-checklist"], retire: ["writing-tracker", "outline-builder", "latex-pad", "defense-deck", "qa-simulator"]
    }
  ];

  function milestoneTemplate(id) {
    return MILESTONES.find((m) => m.id === id) || MILESTONES[0];
  }

  function slugify(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  }

  function uniqueStepId(base, used) {
    const root = slugify(base) || "requirement";
    let id = root;
    let n = 2;
    while (used.has(id)) id = `${root}-${n++}`;
    used.add(id);
    return id;
  }

  function defaultRequirementSubtasks(name, source) {
    return [
      `Read the exact requirement in ${source}`,
      "Turn the requirement into dates, forms, and approval steps",
      "Confirm the next action with your advisor or graduate coordinator"
    ];
  }

  function ruleForDeliverable(item) {
    const name = cleanText(item && item.name);
    return DELIVERABLE_RULES.find((rule) => rule.re.test(name)) || {
      key: "program-requirement",
      templateId: "orientation",
      phase: "Program Requirements",
      icon: "Flag",
      gate: true,
      objective: (n) => `Complete the program requirement found in your materials: ${n}.`,
      subtasks: defaultRequirementSubtasks,
      add: ["meeting-prep"],
      retire: []
    };
  }

  function hasSpecificDeliverables(deliverables) {
    const items = (deliverables && deliverables.deliverables) || [];
    if (!items.length) return false;
    if (deliverables.discoveryMode && deliverables.discoveryMode !== "fallback") return true;
    if (deliverables.discoveryMode === "fallback") return false;
    return items.some((item) => item.source && !/\b(built-in|template|generic)\b/i.test(item.source));
  }

  function stepFromDeliverable(item, index, usedIds) {
    const rule = ruleForDeliverable(item);
    const template = milestoneTemplate(rule.templateId);
    const name = cleanText(item.name) || template.title;
    const source = normalizeSource(item.source, "Program materials");
    return {
      ...template,
      id: uniqueStepId(`${rule.key}-${name || index + 1}`, usedIds),
      templateId: template.id,
      phase: rule.phase || template.phase,
      title: name,
      icon: rule.icon || template.icon,
      objective: (rule.objective || ((n) => `Complete the program requirement: ${n}.`))(name, source),
      estimate: cleanText(item.when) || template.estimate,
      gate: rule.gate != null ? rule.gate : template.gate,
      deliverable: name,
      deliverableSource: source,
      source,
      handbookDerived: true,
      subtasks: (rule.subtasks || defaultRequirementSubtasks)(name, source),
      add: [...(rule.add || template.add || [])],
      retire: [...(rule.retire || template.retire || [])],
      status: "locked"
    };
  }

  function insertOptionalMilestones(steps, workflow) {
    const insert = (opt) => {
      const node = { ...opt, status: "locked" };
      const idx = steps.findIndex((s) => s.id === opt.afterId || s.templateId === opt.afterId);
      if (idx >= 0) steps.splice(idx + 1, 0, node);
    };
    if (workflow && workflow.writeStyle === "as-you-go") insert(OPTIONAL_MILESTONES["write-as-you-go"]);
    if (workflow && workflow.publish) insert(OPTIONAL_MILESTONES["publish-track"]);
    return steps;
  }

  function applyStartPosition(steps, startPosition) {
    const pos = START_POSITIONS.find((p) => p.id === startPosition) || START_POSITIONS[0];
    const cutoff = pos.completedThrough
      ? steps.findIndex((s) => s.id === pos.completedThrough || s.templateId === pos.completedThrough)
      : -1;
    const marked = steps.map((s, i) => {
      if (cutoff >= 0 && i <= cutoff) return { ...s, status: "done" };
      return s;
    });
    const firstActive = marked.findIndex((s) => s.status !== "done");
    if (firstActive >= 0) marked[firstActive] = { ...marked[firstActive], status: "current" };
    return marked;
  }

  // --------------------------------------------------------------------------
  // generateRoadmap  (BACKEND: LLM plan synthesis)
  // Production: send {program, deliverables, startPosition, workflow} to an LLM
  // with the MILESTONE library as tools; it returns an ordered, personalized,
  // deliverable-mapped plan. Mock = deterministic assembly from the library.
  // --------------------------------------------------------------------------
  function generateRoadmap({ program, deliverables, startPosition, workflow }) {
    const sourceItems = dedupeDeliverables((deliverables && deliverables.deliverables) || []);
    const generatedSteps = normalizeGeneratedSteps((deliverables && deliverables.steps) || []);
    const usedIds = new Set();
    let steps = generatedSteps.length
      ? generatedSteps
      : hasSpecificDeliverables(deliverables)
      ? sourceItems.map((item, i) => stepFromDeliverable(item, i, usedIds))
      : MILESTONES.map((m) => ({ ...m, status: "locked" }));

    if (!generatedSteps.length) steps = insertOptionalMilestones(steps, workflow);
    steps = applyStartPosition(steps, startPosition);

    // Attach which deliverable(s) each generic fallback milestone satisfies.
    steps = steps.map((s) => ({
      ...s,
      deliverable: s.deliverable || (s.gate && deliverables ? matchDeliverable(s, deliverables) : null)
    }));

    return {
      program,
      deliverables,
      workflow,
      createdAt: Date.now(),
      steps
    };
  }

  function matchDeliverable(milestone, deliverables) {
    // NOTE: keyword matching is intentionally specific — "defense" alone would
    // wrongly match "Dissertation proposal defense" for the FINAL defense.
    const map = {
      proposal: ["proposal defense", "prospectus"],
      prelim: ["exam", "examination", "quals", "comps"],
      collection: ["IRB", "IACUC", "ethics"],
      defense: ["oral defense", "final examination", "dissertation defense", "thesis defense"],
      submission: ["submission", "deposit", "ProQuest", "repository"]
    };
    const needles = map[milestone.id];
    if (!needles) return null;
    const d = (deliverables.deliverables || []).find((x) => {
      const name = x.name.toLowerCase();
      return needles.some((needle) => name.includes(needle.toLowerCase()));
    });
    return d ? d.name : null;
  }

  // --------------------------------------------------------------------------
  // computeFeatureState — given the roadmap + the current milestone index,
  // returns which features are ACTIVE now, which were RETIRED already, and which
  // are INCOMING at the next milestone. Powers the "what's shown / removed /
  // added" panels.
  // --------------------------------------------------------------------------
  function computeFeatureState(roadmap, index) {
    const active = new Set();
    const retiredEver = new Set();
    for (let i = 0; i <= index; i++) {
      const s = roadmap.steps[i];
      if (!s) continue;
      (s.add || []).forEach((f) => active.add(f));
      // retire happens when a milestone is COMPLETED; treat <index as completed
      if (i < index || s.status === "done") (s.retire || []).forEach((f) => { active.delete(f); retiredEver.add(f); });
    }
    const next = roadmap.steps[index + 1];
    const incoming = next ? (next.add || []) : [];
    return {
      active: [...active],
      retired: [...retiredEver],
      incoming
    };
  }

  // --------------------------------------------------------------------------
  // setCurrent — move the "you are here" pointer to ANY milestone, forward or
  // backward. Moving back (their explicit ask) re-locks everything after the
  // target so the tool surface rewinds with you. Steps before the target stay
  // completed. Returns {roadmap, direction}.
  // --------------------------------------------------------------------------
  function stepMatches(step, id) {
    return step && (step.id === id || step.templateId === id);
  }

  function setCurrent(roadmap, stepId) {
    const steps = roadmap.steps.map((s) => ({ ...s }));
    const target = steps.findIndex((s) => s.id === stepId);
    if (target < 0) return { roadmap, direction: "none" };
    const prevCurrent = steps.findIndex((s) => s.status === "current");
    const direction = target < prevCurrent ? "back" : target > prevCurrent ? "forward" : "none";
    steps.forEach((s, i) => {
      if (i < target) { if (s.status !== "done" && !s.recovery) s.status = "done"; }
      else if (i === target) s.status = "current";
      else s.status = "locked";
    });
    return { roadmap: { ...roadmap, steps }, direction };
  }

  // --------------------------------------------------------------------------
  // markComplete — advance the roadmap. Returns {roadmap, justCompleted, retired,
  // unlocked, nextStep} so the UI can fire a celebration.
  // --------------------------------------------------------------------------
  function markComplete(roadmap, stepId) {
    const steps = roadmap.steps.map((s) => ({ ...s }));
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return { roadmap, justCompleted: null };
    steps[idx].status = "done";
    // PhD progress is not linear: several steps can be in flight at once.
    // Only auto-advance to the next milestone when nothing else is active.
    let next = steps.findIndex((s) => s.status === "current" || s.status === "redo" || s.status === "paused");
    let promoted = false;
    if (next < 0) {
      next = steps.findIndex((s) => s.status !== "done");
      if (next >= 0) { steps[next].status = "current"; promoted = true; }
    }
    const completedNumber = steps.filter((s) => s.status === "done").length;
    return {
      roadmap: { ...roadmap, steps },
      justCompleted: steps[idx],
      milestoneNumber: completedNumber,
      retired: steps[idx].retire || [],
      unlocked: promoted && next >= 0 ? (steps[next].add || []) : [],
      nextStep: next >= 0 ? steps[next] : null
    };
  }

  // --------------------------------------------------------------------------
  // PARALLEL WORK — students rarely move strictly in order. addCurrent marks an
  // extra milestone in-progress without touching the rest of the plan;
  // stopCurrent sets a parallel one back to not-started (always keeps at least
  // one step active).
  // --------------------------------------------------------------------------
  function addCurrent(roadmap, stepId) {
    const steps = roadmap.steps.map((s) =>
      s.id === stepId && s.status !== "done" ? { ...s, status: "current" } : { ...s });
    return { roadmap: { ...roadmap, steps } };
  }

  function stopCurrent(roadmap, stepId) {
    const active = roadmap.steps.filter((s) => s.status === "current" || s.status === "redo");
    if (active.length <= 1) return { roadmap };
    const steps = roadmap.steps.map((s) =>
      s.id === stepId && s.status === "current" ? { ...s, status: "locked" } : { ...s });
    return { roadmap: { ...roadmap, steps } };
  }

  // --------------------------------------------------------------------------
  // replan  (BACKEND: LLM re-planning on a setback)
  // The "Something went wrong" button. The student describes a problem in plain
  // language; the model diagnoses which milestone is affected, reopens it,
  // and INSERTS recovery steps (some move you backward) before resuming.
  //
  // Production:
  //   POST /api/replan { roadmap, problemText, currentStepId } →
  //     LLM classifies severity + affected milestone, emits recovery detour
  //     (ordered substeps), and patches feature lifecycle.
  // Mock: keyword classifier → recovery template.
  // --------------------------------------------------------------------------
  const RECOVERY_TEMPLATES = [
    {
      match: /(data|collection|sample|reject|invalid|contaminat|drift|lost)/i,
      affects: "collection",
      title: "Recover: Data Setback",
      icon: "AlertTriangle",
      objective: "Diagnose what's salvageable, fix the protocol, and re-collect only what you must.",
      estimate: "+3–6 weeks",
      subtasks: [
        "Triage: which data is usable vs. lost?",
        "Root-cause the failure with your methods notes",
        "File an IRB amendment if the protocol changes",
        "Re-run the pilot checklist before re-collecting",
        "Re-collect to hit minimum viable N"
      ],
      add: ["pilot-checklist", "data-tracker"], retire: [],
      reopens: ["collection"]
    },
    {
      match: /(advisor|chair|committee|left|quit|conflict|disagree)/i,
      affects: "committee",
      title: "Recover: Committee Change",
      icon: "Users",
      objective: "Stabilize your committee and re-confirm your direction with the new lineup.",
      estimate: "+2–8 weeks",
      subtasks: [
        "Identify replacement member(s)",
        "Re-share your proposal with the new member",
        "Re-confirm scope + timeline with the chair",
        "Update paperwork with the grad school"
      ],
      add: ["advisor-matcher", "meeting-prep"], retire: [],
      reopens: ["committee"]
    },
    {
      match: /(scope|too (big|broad|much)|behind|timeline|slip|deadline|fund)/i,
      affects: "current",
      title: "Recover: Scope & Timeline",
      icon: "Crosshair",
      objective: "Cut scope to a defensible core so the timeline survives.",
      estimate: "+1–2 weeks planning",
      subtasks: [
        "List aims by importance; mark 1 as 'cut candidate'",
        "Move the cut aim to a future-paper backlog",
        "Re-baseline deadlines with your chair",
        "Update the roadmap's target defense date"
      ],
      add: ["reviewer-2"], retire: [],
      reopens: []
    },
    {
      match: /(analysis|result|stats|model|null|insignificant|p-?value)/i,
      affects: "analysis",
      title: "Recover: Analysis Problem",
      icon: "GitBranch",
      objective: "Re-examine the analysis, pre-register the revised plan, and re-run cleanly.",
      estimate: "+2–4 weeks",
      subtasks: [
        "Audit the pipeline for leakage / errors",
        "Pre-register the revised analysis",
        "Re-run on frozen data",
        "Re-make figures from the corrected output"
      ],
      add: ["analysis-pipeline", "viz-studio"], retire: [],
      reopens: ["analysis"]
    }
  ];

  function classifyProblem(text) {
    for (const t of RECOVERY_TEMPLATES) if (t.match.test(text || "")) return t;
    // default: generic scope/timeline recovery
    return RECOVERY_TEMPLATES[2];
  }

  function replan(roadmap, problemText) {
    const tmpl = classifyProblem(problemText);
    const steps = roadmap.steps.map((s) => ({ ...s }));

    // Find where the current milestone is
    const curIdx = Math.max(0, steps.findIndex((s) => s.status === "current"));

    // Reopen any affected (already-done) milestones → they go back to "redo"
    (tmpl.reopens || []).forEach((rid) => {
      const ri = steps.findIndex((s) => stepMatches(s, rid));
      if (ri >= 0 && steps[ri].status === "done") steps[ri].status = "redo";
    });

    // Build the recovery detour milestone
    const detour = {
      id: "recovery-" + Date.now(),
      phase: "Recovery",
      title: tmpl.title,
      icon: tmpl.icon,
      objective: tmpl.objective,
      estimate: tmpl.estimate,
      gate: false,
      recovery: true,
      problemText,
      subtasks: tmpl.subtasks,
      add: tmpl.add, retire: tmpl.retire,
      status: "current"
    };

    // Demote the old current to "paused" and insert the detour before it
    if (steps[curIdx]) steps[curIdx].status = "paused";
    const insertAt = Math.min(curIdx, steps.length);
    steps.splice(insertAt, 0, detour);

    return {
      roadmap: { ...roadmap, steps, lastReplan: { at: Date.now(), problemText, template: tmpl.title } },
      detour
    };
  }

  // --------------------------------------------------------------------------
  // forkPlan — turn the recommended path into a personal one. The chat AI
  // proposes an alternative approach for where you are; adopting it inserts a
  // personalized "fork" milestone as your new current step (the recommended
  // step it replaces drops to the next slot, not lost). Returns {roadmap, fork}.
  // BACKEND: LLM proposes forks from the student's situation + plan.
  // --------------------------------------------------------------------------
  function forkPlan(roadmap, fork) {
    const steps = roadmap.steps.map((s) => ({ ...s }));
    const curIdx = Math.max(0, steps.findIndex((s) => s.status === "current"));
    if (steps[curIdx]) steps[curIdx].status = "locked";
    const node = {
      id: "fork-" + Date.now(),
      phase: (steps[curIdx] && steps[curIdx].phase) || "Topic",
      title: fork.title,
      icon: fork.icon || "GitBranch",
      objective: fork.objective,
      estimate: fork.estimate || "Your pace",
      gate: false,
      fork: true,
      subtasks: fork.subtasks || [],
      add: fork.add || [], retire: fork.retire || [],
      status: "current"
    };
    steps.splice(curIdx, 0, node);
    return { roadmap: { ...roadmap, steps, lastFork: { at: Date.now(), title: fork.title } }, fork: node };
  }

  // Fork proposals for the current step (BACKEND: LLM-generated from context).
  function proposeForks(roadmap) {
    const cur = roadmap.steps.find((s) => s.status === "current") || roadmap.steps[0];
    return [
      { id: "narrow", title: `Narrow ${cur.title}`, icon: "Crosshair", estimate: "1–2 weeks",
        objective: `Cut scope hard: take “${cur.title}” and commit to the smallest defensible version you can finish fast.`,
        subtasks: ["Write the one-sentence version of this step", "List what you're cutting and why", "Set a finish date and tell your advisor"] },
      { id: "parallel", title: `Run ${cur.title} in parallel`, icon: "GitBranch", estimate: "Ongoing",
        objective: `You don't have to finish this before moving on. Keep “${cur.title}” active while you start the next step alongside it.`,
        subtasks: ["Mark this step as ongoing, not blocking", "Pick the next step to start now", "Set a weekly check to merge progress"] },
      { id: "deep", title: `Go deeper on ${cur.title}`, icon: "Microscope", estimate: "3–5 weeks",
        objective: `This step is load-bearing for your thesis — invest more here now to save rework later.`,
        subtasks: ["Name what 'excellent' looks like for this step", "Add the extra analysis/reading it needs", "Schedule a mid-point advisor review"] }
    ];
  }

  // shouldFork — only TRUE when the message clearly signals a path change, so
  // the AI forks autonomously without over-triggering on ordinary questions.
  function shouldFork(roadmap, text) {
    const t = (text || "").toLowerCase();
    if (t.length < 12) return false;
    return /parallel|same time|while i|multitask|blocked|stuck|depend|deep|thorough|rigor|rigour|foundation|behind|deadline|overwhelm|too big|too much|narrow|scope|rush|can'?t finish|falling behind|prioriti|change my|different path|switch to|instead of/.test(t);
  }

  // detectFork — AUTO-detect the best-fit fork from the conversation/situation and
  // return the single one to apply (no menu). Adds a `reason` for transparency.
  // BACKEND: LLM classifies the student's situation → chooses the fork.
  function detectFork(roadmap, text) {
    const forks = proposeForks(roadmap);
    const t = (text || "").toLowerCase();
    if (/parallel|same time|while|multitask|wait|blocked|stuck|depend/.test(t))
      return { ...forks[1], reason: "It sounds like you're blocked or juggling things, so I kept this step moving in parallel instead of waiting on it." };
    if (/deep|thorough|rigor|rigour|core|important|foundation|careful|quality|excellent/.test(t))
      return { ...forks[2], reason: "This step is load-bearing for your thesis, so I deepened it now to save rework later." };
    if (/behind|time|deadline|overwhelm|too big|too much|scope|fast|quick|rush|stress|burn/.test(t))
      return { ...forks[0], reason: "You're tight on time, so I narrowed this to the smallest version you can defend and finish fast." };
    return { ...forks[0], reason: "I focused this down to the most defensible version so you can get moving without overthinking it." };
  }

  // --------------------------------------------------------------------------
  // MILESTONE_RISKS — "what trips people up here" + the questions students often
  // don't know to ask. Surfaces tacit knowledge at the moment it's relevant
  // (the core idea behind the PhD knowledge-graph research). Plain content; a
  // backend can later personalize these per program.
  // --------------------------------------------------------------------------
  const MILESTONE_RISKS = {
    orientation: [
      "The handbook is the contract — read the residency, credit, and timeline rules before you plan anything.",
      "Funding terms (TA/RA/fellowship) often cap how long you're covered. Find that number now.",
      "Ask: who is my official advisor for year one, and how often do we meet?"
    ],
    "topic-ideas": [
      "The #1 mistake is a topic too broad to finish — narrow until you can state it in one sentence.",
      "Confirm data/access feasibility before you fall in love with a question.",
      "Get your chair to say the topic is defensible in writing before you invest months."
    ],
    committee: [
      "A co-chair adds resilience but slows feedback when chairs disagree — decide deliberately.",
      "Confirm at least one outside/external member early; it's a common last-minute scramble.",
      "Ask each prospective member how many students they currently chair (bandwidth matters)."
    ],
    literature: [
      "Reading forever is a form of avoidance — stop when you can recite your gap from memory.",
      "Track every paper in one matrix from day one; rebuilding it later is brutal.",
      "Engage the counter-evidence to your thesis — committees probe the gap you skipped."
    ],
    proposal: [
      "A proposal is a promise, not a contract — aim defensible, not perfect.",
      "Map every aim to a concrete method; unmapped aims get cut at the defense.",
      "Circulate to the committee ~3 weeks ahead; last-minute sends read as unprepared."
    ],
    prelim: [
      "Prelims reward synthesis, not recall — practice linking three papers in one paragraph.",
      "Circulate the reading list early and mock the oral with peers before the real thing."
    ],
    candidacy: [
      "Candidacy is paperwork that's easy to forget — a missed form can cost a whole semester.",
      "Verify your committee is officially registered with the graduate school."
    ],
    irb: [
      "Submit ≥8 weeks before collection — first reviews are slow; amendments are fast.",
      "Submit the protocol you can defend now, not the ideal one; you can amend later.",
      "No data collection — none — before approval, or it can't be used."
    ],
    pilot: [
      "Skipping the pilot is the costliest shortcut in research — run the full pipeline on tiny data first.",
      "If the protocol changes after the pilot, file the IRB amendment before collecting more."
    ],
    collection: [
      "Log every deviation in a research journal as it happens — memory won't survive to the defense.",
      "Hold a standing weekly check-in with your chair; silent months are where projects drift."
    ],
    analysis: [
      "Freeze the pipeline and commit the script — the result you defend must be reproducible.",
      "One chart per finding, tested in grayscale; kitchen-sink figures lose the reader."
    ],
    writing: [
      "This is where most ABD students stall — produce a bad draft, don't polish a blank page.",
      "Adopt the institution's formatting from day one; retrofitting it later wastes a week.",
      "Send chapters on a fixed cadence so feedback never becomes the bottleneck."
    ],
    defense: [
      "Most defenses are won in the first 3 minutes — open with question, gap, headline finding.",
      "Mock it twice (peers + chair); the Q&A is what's actually being graded."
    ],
    submission: [
      "Reserve a full week for formatting alone — grad schools reject for margins faster than content.",
      "Collect committee + dean signatures early; chasing signatures is the classic last delay."
    ]
  };

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------
  window.RoadmapEngine = {
    FEATURES,
    MILESTONES,
    MILESTONE_RISKS,
    risks: (id) => MILESTONE_RISKS[id] || [],
    START_POSITIONS,
    PROGRAM_DB,
    genericDeliverables,
    discoverDeliverables,
    generateRoadmap,
    computeFeatureState,
    setCurrent,
    addCurrent,
    stopCurrent,
    markComplete,
    replan,
    forkPlan,
    proposeForks,
    detectFork,
    shouldFork,
    feature: (id) => FEATURES[id] || { name: id, icon: "Box", blurb: "" }
  };
})();
