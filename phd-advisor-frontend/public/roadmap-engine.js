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

  /* BACKEND: Perplexity online search.
     Production:
       const r = await fetch('/api/discover-deliverables', {
         method:'POST', body: JSON.stringify({ program, institution })
       });
       // server-side: Perplexity sonar query →
       //   "official PhD deliverables, milestones, and timeline for {program} at {institution}"
       // returns structured {degree, deliverables:[{name,when,source}]}
     Mock below resolves after a short delay so the UI can show a search state. */
  function discoverDeliverables({ program, institution }) {
    return new Promise((resolve) => {
      const key = (program || "").toLowerCase();
      let hit = null;
      for (const k of Object.keys(PROGRAM_DB)) if (key.includes(k)) hit = PROGRAM_DB[k];
      const result = hit ? JSON.parse(JSON.stringify(hit)) : genericDeliverables(program);
      result.institution = institution || "your institution";
      // Simulate search latency
      setTimeout(() => resolve(result), 1100);
    });
  }

  // --------------------------------------------------------------------------
  // START POSITIONS — where the student is today. Determines which milestones
  // are pre-completed when the roadmap is generated.
  // --------------------------------------------------------------------------
  const START_POSITIONS = [
    { id: "just-starting",      label: "Just starting",                  completedThrough: null },
    { id: "coursework",         label: "Coursework / exploration",       completedThrough: "orientation" },
    { id: "choosing",           label: "Choosing advisor or topic",      completedThrough: "orientation" },
    { id: "prelims",            label: "Preparing for prelims / quals",  completedThrough: "proposal" },
    { id: "committee-proposal", label: "Forming committee / proposal",   completedThrough: "topic-ideas" },
    { id: "candidate",          label: "Advanced to candidacy",          completedThrough: "candidacy" },
    { id: "researching",        label: "Conducting research",            completedThrough: "pilot" },
    { id: "writing-up",         label: "Writing dissertation",           completedThrough: "analysis" },
    { id: "defense-prep",       label: "Preparing for defense",          completedThrough: "writing" },
    { id: "not-sure",           label: "Not sure",                       completedThrough: null }
  ];

  // --------------------------------------------------------------------------
  // generateRoadmap  (BACKEND: LLM plan synthesis)
  // Production: send {program, deliverables, startPosition, workflow} to an LLM
  // with the MILESTONE library as tools; it returns an ordered, personalized,
  // deliverable-mapped plan. Mock = deterministic assembly from the library.
  // --------------------------------------------------------------------------
  function generateRoadmap({ program, deliverables, startPosition, workflow }) {
    let steps = MILESTONES.map((m) => ({ ...m, status: "locked" }));

    // Weave optional milestones based on workflow prefs
    if (workflow && workflow.writeStyle === "as-you-go") {
      const opt = { ...OPTIONAL_MILESTONES["write-as-you-go"], status: "locked" };
      const idx = steps.findIndex((s) => s.id === opt.afterId);
      if (idx >= 0) steps.splice(idx + 1, 0, opt);
    }
    if (workflow && workflow.publish) {
      const opt = { ...OPTIONAL_MILESTONES["publish-track"], status: "locked" };
      const idx = steps.findIndex((s) => s.id === opt.afterId);
      if (idx >= 0) steps.splice(idx + 1, 0, opt);
    }

    // Mark completed-through based on start position (null = nothing done yet)
    const pos = START_POSITIONS.find((p) => p.id === startPosition) || START_POSITIONS[0];
    const cutoff = pos.completedThrough ? steps.findIndex((s) => s.id === pos.completedThrough) : -1;
    steps = steps.map((s, i) => {
      if (i < cutoff) return { ...s, status: "done" };
      if (i === cutoff) return { ...s, status: "done" };
      return s;
    });
    // First non-done becomes current
    const firstActive = steps.findIndex((s) => s.status !== "done");
    if (firstActive >= 0) steps[firstActive] = { ...steps[firstActive], status: "current" };

    // Attach which deliverable(s) each gate milestone satisfies
    steps = steps.map((s) => ({
      ...s,
      deliverable: s.gate && deliverables ? matchDeliverable(s, deliverables) : null
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
      proposal: "proposal defense", prelim: "exam", collection: "IRB",
      defense: "oral defense", submission: "submission"
    };
    const needle = map[milestone.id];
    if (!needle) return null;
    const d = deliverables.deliverables.find((x) => x.name.toLowerCase().includes(needle.toLowerCase()));
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
    const next = steps.findIndex((s) => s.status !== "done");
    if (next >= 0) steps[next].status = "current";
    const completedNumber = steps.filter((s) => s.status === "done").length;
    return {
      roadmap: { ...roadmap, steps },
      justCompleted: steps[idx],
      milestoneNumber: completedNumber,
      retired: steps[idx].retire || [],
      unlocked: next >= 0 ? (steps[next].add || []) : [],
      nextStep: next >= 0 ? steps[next] : null
    };
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
      const ri = steps.findIndex((s) => s.id === rid);
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
    discoverDeliverables,
    generateRoadmap,
    computeFeatureState,
    setCurrent,
    markComplete,
    replan,
    forkPlan,
    proposeForks,
    detectFork,
    shouldFork,
    feature: (id) => FEATURES[id] || { name: id, icon: "Box", blurb: "" }
  };
})();
