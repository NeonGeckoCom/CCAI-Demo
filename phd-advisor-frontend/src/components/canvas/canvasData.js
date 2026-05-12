// Demo data for a Year-2 PhD student in computational neuroscience.

export const DEMO_PROJECT = {
  title: "Cortical Predictive Coding in Mouse V1",
  meta: "Year 2 · PhD · Adv. Dr. Reineke",
};

export const INSIGHTS = [
  {
    id: 'i-progress',
    title: 'Research progress',
    icon: 'graph',
    category: 'progress',
    confidence: 78,
    summary: 'Primary recordings from 4 of 6 planned animals are complete. Remaining two scheduled for May 18 and May 25. Analysis pipeline working on existing data; first results draft expected June.',
    bullets: [
      'V1 recordings: <strong>4/6 animals</strong> complete (M1–M4)',
      'Pipeline: spike-sorting validated, GLM model converging on M1–M2',
      '<strong>Risk:</strong> M3 fixation drift suspected; need re-review with adv.',
    ],
    pinned: true,
    sources: 12,
    updatedMinutesAgo: 3,
    quotes: [
      '"Animal M4 recording finished today, sorting completes tomorrow." — May 6 lab notes',
      '"Pipeline is happy with M1, M2; M3 looks drifty." — chat with Reineke advisor',
    ],
  },
  {
    id: 'i-method',
    title: 'Methodology',
    icon: 'flask',
    category: 'theory',
    confidence: 64,
    summary: 'GLM with spike-history kernel + visual drive is your declared model. You\'ve resisted committing to a specific predictive-coding formulation; this comes up in every advisor meeting.',
    bullets: [
      'Decided: <strong>GLM with history kernel</strong> + drift-reg covariates',
      'Open: which predictive-coding variant — Rao & Ballard vs. Bastos top-down',
      'Open: how to operationalize "prediction error" from extracellular spikes',
    ],
    sources: 8,
    updatedMinutesAgo: 12,
    quotes: [
      '"Need to pick a PC formulation by next 1:1." — meeting notes May 2',
      '"Bastos lets you predict laminar profile; Rao&Ballard does not." — methodologist chat',
    ],
  },
  {
    id: 'i-lit',
    title: 'Literature review',
    icon: 'book',
    category: 'literature',
    confidence: 71,
    summary: 'Strong on canonical predictive coding (Rao & Ballard 1999, Bastos 2012, Keller & Mrsic-Flogel 2018). Thin on recent feedback-circuit anatomy and on counter-evidence — this is showing up as a critique gap.',
    bullets: [
      '<strong>Coverage:</strong> 47 papers; ~30 well-summarized',
      '<strong>Gap:</strong> sparse on L5b feedback anatomy (Harris/Shepherd lab)',
      '<strong>Gap:</strong> no engagement with anti-PC critiques (e.g. Heeger 2017)',
    ],
    sources: 47,
    updatedMinutesAgo: 22,
    quotes: [
      '"Have you read Heeger 2017? It changes a lot." — lit-review aide',
      '"L5b feedback anatomy is your weak spot." — devil\'s advocate',
    ],
  },
  {
    id: 'i-questions',
    title: 'Open research questions',
    icon: 'sparkles',
    category: 'theory',
    confidence: 58,
    summary: 'Three live threads. Question 1 (does L2/3 spiking encode prediction error?) is the dissertation core. Q2 and Q3 are scoped to specific aims.',
    bullets: [
      '<strong>Q1:</strong> Does L2/3 firing during oddball encode prediction error vs. surprise?',
      '<strong>Q2:</strong> How does this depend on context length (1 vs. 4 vs. 16 trials)?',
      '<strong>Q3:</strong> Is the signal sharpened by feedback from V2/RSC?',
    ],
    sources: 6,
    updatedMinutesAgo: 38,
    quotes: [
      '"Q1 is what the whole dissertation rests on." — methodologist',
      '"Q3 is exciting but probably out of scope for the thesis." — Reineke',
    ],
  },
  {
    id: 'i-next',
    title: 'Next steps',
    icon: 'arrow',
    category: 'action',
    confidence: 82,
    summary: 'Concrete, near-term actions. Two of these have been on the list for 3+ weeks.',
    bullets: [
      'Re-review M3 drift artifact w/ adv. (overdue, 3w)',
      'Draft Aim 2 analysis section (target: May 22)',
      'Read Heeger 2017 + Aitchison & Lengyel 2017',
      'Schedule pilot with M5 (May 18)',
    ],
    sources: 5,
    updatedMinutesAgo: 8,
    quotes: [
      '"Aim 2 draft has to land by May 22 or quals slip." — Reineke',
      '"M3 review keeps getting punted." — last 3 advisor meetings',
    ],
  },
  {
    id: 'i-blockers',
    title: 'Blockers & risks',
    icon: 'alert',
    category: 'risk',
    confidence: 70,
    summary: 'One technical, one structural. The structural one is more important and you are deferring it.',
    bullets: [
      '<strong>Technical:</strong> Drift on M3 — may lose 1 animal of data',
      '<strong>Structural:</strong> No clear predictive-coding theory commitment yet → hard to define what counts as evidence',
    ],
    sources: 4,
    updatedMinutesAgo: 18,
    quotes: [
      '"If M3 is unusable you\'re at n=5 — still publishable but tight." — methodologist',
      '"Without a theory commitment you can\'t falsify anything." — devil\'s advocate',
    ],
  },
];

export const WIDGET_CATALOG = [
  { type: 'bibliography', name: 'Bibliography', desc: 'DOI lookup + BibTeX import; APA/MLA/Chicago/BibTeX export', icon: 'book', cat: 'research', defaultSize: 'M', enhanced: true },
  { type: 'reading-queue', name: 'Reading Queue', desc: 'CrossRef title search + DOI resolve to auto-fill papers', icon: 'list', cat: 'research', defaultSize: 'S', enhanced: true },
  { type: 'notes', name: 'Note Inbox', desc: 'Markdown rendering with full-text search', icon: 'notes', cat: 'research', defaultSize: 'S', enhanced: true },
  { type: 'concept-map', name: 'Concept Map', desc: 'Drag papers as nodes, tag themes', icon: 'network', cat: 'research', defaultSize: 'M', stub: true },
  { type: 'highlights', name: 'Highlights & Quotes', desc: 'Pulled quotes with citation key, copy-formatted', icon: 'cite', cat: 'research', defaultSize: 'M', enhanced: true },
  { type: 'paper-tldr', name: 'Paper TL;DR', desc: 'PDF → claim / method / limits / gaps', icon: 'microscope', cat: 'research', defaultSize: 'M', stub: true },

  { type: 'writing', name: 'Writing Tracker', desc: 'Inline writing pad, multi-chapter, 28-day heatmap', icon: 'pencil', cat: 'writing', defaultSize: 'M', enhanced: true },
  { type: 'outline', name: 'Outline Builder', desc: 'Collapsible tree with indent / outdent / inline editing', icon: 'list', cat: 'writing', defaultSize: 'M', enhanced: true },
  { type: 'latex', name: 'LaTeX Scratchpad', desc: 'Live KaTeX render-as-you-type with snippet chips', icon: 'flask', cat: 'writing', defaultSize: 'M', enhanced: true },
  { type: 'draft-locker', name: 'Draft Locker', desc: 'Versioned chapter drafts', icon: 'shield', cat: 'writing', defaultSize: 'S', stub: true },

  { type: 'kanban', name: 'Task Board', desc: 'Drag-to-move with priority filter chips and due-date sort', icon: 'kanban', cat: 'project', defaultSize: 'L', enhanced: true },
  { type: 'deadlines', name: 'Deadlines', desc: 'Countdown plus per-deadline .ics calendar export', icon: 'calendar', cat: 'project', defaultSize: 'S', enhanced: true },
  { type: 'pomodoro', name: 'Pomodoro', desc: 'Real timer with break cycle and session counter', icon: 'timer', cat: 'project', defaultSize: 'S', enhanced: true },
  { type: 'gantt', name: 'Milestone Timeline', desc: 'Proposal → IRB → defense', icon: 'flag', cat: 'project', defaultSize: 'L', stub: true },
  { type: 'meeting-log', name: 'Meeting Log', desc: 'Per-stakeholder, last contact, actions', icon: 'message', cat: 'project', defaultSize: 'M' },
  { type: 'goals', name: 'Goals / OKRs', desc: 'Quarterly milestones with progress sliders', icon: 'bullseye', cat: 'project', defaultSize: 'M' },
  { type: 'calendar', name: 'Calendar', desc: 'Month grid with deadlines and writing days', icon: 'calendar', cat: 'project', defaultSize: 'M', enhanced: true },
  { type: 'activity', name: 'Activity Feed', desc: 'Chronological log of edits across widgets', icon: 'graph', cat: 'project', defaultSize: 'M', enhanced: true },
  { type: 'documenter', name: 'Daily Documenter', desc: 'Date-stamped journal · AI weekly summary (LLM stub)', icon: 'pencil', cat: 'project', defaultSize: 'M', enhanced: true },
  { type: 'phd-journey', name: 'PhD Journey', desc: 'Standard PhD milestones — courses → defense → ProQuest', icon: 'flag', cat: 'project', defaultSize: 'M', enhanced: true },
  { type: 'phd-resources', name: 'PhD Resources', desc: 'Curated open-source tools, handbooks, and community links', icon: 'star', cat: 'research', defaultSize: 'M', enhanced: true },

  { type: 'mood', name: 'Mood / Burnout Check-in', desc: 'Daily slider, trend graph', icon: 'smile', cat: 'wellness', defaultSize: 'S', stub: true },
  { type: 'sleep', name: 'Sleep & Energy', desc: 'Correlate with productive days', icon: 'heart', cat: 'wellness', defaultSize: 'S', stub: true },
  { type: 'habits', name: 'Habit Tracker', desc: 'Daily research practices', icon: 'flame', cat: 'wellness', defaultSize: 'S' },
  { type: 'focus', name: 'Focus Playlist', desc: 'Ambient sounds & music', icon: 'music', cat: 'wellness', defaultSize: 'S', stub: true },

  { type: 'cfp', name: 'Conference / CFP Tracker', desc: 'Deadlines, fit, submission status', icon: 'send', cat: 'career', defaultSize: 'M', stub: true },
  { type: 'grants', name: 'Grant Tracker', desc: 'Applications, deadlines, awards', icon: 'award', cat: 'career', defaultSize: 'S', stub: true },
  { type: 'crm', name: 'Networking CRM', desc: 'Collaborators, last touch', icon: 'network', cat: 'career', defaultSize: 'M', stub: true },
  { type: 'cv', name: 'CV / Publications', desc: 'Track outputs, generate CV', icon: 'user', cat: 'career', defaultSize: 'S', stub: true },

  { type: 'datasets', name: 'Dataset Library', desc: 'Public datasets by domain', icon: 'database', cat: 'data', defaultSize: 'M', stub: true },
  { type: 'methods', name: 'Methods Cheat Sheet', desc: 'When to use what test', icon: 'flask', cat: 'data', defaultSize: 'M', stub: true },

  { type: 'budget', name: 'Budget Tracker', desc: 'Research spend vs. cap', icon: 'wallet', cat: 'practical', defaultSize: 'S' },
  { type: 'discounts', name: 'Student Discounts', desc: 'Software & services with edu pricing', icon: 'star', cat: 'practical', defaultSize: 'S', stub: true },

  { type: 'reviewer-2', name: 'Reviewer 2 Simulator', desc: 'Paste a draft → harsh peer-review-style critique', icon: 'gavel', cat: 'critic', defaultSize: 'M', critic: true },
  { type: 'devils-advocate', name: 'Devil\'s Advocate', desc: 'Strongest counter-arguments to your hypothesis', icon: 'scale', cat: 'critic', defaultSize: 'M', critic: true },
  { type: 'scope-realism', name: 'Scope Realism Check', desc: 'Brutal feasibility verdict given timeline', icon: 'bullseye', cat: 'critic', defaultSize: 'M', critic: true },
  { type: 'assumption', name: 'Assumption Excavator', desc: 'Names hidden assumptions, asks "what if wrong?"', icon: 'brain', cat: 'critic', defaultSize: 'M', critic: true, stub: true },
  { type: 'whats-missing', name: '"What\'s Missing"', desc: 'Gap analysis on lit review or method', icon: 'alert', cat: 'critic', defaultSize: 'S', critic: true, stub: true },
  { type: 'calibrator', name: 'Confidence Calibrator', desc: 'Challenges every "results show X" claim', icon: 'scale', cat: 'critic', defaultSize: 'S', critic: true, stub: true },
];

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'research', label: 'Research' },
  { id: 'writing', label: 'Writing' },
  { id: 'project', label: 'Project' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'career', label: 'Career' },
  { id: 'data', label: 'Data' },
  { id: 'practical', label: 'Practical' },
  { id: 'critic', label: 'Anti-yes-man', critic: true },
];

// Workspace starts empty — users add widgets from the palette or pick a preset.
export const DEFAULT_LAYOUT = [];

// Curated starter layouts. Each preset assigns its own widget IDs so reseeding
// won't collide with manually-added widgets.
const presetIds = (types) => types.map((t, i) => ({ id: `pre-${t.type}-${i}`, ...t }));
export const WORKSPACE_PRESETS = [
  {
    id: 'day1-phd',
    name: 'Day-1 PhD',
    desc: 'Get oriented: reading queue, bibliography, notes, deadlines, kanban, pomodoro.',
    icon: 'sparkles',
    layout: presetIds([
      { type: 'reading-queue', size: 'M' },
      { type: 'bibliography', size: 'M' },
      { type: 'notes', size: 'M' },
      { type: 'deadlines', size: 'S' },
      { type: 'pomodoro', size: 'S' },
      { type: 'kanban', size: 'L' },
    ]),
  },
  {
    id: 'writing-sprint',
    name: 'Writing Sprint',
    desc: 'Focus mode for drafting: writing pad, outline, LaTeX, highlights, pomodoro.',
    icon: 'pencil',
    layout: presetIds([
      { type: 'writing', size: 'M' },
      { type: 'outline', size: 'M' },
      { type: 'pomodoro', size: 'S' },
      { type: 'latex', size: 'M' },
      { type: 'highlights', size: 'M' },
      { type: 'bibliography', size: 'M' },
    ]),
  },
  {
    id: 'quals-prep',
    name: 'Quals Prep',
    desc: 'Lit-review heavy: bibliography, reading queue, notes, highlights, kanban.',
    icon: 'book',
    layout: presetIds([
      { type: 'bibliography', size: 'L' },
      { type: 'reading-queue', size: 'M' },
      { type: 'notes', size: 'M' },
      { type: 'highlights', size: 'M' },
      { type: 'kanban', size: 'M' },
    ]),
  },
  {
    id: 'defense-mode',
    name: 'Defense Mode',
    desc: 'Final stretch: writing, outline, anti-yes-man critics, deadlines.',
    icon: 'gavel',
    layout: presetIds([
      { type: 'writing', size: 'M' },
      { type: 'outline', size: 'M' },
      { type: 'reviewer-2', size: 'M', critic: true },
      { type: 'devils-advocate', size: 'M', critic: true },
      { type: 'scope-realism', size: 'M', critic: true },
      { type: 'deadlines', size: 'S' },
    ]),
  },
];

// Initial state when a widget is first added — minimal scaffolding, no demo content.
export const EMPTY_STATE = {
  bibliography: { format: 'APA', entries: [] },
  kanban: {
    cols: [
      { id: 'todo', label: 'To Do' },
      { id: 'doing', label: 'Doing' },
      { id: 'stuck', label: 'Stuck' },
      { id: 'done', label: 'Done' },
    ],
    cards: [],
  },
  pomodoro: { focus: 25, brk: 5, sessionsToday: 0 },
  writing: {
    chapters: [{ id: 'c-default', name: 'Untitled chapter', target: 500, draft: '' }],
    activeChapterId: 'c-default',
    dailyTotals: {},
    target: 500,
  },
  deadlines: [],
  budget: { cap: 1000, items: [] },
  notes: { items: [] },
  habits: { items: [] },
  goals: { items: [] },
  'meeting-log': { items: [] },
  'reading-queue': [],
  'reviewer-2': { lastDraft: '', lastReview: null },
  'devils-advocate': { claim: '', counters: [] },
  'scope-realism': {
    target: '',
    score: 0,
    label: 'Set a target',
    factors: [],
    notes: '',
  },
  outline: { items: [], expanded: {} },
  highlights: { items: [] },
  latex: { source: '', displayMode: true },
  calendar: { viewMonth: new Date().toISOString().slice(0, 7) },
  activity: {},
  documenter: { entries: [], lastSummary: null },
  'phd-journey': {
    // Status per milestone: 'open' | 'in-progress' | 'completed'
    // Milestones come from the standard PhD journey (course selection → ProQuest)
    statuses: {},
    notes: {},
  },
  'phd-resources': {
    customLinks: [],
  },
};

