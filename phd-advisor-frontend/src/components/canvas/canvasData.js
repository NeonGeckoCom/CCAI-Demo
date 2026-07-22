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
