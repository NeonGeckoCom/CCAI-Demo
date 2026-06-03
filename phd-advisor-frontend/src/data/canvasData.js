/* PhD Canvas — journey + deliverables + resources data
   Source: uploads/Phd Canvas Summer 26 Notes.pdf
   Status values: "done" | "active" | "next" | "locked"
*/

export const JOURNEY_PHASES = [
  {
    id: "courses",
    title: "Courses & Dissertation Credits",
    desc: "Plan coursework, dissertation-credit timing, and funding so each semester compounds toward your degree.",
    icon: "BookOpen",
    status: "done",
    eta: "Year 1 – ongoing",
    advisors: ["Pragmatist", "Administrator"],
    checklist: [
      "Map required vs. elective credits against the PhD Handbook",
      "Block dissertation-credit timing around funding milestones",
      "Confirm assistantship / TA contract for the upcoming term"
    ],
    insight: {
      from: "Administrator",
      quote: "Front-load methods coursework so you can spend years 3–4 almost entirely on dissertation credits without losing tuition coverage."
    },
    actions: ["Open chat about courses", "Upload PhD Handbook"]
  },
  {
    id: "handbook-audit",
    title: "PhD Handbook Audit",
    desc: "Upload your program handbook so the advisors can flag credit restrictions, timelines, and committee rules specific to your institution.",
    icon: "FileSearch",
    status: "done",
    eta: "Early Year 1",
    advisors: ["Administrator"],
    checklist: [
      "Upload current PhD Handbook (PDF)",
      "Confirm credit-hour minimums and residency requirements",
      "Note milestone deadlines (prelim, comp, defense)"
    ],
    insight: {
      from: "Administrator",
      quote: "Your handbook caps dissertation credits at 30 — pace them so you don't burn coverage before the writing year."
    },
    actions: ["Re-upload handbook", "Audit again"]
  },
  {
    id: "committee",
    title: "Select Your Committee",
    desc: "Pick a chair, co-chair, and outside members. Weigh the pros and cons of a co-chair structure for your situation.",
    icon: "Users",
    status: "active",
    eta: "By end of Year 2",
    advisors: ["Mentor", "Pragmatist"],
    checklist: [
      "Shortlist 6–8 faculty with aligned methods or theory",
      "Decide on single chair vs. co-chair structure",
      "Confirm at least one external/outside member"
    ],
    insight: {
      from: "Mentor",
      quote: "A co-chair is insurance against turnover and reading-load — at the cost of slower feedback when chairs disagree. Pick co-chairs whose calendars are already in sync."
    },
    actions: ["See faculty list", "Ask Mentor", "Draft outreach email"]
  },
  {
    id: "topic",
    title: "Pick a Dissertation Topic",
    desc: "Narrow from a broad area to a defensible, doable question that fits your timeline, methods, and committee's expertise.",
    icon: "Target",
    status: "active",
    eta: "End of Year 2",
    advisors: ["Theorist", "Methodologist"],
    checklist: [
      "Write a one-sentence question + null hypothesis",
      "Sanity-check feasibility against data + IRB constraints",
      "Get topic sign-off from your chair"
    ],
    insight: {
      from: "Theorist",
      quote: "If you can't sketch the bar chart of your finding on a napkin, the question is still too broad. Cut scope before adding more theory."
    },
    actions: ["Refine question with Theorist", "Open Research Canvas"]
  },
  {
    id: "literature-review",
    title: "Literature Review",
    desc: "Build a defensible map of the field — top journals, top authors, and the gap your work fills.",
    icon: "Library",
    status: "next",
    eta: "Year 2 – Year 3",
    advisors: ["Theorist", "Researcher"],
    checklist: [
      "Identify the 20 most-cited papers in your gap",
      "Track every paper you read in a single matrix",
      "Write the gap statement in 3 sentences"
    ],
    insight: {
      from: "Researcher",
      quote: "Stop reading after you can recite your gap from memory. Two more papers won't change your committee's mind — but a clean matrix will."
    },
    actions: ["See top-tier authors", "Start literature matrix"]
  },
  {
    id: "preliminary",
    title: "Preliminary Exam",
    desc: "The early checkpoint: prove you've absorbed the field and can defend a proposed direction.",
    icon: "ClipboardCheck",
    status: "next",
    eta: "End of Year 2",
    advisors: ["Mentor", "Administrator"],
    checklist: [
      "Schedule prelim date with the committee",
      "Circulate prelim reading list 6 weeks ahead",
      "Mock the oral with a peer cohort"
    ],
    insight: {
      from: "Mentor",
      quote: "Prelim isn't a trap — it's a release valve. Show you can think on your feet, not that you memorized the canon."
    },
    actions: ["Mock with Mentor", "Prep slides"]
  },
  {
    id: "irb",
    title: "IRB Approval",
    desc: "Translate your protocol into your institution's IRB process. Plan amendments before you collect a single data point.",
    icon: "ShieldCheck",
    status: "locked",
    eta: "Before data collection",
    advisors: ["Methodologist", "Administrator"],
    checklist: [
      "Upload your institution's IRB process",
      "Draft consent + recruitment materials",
      "Submit at least 8 weeks before planned collection"
    ],
    insight: {
      from: "Methodologist",
      quote: "Submit the version you can defend, not the version you wish you had. Amendments are fast; first reviews are not."
    },
    actions: ["Upload IRB process", "Generate consent draft"]
  },
  {
    id: "comp-exam",
    title: "Comprehensive Exam",
    desc: "Demonstrate command of theory + methods across your area. Required before advancing to candidacy.",
    icon: "GraduationCap",
    status: "locked",
    eta: "Year 3",
    advisors: ["Theorist", "Methodologist"],
    checklist: [
      "Confirm comp format (written, oral, portfolio)",
      "Build a 90-day study plan with weekly checkpoints",
      "Mock both written + oral sections with peers"
    ],
    insight: {
      from: "Theorist",
      quote: "Comps reward synthesis, not recall. Practice connecting three papers in one paragraph until it feels natural."
    },
    actions: ["Build study plan"]
  },
  {
    id: "research",
    title: "Doing the Research",
    desc: "Execute your protocol. Use the Research Canvas to keep scope, method, and timeline aligned weekly.",
    icon: "FlaskConical",
    status: "locked",
    eta: "Year 3 – Year 4",
    advisors: ["Methodologist", "Pragmatist"],
    checklist: [
      "Run a 1-week pilot before full collection",
      "Log decisions + deviations in a research journal",
      "Hold weekly 30-min check-in with chair"
    ],
    insight: {
      from: "Pragmatist",
      quote: "If a method change saves a month, take it — and document why. The dissertation only has to defend what you did, not what you planned."
    },
    actions: ["Open Research Canvas"]
  },
  {
    id: "data",
    title: "Obtaining Data",
    desc: "Practical guidance on sourcing, cleaning, and storing data — including ethics and reproducibility.",
    icon: "Database",
    status: "locked",
    eta: "Year 3 – Year 4",
    advisors: ["Methodologist", "Researcher"],
    checklist: [
      "Confirm data licenses + access agreements",
      "Set up a versioned, backed-up storage location",
      "Document every transformation step"
    ],
    insight: {
      from: "Researcher",
      quote: "The dataset you cite at defense is the one you can reproduce in a year. Save the script, not just the file."
    },
    actions: ["Draft data plan"]
  },
  {
    id: "visualization",
    title: "Data Visualization",
    desc: "Turn your results into figures that survive black-and-white printing and a hostile audience.",
    icon: "BarChart3",
    status: "locked",
    eta: "Year 4",
    advisors: ["Methodologist", "Writer"],
    checklist: [
      "One chart per finding — no kitchen-sink figures",
      "Test every figure in grayscale",
      "Caption stand-alone (no reading the body for context)"
    ],
    insight: {
      from: "Writer",
      quote: "A reviewer skims the figure first. If the caption alone tells the story, your defense is half-won."
    },
    actions: ["Critique a figure"]
  },
  {
    id: "writing",
    title: "Writing the Dissertation",
    desc: "Draft, structure, and revise the document. Chapters first; introduction last.",
    icon: "PenTool",
    status: "locked",
    eta: "Year 4 – Year 5",
    advisors: ["Writer", "Mentor"],
    checklist: [
      "Adopt institutional formatting from day one",
      "Set a daily word floor (250–500 words)",
      "Send chapters to chair on a fixed cadence"
    ],
    insight: {
      from: "Writer",
      quote: "Don't polish — produce. The bad first draft is the only one your committee can react to."
    },
    actions: ["See formatting criteria", "Set writing goal"]
  },
  {
    id: "defense",
    title: "Oral Defense",
    desc: "Slides, rehearsal, room logistics. Walk in expecting a conversation, not an interrogation.",
    icon: "Mic",
    status: "locked",
    eta: "End of Year 5",
    advisors: ["Mentor", "Pragmatist"],
    checklist: [
      "Build a 25-minute presentation (≈20 slides)",
      "Mock defense twice — once with peers, once with chair",
      "Prep a 1-page handout of key figures"
    ],
    insight: {
      from: "Mentor",
      quote: "Most defenses are won in the first 3 minutes. Open with the question, the gap, and the headline finding — then breathe."
    },
    actions: ["Generate defense outline"]
  },
  {
    id: "proquest",
    title: "Final Admin & ProQuest",
    desc: "Format, sign, and upload. The last 5% nobody warns you about.",
    icon: "UploadCloud",
    status: "locked",
    eta: "After defense",
    advisors: ["Administrator"],
    checklist: [
      "Final format check against grad-school template",
      "Collect committee + dean signatures",
      "Submit final PDF to ProQuest + institutional repository"
    ],
    insight: {
      from: "Administrator",
      quote: "Reserve a full week for formatting alone. ProQuest will reject for margins faster than for content."
    },
    actions: ["Open ProQuest checklist"]
  }
];

// "Optimal List of Deliverables from the User" — items the user needs to provide
export const REQUIRED_DELIVERABLES = [
  {
    id: "handbook",
    title: "PhD Handbook",
    sub: "Credit restrictions, timelines, residency rules",
    icon: "BookMarked",
    uploaded: true,
    filename: "CU-Boulder-PhD-Handbook-2025.pdf",
    when: "Uploaded 2 days ago",
    required: true
  },
  {
    id: "cv",
    title: "CV / Resume",
    sub: "Used to tune advice to your background + stage",
    icon: "FileUser",
    uploaded: true,
    filename: "alex_morgan_cv.pdf",
    when: "Uploaded last week",
    required: true
  },
  {
    id: "format",
    title: "Dissertation Formatting Criteria",
    sub: "Grad-school template + style guide for your institution",
    icon: "FileCog",
    uploaded: false,
    when: "Needed before Writing phase",
    required: true
  },
  {
    id: "irb",
    title: "IRB Process Document",
    sub: "Your institution's IRB submission flow + forms",
    icon: "ShieldCheck",
    uploaded: false,
    when: "Needed before IRB phase",
    required: true
  }
];

// "Value-Added Deliverables we could provide to the user"
export const VALUE_DELIVERABLES = [
  {
    id: "faculty",
    title: "Faculty Match List",
    desc: "Ranked shortlist of faculty whose work overlaps your topic — including chair, co-chair, and outside-member candidates.",
    icon: "Users",
    badge: "12 matches",
    accent: "#6366F1",
    bg: "#EEF2FF"
  },
  {
    id: "authors",
    title: "Top-Tier Authors",
    desc: "The 20 most-cited researchers in your space, with their venues, recent papers, and citation graphs.",
    icon: "Award",
    badge: "Updated weekly",
    accent: "#8B5CF6",
    bg: "#F3E8FF"
  },
  {
    id: "meeting",
    title: "Meeting Prep Doc",
    desc: "One-pager generated before each advisor meeting — progress, blockers, asks, and proposed agenda.",
    icon: "ClipboardList",
    badge: "Next: Thu 3pm",
    accent: "#10B981",
    bg: "#ECFDF5"
  },
  {
    id: "community",
    title: "PhD Community Connections",
    desc: "Peer cohorts, writing groups, and Discords matched to your area, stage, and methods.",
    icon: "MessagesSquare",
    badge: "8 groups",
    accent: "#F59E0B",
    bg: "#FFFBEB"
  },
  {
    id: "conferences",
    title: "Conference Strategy",
    desc: "Which conferences to target this year, deadlines, travel funding, and how to maximize your time on-site.",
    icon: "CalendarRange",
    badge: "3 deadlines soon",
    accent: "#EC4899",
    bg: "#FDF2F8"
  },
  {
    id: "open-source",
    title: "Open-Source PhD Tools",
    desc: "Curated list of open-source apps for citation management, writing, data, and notes — vetted for PhD workflows.",
    icon: "Boxes",
    badge: "Curated",
    accent: "#0EA5E9",
    bg: "#F0F9FF"
  }
];

// Sidebar mock content
export const MOCK_CHATS = [
  { id: "c1", title: "Choosing co-chair vs single chair", when: "2h ago", active: false },
  { id: "c2", title: "How to narrow a dissertation topic", when: "Yesterday", active: false },
  { id: "c3", title: "IRB amendment for added survey", when: "3 days ago", active: false },
  { id: "c4", title: "Mock prelim — practice questions", when: "Last week", active: false },
  { id: "c5", title: "Formatting margins for ProQuest", when: "Last week", active: false }
];

// Academic stages from CCAI-Demo/phd_config.yaml
export const ACADEMIC_STAGES = [
  { value: "", label: "Select your stage" },
  { value: "prospective", label: "Prospective PhD Student" },
  { value: "first-year", label: "First Year PhD" },
  { value: "coursework", label: "Coursework Phase" },
  { value: "qualifying", label: "Qualifying Exams" },
  { value: "dissertation", label: "Dissertation Phase" },
  { value: "writing", label: "Writing & Defense" },
  { value: "postdoc", label: "Postdoc" },
  { value: "faculty", label: "Faculty / Researcher" }
];

// Advisors — pulled from CCAI-Demo/personas/phd_advisors/*.yaml
export const ADVISORS = [
  { id: "methodologist", name: "Methodologist",      role: "Research Methodology Expert",     summary: "Structured & planning-focused",  color: "#3B82F6", bg: "#EFF6FF", icon: "BookOpen" },
  { id: "theorist",      name: "Theorist",           role: "Theoretical Frameworks Specialist", summary: "Abstract & conceptual",          color: "#8B5CF6", bg: "#F3E8FF", icon: "Brain" },
  { id: "pragmatist",    name: "Pragmatist",         role: "Action-Focused Research Coach",   summary: "Real-world & outcome-focused",  color: "#10B981", bg: "#ECFDF5", icon: "Target" },
  { id: "empathetic",    name: "Empathetic Listener", role: "Well-being & Support Specialist", summary: "Caring & emotionally supportive", color: "#EC4899", bg: "#FDF2F8", icon: "Heart" },
  { id: "socratic",      name: "Socratic Mentor",    role: "Critical Thinking Guide",         summary: "Question-driven & discovery-focused", color: "#F59E0B", bg: "#FEF3C7", icon: "HelpCircle" },
  { id: "minimalist",    name: "Minimalist",         role: "Focus & Clarity Coach",           summary: "Less, but better",                color: "#0EA5E9", bg: "#F0F9FF", icon: "Crosshair" }
];

// Chat suggestion categories — mirrors CCAI-Demo/phd_config.yaml
export const CHAT_SUGGESTIONS = [
  {
    title: "Orientation & Guidance",
    icon: "BookOpen",
    color: "#3B82F6", bg: "#EFF6FF",
    items: [
      "How do I choose a research topic that's interesting and doable?",
      "Meeting and Presentation Prep",
      "What should I be doing my first semester?"
    ]
  },
  {
    title: "Research Design & Academic Skills",
    icon: "FlaskConical",
    color: "#8B5CF6", bg: "#F3E8FF",
    items: [
      "Should I use qualitative, quantitative, or mixed methods for my research?",
      "Is my research question too broad?",
      "How do I defend a non-traditional methodology to my committee?"
    ]
  },
  {
    title: "Writing & Communication",
    icon: "PenTool",
    color: "#10B981", bg: "#ECFDF5",
    items: [
      "What's the right tone for an introduction? Persuasive, cautious, or bold?",
      "How should I respond when reviewers give conflicting feedback?",
      "Should I prioritize journal articles or dissertation chapters when I write?"
    ]
  },
  {
    title: "Mental Health & Hidden Curriculum",
    icon: "Heart",
    color: "#F59E0B", bg: "#FFFBEB",
    items: [
      "How do I cope when I feel behind compared to others in my cohort?",
      "Should I speak up about unclear expectations or just try to figure it out quietly?",
      "What are the unspoken expectations no one tells you about?"
    ]
  }
];

// A scripted demo conversation so the Chat page isn't empty when shown
export const DEMO_CONVERSATION = [
  {
    id: "u1", type: "user",
    content: "I'm in coursework right now and trying to choose between a single chair and a co-chair. What do I weigh?"
  },
  {
    id: "a1", type: "advisor", personaId: "pragmatist",
    content: "**Thought:** Co-chairs trade speed for resilience.\n\n**What to do:**\n- Single chair if your topic is narrow and the candidate is rock-solid through your defense\n- Co-chair if you span two methods, two departments, or the senior chair travels a lot\n- Sanity-check both candidates' calendars before you commit\n\n**Next step:** List your top two faculty and ask each how many doctoral students they're currently chairing."
  },
  {
    id: "a2", type: "advisor", personaId: "methodologist",
    content: "**Thought:** Methods diversity is the real signal.\n\n**What to do:**\n- Map your methods to your shortlist — gaps are where a co-chair adds value\n- Confirm both chairs can sign IRB amendments without delay\n- Ask whether they require weekly, biweekly, or monthly meetings\n\n**Next step:** Draft a 1-pager of your topic + intended methods and circulate to both faculty for an informal read."
  },
  {
    id: "a3", type: "advisor", personaId: "empathetic",
    content: "**Thought:** Whichever you pick, you'll be with this person for 4+ years.\n\n**What to do:**\n- Talk to one of their current students candidly\n- Notice how they respond when a meeting runs over\n- Trust your gut on whether they make you feel smart or small\n\n**Next step:** Set up a 20-minute coffee with a current advisee of each candidate — separate from the official meeting."
  },
  {
    id: "u2", type: "user",
    content: "Helpful — say I lean co-chair. Any red flag I should watch for?"
  },
  {
    id: "a4", type: "advisor", personaId: "socratic",
    content: "**Thought:** A question first.\n\n**What to do:**\n- If your co-chairs disagreed on your dissertation direction in week 1, what's your tiebreaker?\n- Have you written down what each is responsible for — methods, theory, defense logistics?\n- Who signs first?\n\n**Next step:** If you can't answer those three in one paragraph, you're not ready to commit yet."
  }
];

// Canvas v2: AI-summarized insight cards drawn from chat sessions
// Source: CCAI-Demo/phd-advisor-frontend/src/components/canvas/canvasData.js
export const CHAT_INSIGHTS = [
  {
    id: "i-progress",
    title: "Research progress",
    icon: "TrendingUp",
    confidence: 78,
    summary: "Primary recordings from 4 of 6 planned animals are complete. Remaining two scheduled for May 18 and May 25. Analysis pipeline working on existing data; first results draft expected June.",
    bullets: [
      "V1 recordings: **4/6 animals** complete (M1–M4)",
      "Pipeline: spike-sorting validated, GLM model converging on M1–M2",
      "**Risk:** M3 fixation drift suspected; need re-review with adv."
    ],
    sources: 12,
    pinned: true,
    updatedMinutesAgo: 3,
    quotes: [
      "\"Animal M4 recording finished today, sorting completes tomorrow.\" — May 6 lab notes",
      "\"Pipeline is happy with M1, M2; M3 looks drifty.\" — chat with Reineke advisor"
    ]
  },
  {
    id: "i-method",
    title: "Methodology",
    icon: "FlaskConical",
    confidence: 64,
    summary: "GLM with spike-history kernel + visual drive is your declared model. You've resisted committing to a specific predictive-coding formulation; this comes up in every advisor meeting.",
    bullets: [
      "Decided: **GLM with history kernel** + drift-reg covariates",
      "Open: which predictive-coding variant — Rao & Ballard vs. Bastos top-down",
      "Open: how to operationalize \"prediction error\" from extracellular spikes"
    ],
    sources: 8,
    updatedMinutesAgo: 12,
    quotes: [
      "\"Need to pick a PC formulation by next 1:1.\" — meeting notes May 2",
      "\"Bastos lets you predict laminar profile; Rao&Ballard does not.\" — methodologist"
    ]
  },
  {
    id: "i-lit",
    title: "Literature review",
    icon: "BookOpen",
    confidence: 71,
    summary: "Strong on canonical predictive coding (Rao & Ballard 1999, Bastos 2012, Keller & Mrsic-Flogel 2018). Thin on recent feedback-circuit anatomy and on counter-evidence — this is showing up as a critique gap.",
    bullets: [
      "**Coverage:** 47 papers; ~30 well-summarized",
      "**Gap:** sparse on L5b feedback anatomy (Harris/Shepherd lab)",
      "**Gap:** no engagement with anti-PC critiques (e.g. Heeger 2017)"
    ],
    sources: 47,
    updatedMinutesAgo: 22,
    quotes: [
      "\"Have you read Heeger 2017? It changes a lot.\" — lit-review aide",
      "\"L5b feedback anatomy is your weak spot.\" — devil's advocate"
    ]
  },
  {
    id: "i-questions",
    title: "Open research questions",
    icon: "Sparkles",
    confidence: 58,
    summary: "Three live threads. Question 1 (does L2/3 spiking encode prediction error?) is the dissertation core. Q2 and Q3 are scoped to specific aims.",
    bullets: [
      "**Q1:** Does L2/3 firing during oddball encode prediction error vs. surprise?",
      "**Q2:** How does this depend on context length (1 vs. 4 vs. 16 trials)?",
      "**Q3:** Is the signal sharpened by feedback from V2/RSC?"
    ],
    sources: 6,
    updatedMinutesAgo: 38
  },
  {
    id: "i-next",
    title: "Next steps",
    icon: "ArrowRight",
    confidence: 82,
    summary: "Concrete, near-term actions. Two of these have been on the list for 3+ weeks.",
    bullets: [
      "Re-review M3 drift artifact w/ adv. (overdue, 3w)",
      "Draft Aim 2 analysis section (target: May 22)",
      "Read Heeger 2017 + Aitchison & Lengyel 2017",
      "Schedule pilot with M5 (May 18)"
    ],
    sources: 5,
    updatedMinutesAgo: 8
  },
  {
    id: "i-blockers",
    title: "Blockers & risks",
    icon: "AlertTriangle",
    confidence: 70,
    summary: "One technical, one structural. The structural one is more important and you are deferring it.",
    bullets: [
      "**Technical:** Drift on M3 — may lose 1 animal of data",
      "**Structural:** No clear predictive-coding theory commitment → hard to define what counts as evidence"
    ],
    sources: 4,
    updatedMinutesAgo: 18
  }
];

// Workspace widget catalog
export const WIDGET_CATALOG = [
  { type: "bibliography",   name: "Bibliography",        icon: "BookMarked",   cat: "research", desc: "DOI lookup + BibTeX import; APA/MLA/Chicago/BibTeX export" },
  { type: "reading-queue",  name: "Reading Queue",       icon: "ListChecks",   cat: "research", desc: "CrossRef title search + DOI resolve to auto-fill papers" },
  { type: "notes",          name: "Note Inbox",          icon: "StickyNote",   cat: "research", desc: "Markdown rendering with full-text search" },
  { type: "highlights",     name: "Highlights & Quotes", icon: "Quote",        cat: "research", desc: "Pulled quotes with citation key" },
  { type: "concept-map",    name: "Concept Map",         icon: "Network",      cat: "research", desc: "Drag papers as nodes, tag themes", stub: true },
  { type: "paper-tldr",     name: "Paper TL;DR",         icon: "Microscope",   cat: "research", desc: "PDF → claim / method / limits / gaps", stub: true },

  { type: "writing",        name: "Writing Tracker",     icon: "PenTool",      cat: "writing",  desc: "Inline writing pad, 28-day heatmap" },
  { type: "outline",        name: "Outline Builder",     icon: "List",         cat: "writing",  desc: "Collapsible tree with drag-to-indent" },
  { type: "latex",          name: "LaTeX Scratchpad",    icon: "FlaskConical", cat: "writing",  desc: "Live KaTeX render with snippet chips" },
  { type: "draft-locker",   name: "Draft Locker",        icon: "Shield",       cat: "writing",  desc: "Versioned chapter drafts", stub: true },

  { type: "kanban",         name: "Task Board",          icon: "Columns3",     cat: "project",  desc: "Drag-to-move kanban with priority filters" },
  { type: "deadlines",      name: "Deadlines",           icon: "Calendar",     cat: "project",  desc: "Countdown + .ics export per deadline" },
  { type: "pomodoro",       name: "Pomodoro",            icon: "Timer",        cat: "project",  desc: "Real timer with break cycle + session counter" },
  { type: "calendar",       name: "Calendar",            icon: "CalendarDays", cat: "project",  desc: "Month grid with deadlines + writing days" },
  { type: "activity",       name: "Activity Feed",       icon: "Activity",    cat: "project",  desc: "Chronological log of edits across widgets" },
  { type: "documenter",     name: "Daily Documenter",    icon: "FileEdit",     cat: "project",  desc: "Date-stamped journal + AI weekly summary" },
  { type: "phd-journey",    name: "PhD Journey",         icon: "Flag",         cat: "project",  desc: "14 milestones — courses → defense → ProQuest" },
  { type: "meeting-log",    name: "Meeting Log",         icon: "MessageSquare", cat: "project", desc: "Per-stakeholder, last contact, action items" },
  { type: "goals",          name: "Goals / OKRs",        icon: "Target",       cat: "project",  desc: "Quarterly milestones with progress sliders" },

  { type: "mood",           name: "Mood Check-in",       icon: "Smile",        cat: "wellness", desc: "Daily slider, trend graph", stub: true },
  { type: "sleep",          name: "Sleep & Energy",      icon: "Moon",         cat: "wellness", desc: "Correlate with productive days", stub: true },
  { type: "habits",         name: "Habit Tracker",       icon: "Flame",        cat: "wellness", desc: "Daily research practices" },
  { type: "focus",          name: "Focus Playlist",      icon: "Music",        cat: "wellness", desc: "Ambient sounds & music", stub: true },

  { type: "cfp",            name: "CFP Tracker",         icon: "Send",         cat: "career",   desc: "Conference deadlines & submission status", stub: true },
  { type: "grants",         name: "Grant Tracker",       icon: "Award",        cat: "career",   desc: "Applications, deadlines, awards", stub: true },
  { type: "crm",            name: "Networking CRM",      icon: "Users",        cat: "career",   desc: "Collaborators, last touch", stub: true },

  { type: "reviewer-2",     name: "Reviewer 2",          icon: "Gavel",        cat: "critic",   desc: "Harsh peer-review-style critique on your draft", critic: true },
  { type: "devils-advocate", name: "Devil's Advocate",   icon: "Scale",        cat: "critic",   desc: "Strongest counter-arguments to your hypothesis", critic: true },
  { type: "scope-realism",  name: "Scope Realism",       icon: "Crosshair",    cat: "critic",   desc: "Brutal feasibility verdict given your timeline", critic: true },
  { type: "assumption",     name: "Assumption Excavator", icon: "Brain",       cat: "critic",   desc: "Names hidden assumptions, asks \"what if wrong?\"", critic: true, stub: true }
];

export const WIDGET_CATEGORIES = [
  { id: "all",      label: "All" },
  { id: "research", label: "Research" },
  { id: "writing",  label: "Writing" },
  { id: "project",  label: "Project" },
  { id: "wellness", label: "Wellness" },
  { id: "career",   label: "Career" },
  { id: "critic",   label: "Anti-yes-man", critic: true }
];

// Workspace starter presets
export const WORKSPACE_PRESETS = [
  {
    id: "day1-phd",
    name: "Day-1 PhD",
    icon: "Sparkles",
    desc: "Get oriented: reading queue, bibliography, notes, deadlines, kanban, pomodoro.",
    layout: ["reading-queue", "bibliography", "notes", "deadlines", "pomodoro", "kanban"]
  },
  {
    id: "writing-sprint",
    name: "Writing Sprint",
    icon: "PenTool",
    desc: "Focus mode for drafting: writing pad, outline, LaTeX, highlights, pomodoro.",
    layout: ["writing", "outline", "pomodoro", "latex", "highlights", "bibliography"]
  },
  {
    id: "quals-prep",
    name: "Quals Prep",
    icon: "BookOpen",
    desc: "Lit-review heavy: bibliography, reading queue, notes, highlights, kanban.",
    layout: ["bibliography", "reading-queue", "notes", "highlights", "kanban"]
  },
  {
    id: "defense-mode",
    name: "Defense Mode",
    icon: "Gavel",
    desc: "Final stretch: writing, outline, anti-yes-man critics, deadlines.",
    layout: ["writing", "outline", "reviewer-2", "devils-advocate", "scope-realism", "deadlines"]
  }
];

// Document templates (Deliverables / Documents view)
export const DOC_TEMPLATES = [
  { id: "research-paper",       name: "Research Paper",       icon: "FileText",   desc: "Abstract → Intro → Methods → Results → Discussion → References", sections: 6, mode: "paper" },
  { id: "thesis-chapter",       name: "Thesis Chapter",       icon: "BookOpen",   desc: "Standard chapter scaffolding for a dissertation.",                sections: 5, mode: "paper" },
  { id: "nsf-grfp",             name: "NSF GRFP",             icon: "Award",      desc: "Personal Statement (3 pages) + Research Plan (2 pages).",        sections: 2, mode: "document" },
  { id: "conference-abstract",  name: "Conference Abstract",  icon: "Send",       desc: "Single section, 250 words. Lead with the result.",               sections: 1, mode: "document" },
  { id: "defense-slides",       name: "Defense Slides",       icon: "Presentation", desc: "Title → Outline → Background → Question → Methods → Results → Q&A", sections: 8, mode: "slides" },
  { id: "poster",               name: "Conference Poster",    icon: "LayoutGrid", desc: "4-quadrant scientific poster: Intro · Methods · Results · Discussion.", sections: 6, mode: "poster" },
  { id: "cv",                   name: "Academic CV",          icon: "FileUser",   desc: "Education · Pubs · Talks · Awards · Service · Skills.",          sections: 7, mode: "document" },
  { id: "cover-letter",         name: "Cover Letter",         icon: "Mail",       desc: "For job applications, journal submissions, or postdoc inquiries.", sections: 5, mode: "document" },
  { id: "irb-protocol",         name: "IRB Protocol",         icon: "ShieldCheck", desc: "Standard sections for human-subjects research approval.",       sections: 9, mode: "document" },
  { id: "meeting-prep",         name: "Advisor Meeting Prep", icon: "MessageSquare", desc: "Bring this to your 1:1 — agenda, updates, decisions, follow-ups.", sections: 6, mode: "document" },
  { id: "dissertation-format",  name: "Dissertation Format Check", icon: "ClipboardCheck", desc: "Catch-everything pass before ProQuest submission.",   sections: 8, mode: "document" },
  { id: "faculty-hunt",         name: "Faculty / Advisor Hunt", icon: "Users",   desc: "Research the people: shortlist, recent pubs, outreach plan.",     sections: 6, mode: "document" },
  { id: "research-statement",   name: "Research Statement",   icon: "Sparkles",   desc: "For faculty applications: past work, current direction, future arc.", sections: 5, mode: "document" }
];

// Welcome tour steps shown on first canvas visit
export const TOUR_STEPS = [
  {
    title: "Welcome to your Canvas",
    icon: "Sparkles",
    body: "This is your research workspace. Three views — Insights (AI-summarized highlights from your chats), Workspace (a customizable dashboard of widgets), and Documents (deliverable templates). It starts mostly empty so you can build it the way you want."
  },
  {
    title: "Add widgets from the palette",
    icon: "Plus",
    body: "Click \"Add widget\" on the Workspace view, or hit ⌘K and search. There are 30+ widgets — bibliography, kanban, pomodoro, writing tracker, plus three \"anti-yes-man\" widgets that push back on your thinking."
  },
  {
    title: "Make it yours",
    icon: "Layout",
    body: "Drag widget headers to reorder. Click the size pill (S/M/L) to resize. Hover and click trash to remove. Layout and content auto-save to your browser."
  },
  {
    title: "Try the anti-yes-man widgets",
    icon: "Gavel",
    body: "Reviewer 2, Devil's Advocate, and Scope Realism are tuned to push back, not validate. They're where the real work gets sharpened. Add them last — when you're ready for honest feedback."
  }
];

// DEMO_PROJECT for the canvas header
export const DEMO_PROJECT = {
  title: "Cortical Predictive Coding in Mouse V1",
  meta: "Year 2 · PhD · Adv. Dr. Reineke"
};

export const MOCK_USER = {
  name: "Alex Morgan",
  email: "alex.morgan@colorado.edu",
  initials: "AM",
  stage: "Coursework → Candidacy",
  program: "PhD, Information Science"
};

// localStorage keys (shared across canvas components)
export const TOUR_KEY = "phd-canvas-tour-seen-v1";
export const WORKSPACE_KEY = "phd-canvas-workspace-v1";
export const DOCS_KEY = "phd-canvas-docs-v1";

// Document section scaffolding for the editor. A handful of templates get rich
// section guidance; the rest fall back to a generated set (see sectionsFor()).
export const SECTION_DEFINITIONS = {
  "research-paper": [
    { id: "abstract",  name: "Abstract",     target: 250,  hint: "One paragraph: question, method, finding, implication." },
    { id: "intro",     name: "Introduction", target: 1000, hint: "Frame the problem, state the gap, name your contribution." },
    { id: "methods",   name: "Methods",      target: 800,  hint: "Reproducibility-first: subjects, materials, procedure, analysis." },
    { id: "results",   name: "Results",      target: 800,  hint: "Lead with the effect. Numbers + figure refs. No interpretation here." },
    { id: "discussion",name: "Discussion",   target: 1000, hint: "What it means, what it doesn't, limits, future work." },
    { id: "refs",      name: "References",   target: 0,    hint: "Drop @keys from the Bibliography widget." }
  ],
  "defense-slides": [
    { id: "title",     name: "Title slide",        target: 30,  hint: "Title, your name, advisor, date." },
    { id: "outline",   name: "Outline",            target: 60,  hint: "5–7 bullets covering the talk arc." },
    { id: "background",name: "Background",         target: 200, hint: "Just enough context." },
    { id: "question",  name: "Question",           target: 80,  hint: "Single sentence, falsifiable." },
    { id: "methods",   name: "Methods",            target: 200, hint: "High-level." },
    { id: "results",   name: "Results",            target: 300, hint: "One slide per finding." },
    { id: "discussion",name: "Discussion",         target: 200, hint: "Implications + limits." },
    { id: "qa",        name: "Anticipated Q&A",    target: 300, hint: "Hardest 5 questions." }
  ],
  "nsf-grfp": [
    { id: "personal", name: "Personal Statement", target: 1500, hint: "Background, experiences, broader impacts. Write as a story." },
    { id: "research", name: "Research Plan",      target: 1000, hint: "Question, hypothesis, approach, intellectual merit." }
  ],
  "meeting-prep": [
    { id: "agenda",     name: "Agenda",                 target: 80,  hint: "3–5 bullets ranked by priority." },
    { id: "progress",   name: "Progress since last",    target: 200, hint: "What you actually did. Numbers when possible." },
    { id: "blockers",   name: "Blockers",               target: 150, hint: "What you need from them to move forward." },
    { id: "decisions",  name: "Decisions needed",       target: 200, hint: "Frame as A/B options with your recommendation." },
    { id: "questions",  name: "Questions",              target: 150, hint: "Open questions you genuinely want their take on." },
    { id: "followup",   name: "Action items",           target: 100, hint: "Fill in during/after. Owner + due date." }
  ]
};
