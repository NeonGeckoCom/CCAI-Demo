/* coach-landing.jsx — marketing landing page + login (website-style home).
   Warm coach palette. Exports window.CoachLanding, window.CoachLogin. */

const { useState: useSL } = React;
const IcoL = window.Icon;
const LANDING_INSTITUTIONS = window.UNIVERSITY_OPTIONS || ["University of Colorado Boulder", "University of Michigan", "University of Washington", "Stanford University"];
const LANDING_PROGRAMS = window.PROGRAM_OPTIONS || ["PhD, Information Science", "PhD, Computer Science", "PhD, Neuroscience", "PhD, Education"];

// Interactive "the engine" demo — the thing a chatbot can't do.
const ENGINE_MILES = [
  { k: "Topic", icon: "Target" },
  { k: "Proposal", icon: "FileText" },
  { k: "IRB", icon: "ShieldCheck" },
  { k: "Data", icon: "Database" },
  { k: "Analysis", icon: "BarChart3" },
  { k: "Writing", icon: "PenTool" },
  { k: "Defense", icon: "Mic" }
];
const ENGINE_CURRENT = 3; // "Data"
const ENGINE_SETBACKS = [
  { id: "data", label: "My data got rejected", at: 3, recover: "Recover data", icon: "Database",
    advice: "“That's tough. Try to identify what went wrong, talk to your advisor, and consider re-collecting…”",
    did: "Reopened Data, inserted a 3-step recovery detour, and pushed your timeline — automatically." },
  { id: "committee", label: "My chair is leaving", at: 1, recover: "Re-form committee", icon: "Users",
    advice: "“Sorry to hear that. You'll want to find a new chair and update your committee paperwork…”",
    did: "Flagged Proposal as at-risk, added a 'Re-form committee' step before it, and re-sequenced what depends on it." },
  { id: "null", label: "My results came back null", at: 4, recover: "Re-scope analysis", icon: "BarChart3",
    advice: "“Null results are still results! Consider reframing your question or running another analysis…”",
    did: "Reopened Analysis, added a re-scoping step, and surfaced the stats skills you'll need for it." }
];

function EngineShowcase({ onGetStarted }) {
  const [sb, setSb] = useSL(null);
  const active = ENGINE_SETBACKS.find(s => s.id === sb);

  // build the displayed milestone list, injecting a recovery step when a setback is chosen
  const items = ENGINE_MILES.map((m, i) => ({ ...m, idx: i, state: i < ENGINE_CURRENT ? "done" : i === ENGINE_CURRENT ? "current" : "todo" }));
  let display = items;
  if (active) {
    display = [];
    items.forEach((m) => {
      if (m.idx === active.at) display.push({ ...m, state: "redo" });
      else display.push(m);
      if (m.idx === active.at) display.push({ k: active.recover, icon: active.icon, recovery: true, state: "current" });
    });
  }

  return (
    <section className="lp-engine" id="engine">
      <div className="lp-section-head">
        <div className="lp-eyebrow">The engine</div>
        <h2 className="display lp-h2">We know your milestones, where you are,<br />and what changes when something goes wrong.</h2>
        <p className="lp-section-sub">A chatbot answers your question and forgets it. PhD Navigator holds your whole plan — so when life happens, the <strong>plan</strong> changes, not just the advice.</p>
      </div>

      <div className="eng-stage">
        <div className="eng-track-wrap">
          <div className="eng-track-label"><IcoL name="Map" size={13} /> Your living plan</div>
          <div className="eng-track">
            {display.map((m, i) => (
              <React.Fragment key={m.k + i}>
                {i > 0 && <span className={`eng-conn ${m.recovery || m.state === "redo" ? "alert" : ""}`} />}
                <div className={`eng-node ${m.state} ${m.recovery ? "recovery" : ""}`} title={m.k}>
                  <span className="eng-node-dot"><IcoL name={m.recovery ? "LifeBuoy" : m.state === "done" ? "Check" : m.icon} size={14} color={m.state === "done" || m.state === "current" || m.recovery ? "#fff" : undefined} /></span>
                  <span className="eng-node-k">{m.k}</span>
                  {m.state === "current" && !m.recovery && <span className="eng-here">you are here</span>}
                  {m.recovery && <span className="eng-here alert">re-routed</span>}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="eng-controls">
          <div className="eng-controls-l">What happens if…</div>
          <div className="eng-sb-row">
            {ENGINE_SETBACKS.map(s => (
              <button key={s.id} className={`eng-sb ${sb === s.id ? "on" : ""}`} onClick={() => setSb(sb === s.id ? null : s.id)}>
                <IcoL name={s.icon} size={14} /> {s.label}
              </button>
            ))}
          </div>

          {active && (
            <div className="eng-compare">
              <div className="eng-col chatgpt">
                <div className="eng-col-h"><IcoL name="MessageSquare" size={14} /> A generic chatbot</div>
                <div className="eng-col-b">{active.advice}</div>
                <div className="eng-col-f"><IcoL name="X" size={12} /> Your plan is unchanged</div>
              </div>
              <div className="eng-col nav">
                <div className="eng-col-h"><IcoL name="Compass" size={14} /> PhD Navigator</div>
                <div className="eng-col-b">{active.did}</div>
                <div className="eng-col-f ok"><IcoL name="Check" size={12} /> Plan re-routed above</div>
              </div>
            </div>
          )}
          {!active && <div className="eng-hint"><IcoL name="MousePointerClick" size={13} /> Pick a setback to watch the plan re-route in real time.</div>}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// MARKETING LANDING (website home — not the app dashboard)
// ============================================================================
// Mini product mocks for the tour tabs — decorative, aria-hidden, and (like the
// lens panel below) built from window.ADVISORS so a rebrand flows through.
function TourVisual({ id, lenses }) {
  const a0 = lenses[0] || { name: "Methodologist", color: "var(--sage)", icon: "Users" };
  const a1 = lenses[1] || { name: "Planner", color: "var(--amber)", icon: "Users" };
  if (id === "plan") return (
    <div className="lp2-visual" aria-hidden="true">
      <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
      <div className="lp2-vis-h"><IcoL name="Map" size={12} /> Your roadmap</div>
      {[
        { t: "Coursework & program of study", s: "done" },
        { t: "Form your committee", s: "done" },
        { t: "Comprehensive exam", s: "cur", here: true },
        { t: "Dissertation proposal", s: "todo" },
        { t: "Data collection", s: "todo" },
        { t: "Defense", s: "todo" }
      ].map((m, i) => (
        <div className="lp2-mock-item" key={i}>
          <span className={`lp2-mock-dot ${m.s}`}>{m.s === "done" && <IcoL name="Check" size={10} color="var(--on-accent)" />}</span>
          <span style={m.s === "cur" ? { fontWeight: 700, color: "var(--text)" } : null}>{m.t}</span>
          {m.here && <span className="lp2-here">you are here</span>}
        </div>
      ))}
    </div>
  );
  if (id === "lenses") return (
    <div className="lp2-visual" aria-hidden="true">
      <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
      <div className="lp2-bubble me"><div className="bd">My pilot data came back weaker than I hoped. Do I still propose this term?</div></div>
      <div className="lp2-bubble">
        <span className="av" style={{ background: a0.color }}><IcoL name={a0.icon} size={14} color="#fff" /></span>
        <div className="bd"><div className="nm">{a0.name}</div>Weak pilot data can still justify the study — reframe it as feasibility evidence and tighten your power analysis before the proposal.</div>
      </div>
      <div className="lp2-bubble">
        <span className="av" style={{ background: a1.color }}><IcoL name={a1.icon} size={14} color="#fff" /></span>
        <div className="bd"><div className="nm">{a1.name}</div>Your comps are done and your committee is set — proposing this term keeps you on the timeline we mapped. Here's the week-by-week path.</div>
      </div>
      <div className="lp2-input-mock"><IcoL name="MessageCircle" size={13} /> Ask any lens anything…</div>
    </div>
  );
  if (id === "defense") return (
    <div className="lp2-visual" aria-hidden="true">
      <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
      <div className="lp2-vis-h"><IcoL name="Presentation" size={12} /> Mock defense · question 3 of 6</div>
      <div className="lp2-q-card">
        <div className="lp2-q-who"><IcoL name="UserCheck" size={12} /> Methods examiner asks</div>
        <div className="lp2-q-t">"Why is your sample size sufficient given the effect you're claiming?"</div>
      </div>
      <div className="lp2-wave">{[14, 26, 20, 32, 24, 30, 18, 28, 34, 22, 27, 16, 24, 30, 20].map((h, i) => <span key={i} style={{ height: h }} />)}</div>
      <div className="lp2-chip-row">
        <span className="lp2-chip"><IcoL name="Check" size={11} /> Strong framing</span>
        <span className="lp2-chip"><IcoL name="AlertTriangle" size={11} /> Cite your power analysis</span>
        <span className="lp2-chip"><IcoL name="RefreshCw" size={11} /> Try again</span>
      </div>
    </div>
  );
  if (id === "documents") return (
    <div className="lp2-visual" aria-hidden="true">
      <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
      <div className="lp2-vis-h"><IcoL name="FileText" size={12} /> Your library</div>
      <div className="lp2-file"><span className="fx"><IcoL name="BookOpen" size={14} /></span><span><div className="fn">Program handbook 2026.pdf</div><div className="fs">Analyzed — 14 milestones extracted into your plan</div></span></div>
      <div className="lp2-file"><span className="fx"><IcoL name="FileText" size={14} /></span><span><div className="fn">Proposal draft v3.docx</div><div className="fs">Compared with v2 — 6 sections changed</div></span></div>
      <div className="lp2-file"><span className="fx"><IcoL name="Mail" size={14} /></span><span><div className="fn">Advisor email — timeline notes</div><div className="fs">Added to your knowledge base</div></span></div>
      <div className="lp2-chip-row" style={{ marginTop: 12 }}>
        <span className="lp2-chip"><IcoL name="Sparkles" size={11} /> Knowledge base updated — your panel can use it in chat</span>
      </div>
    </div>
  );
  return (
    <div className="lp2-visual" aria-hidden="true">
      <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
      <div className="lp2-vis-h"><IcoL name="BarChart3" size={12} /> Momentum · last 5 weeks</div>
      <div className="lp2-bars">{[34, 52, 40, 66, 84].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div>
      <div className="lp2-bars-x"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>this week</span></div>
      <div className="lp2-chip-row" style={{ marginTop: 14 }}>
        <span className="lp2-chip"><span className="dot" style={{ background: "var(--sage)" }} /> Steady pace on Comps</span>
        <span className="lp2-chip"><IcoL name="HeartPulse" size={11} /> Check-in: doing okay</span>
      </div>
    </div>
  );
}

function CoachLanding({ onGetStarted, onSignIn }) {
  // The lens panel is rendered entirely from window.ADVISORS so names, counts,
  // and branding stay correct as the panel is rebranded — nothing hard-coded.
  // "Lenses" on the marketing site: the same window.ADVISORS records, named for
  // what they are to a visitor — different ways of reading the same work. The
  // word "advisor" is reserved on this page for the student's real one.
  const allLenses = window.ADVISORS || [];
  const lenses = allLenses.slice(0, 3);
  const moreLenses = allLenses.slice(3);
  const [tab, setTab] = useSL("plan");
  const steps = [
    { icon: "GraduationCap", title: "Tell us your program", body: "Add your institution, program, and degree stage — then upload your program handbook and we'll pull the real milestones out of it." },
    { icon: "Map", title: "Get your roadmap", body: "See your program's actual requirements as a step-by-step plan — confirm what we found, fix what we missed, and start where you are." },
    { icon: "Sparkles", title: "Work the plan", body: "Each step unlocks the tools that fit it — readings, meeting agendas, defense practice — and the plan updates as your PhD develops." }
  ];
  const TOUR = [
    { id: "plan", icon: "Map", label: "My Plan", title: "A living plan built from your program's real requirements", body: "Upload your handbook and the AI turns it into a step-by-step roadmap — milestones, gates, and paperwork included. Reorder it, rename it, make it yours.",
      points: ["Milestones extracted from your handbook, not a generic list", "Your next steps always up top, with the fine print attached", "Every step carries its own to-dos, notes, and tools"] },
    { id: "lenses", icon: "Users", label: "Lenses", title: "Ask once, see it through every lens that matters", body: "A methodologist reads your question differently from a writing coach. Each lens is tuned to one way of looking at your work, and all of them read the same plan you do — so the answers land on your current step, not on a generic PhD.",
      points: [allLenses.length ? `${allLenses.length} lenses, each looking at your work differently` : "Every lens looks at your work differently", "Every answer tied to where you are in the plan", "Follow up with one lens, or put the question to all of them"] },
    { id: "defense", icon: "Presentation", label: "Defense Room", title: "Walk in having already answered the hard questions", body: "Rehearse your defense, job talk, or poster session against a simulated committee. Upload your deck, record your answers, and get concrete feedback.",
      points: ["Committee questions generated from your research and materials", "Record answers and get question-by-question feedback", "Practice modes for the defense, job talks, and posters"] },
    { id: "documents", icon: "FileText", label: "Documents", title: "A library that feeds everything else", body: "Handbook, drafts, notes, and forms live in one place. The AI analyzes them, compares versions, and builds a knowledge base every lens reads before it answers.",
      points: ["AI analysis and version comparison on every document", "Uploads during onboarding land here automatically", "Your knowledge base follows your account"] },
    { id: "insights", icon: "HeartPulse", label: "Insights & Wellbeing", title: "See the pace, not just the plan", body: "Progress trends, stall warnings, and honest check-ins. The PhD is long — Navigator watches the pattern so you can course-correct early.",
      points: ["Momentum and progress at a glance", "Gentle stall detection with a concrete next step", "Private wellbeing check-ins, never shared"] }
  ];
  const active = TOUR.find(t => t.id === tab) || TOUR[0];

  return (
    <div className="lp">
      {/* Nav (sticky) */}
      <div className="lp2-nav-wrap">
        <header className="lp-nav">
          <div className="lp-brand">
            <div className="lp-mark"><IcoL name="Compass" size={20} color="#fff" /></div>
            <span className="lp-brand-name">PhD Navigator</span>
          </div>
          <nav className="lp-nav-links">
            <a href="#tour">Product</a>
            <a href="#engine">The engine</a>
            <a href="#how">How it works</a>
            <a href="#lenses">Lenses</a>
          </nav>
          <div className="lp-nav-cta">
            <button className="btn ghost" onClick={onSignIn}>Sign in</button>
            <button className="btn primary" onClick={onGetStarted}>Get started</button>
          </div>
        </header>
      </div>

      {/* Hero — centered, with the product itself as the artwork */}
      <section className="lp2-hero">
        <div className="lp-badge"><IcoL name="Sparkles" size={13} /> Built for doctoral students</div>
        <h1 className="display lp2-h1">Your entire PhD,<br />one <span className="lp-underline">living</span> plan.</h1>
        <p className="lp-sub">PhD Navigator reads your program's real requirements and turns them into a roadmap that plans, re-plans, and works alongside you — with a panel of lenses, a defense room, and a document library built in.</p>
        <div className="lp-hero-cta">
          <button className="btn primary lg" onClick={onGetStarted}><IcoL name="ArrowRight" size={16} color="#fff" /> Start your plan</button>
          <button className="btn lg" onClick={onSignIn}><IcoL name="LogIn" size={16} /> I have an account</button>
        </div>
        <div className="lp-trust"><IcoL name="ShieldCheck" size={14} /> Free during beta · your documents stay yours</div>
      </section>

      <div className="lp2-window-wrap" aria-hidden="true">
        <div className="lp2-window">
          <span className="lp-preview-pill" style={{ top: 10, right: 16, zIndex: 2 }}><IcoL name="Eye" size={11} /> Product preview</span>
          <div className="lp2-win-bar">
            <span className="lp2-win-dot" /><span className="lp2-win-dot" /><span className="lp2-win-dot" />
            <span className="lp2-win-url">phd-navigator.app</span>
          </div>
          <div className="lp2-win-body">
            <div className="lp2-win-side">
              {[["Home", "Home", true], ["My Plan", "Map"], ["Chat", "MessageCircle"], ["Skills", "Sparkles"], ["Insights", "Lightbulb"], ["Defense Room", "Presentation"], ["Documents", "FileText"], ["Wellbeing", "HeartPulse"]].map(([label, icon, on]) => (
                <div key={label} className={`lp2-win-nav ${on ? "on" : ""}`}><IcoL name={icon} size={14} /> {label}</div>
              ))}
            </div>
            <div className="lp2-win-main">
              <div className="lp2-win-hi">Welcome back 👋</div>
              <div className="lp2-win-hi-sub">Comprehensive exam · 3 steps this week</div>
              <div className="lp2-win-card">
                <div className="lp2-win-card-t"><IcoL name="CalendarCheck" size={11} /> This week</div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot done"><IcoL name="Check" size={10} color="var(--on-accent)" /></span> Confirm exam format with your chair</div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot cur" /> Draft your reading synthesis outline</div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot" /> Book the exam room and send invites</div>
              </div>
              <div className="lp2-win-card">
                <div className="lp2-win-card-t"><IcoL name="Map" size={11} /> Your roadmap</div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot done"><IcoL name="Check" size={10} color="var(--on-accent)" /></span> Coursework <span className="lp2-here" style={{ visibility: "hidden" }}>.</span></div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot cur" /> <strong>Comprehensive exam</strong> <span className="lp2-here">you are here</span></div>
                <div className="lp2-mock-item"><span className="lp2-mock-dot" /> Dissertation proposal</div>
              </div>
            </div>
            <div className="lp2-win-right">
              <div className="lp2-win-card">
                <div className="lp2-win-card-t"><IcoL name="Lightbulb" size={11} /> Today's tip</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>Block 25 minutes to outline one comps theme — small starts beat big plans.</div>
              </div>
              <div className="lp2-win-card">
                <div className="lp2-win-card-t"><IcoL name="Users" size={11} /> Ask a lens</div>
                <div className="lp2-chip-row">
                  {lenses.map(a => (
                    <span key={a.id} className="lp2-chip"><span className="dot" style={{ background: a.color }} /> {a.name}</span>
                  ))}
                  {moreLenses.length > 0 && <span className="lp2-chip">+{moreLenses.length} more</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Product tour */}
      <section className="lp2-tour" id="tour">
        <div className="lp-section-head">
          <div className="lp-eyebrow">The product</div>
          <h2 className="display lp-h2">Everything between "admitted" and "defended"</h2>
          <p className="lp-section-sub">Five rooms, one plan running through all of them.</p>
        </div>
        <div className="lp2-tabs" role="tablist">
          {TOUR.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`lp2-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              <IcoL name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </div>
        <div className="lp2-tour-panel">
          <div>
            <h3>{active.title}</h3>
            <p>{active.body}</p>
            {active.points.map((p, i) => (
              <div className="lp2-point" key={i}><span className="pt"><IcoL name="Check" size={11} color="var(--on-accent)" /></span> {p}</div>
            ))}
          </div>
          <TourVisual id={active.id} lenses={lenses} />
        </div>
      </section>

      {/* The engine — what a chatbot can't do */}
      <EngineShowcase onGetStarted={onGetStarted} />

      {/* How it works */}
      <section className="lp-section" id="how">
        <div className="lp-section-head">
          <div className="lp-eyebrow">How it works</div>
          <h2 className="display lp-h2">Three steps to a clearer PhD</h2>
        </div>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <div className="lp-step" key={i}>
              <div className="lp-step-num">{i + 1}</div>
              <div className="lp-step-ico"><IcoL name={s.icon} size={20} /></div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Lenses */}
      <section className="lp-section" id="lenses">
        <div className="lp-section-head">
          <div className="lp-eyebrow">Your lenses</div>
          <h2 className="display lp-h2">{allLenses.length ? `${allLenses.length} lenses on the same work` : "Every angle on the same work"}</h2>
          <p className="lp-section-sub">One question, read through whichever lens it needs — and every one of them knows what step you're on.</p>
        </div>
        <div className="lp-advisors">
          {lenses.map(a => (
            <div className="lp-advisor" key={a.id}>
              <div className="lp-advisor-i" style={{ background: a.color }}><IcoL name={a.icon} size={20} color="#fff" /></div>
              <div className="lp-advisor-n">{a.name}</div>
              <div className="lp-advisor-r">{a.role}</div>
            </div>
          ))}
          {moreLenses.length > 0 && (
            <div className="lp-advisor lp-advisor-more">
              <div className="lp-advisor-stack">
                {moreLenses.map(a => (
                  <span key={a.id} className="lp-advisor-mini" style={{ background: a.color }}><IcoL name={a.icon} size={13} color="#fff" /></span>
                ))}
              </div>
              <div className="lp-advisor-n">…and {moreLenses.length} more</div>
              <div className="lp-advisor-r">{moreLenses.map(a => a.name).join(" · ")}</div>
            </div>
          )}
        </div>
        <div className="lp-disclaimer">
          <IcoL name="Info" size={15} />
          <span><strong>PhD Navigator does not replace your advisor or graduate office.</strong> It helps you understand requirements, organize information, prepare better questions, and plan your next steps.</span>
        </div>
      </section>

      {/* CTA band */}
      <section className="lp-cta">
        <div className="lp-cta-inner">
          <h2 className="display">Ready to see your path?</h2>
          <p>Upload your handbook and get a plan built on your program's real requirements — in minutes, no credit card.</p>
          <button className="btn lg lp-cta-btn" onClick={onGetStarted}>Start your plan <IcoL name="ArrowRight" size={16} /></button>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-brand">
          <div className="lp-mark sm"><IcoL name="Compass" size={16} color="#fff" /></div>
          <span className="lp-brand-name">PhD Navigator</span>
        </div>
        <div className="lp-footer-meta">© 2026 University of Colorado Boulder · Built on the Neon Advisor platform</div>
      </footer>
    </div>
  );
}

// ============================================================================
// LOGIN  (split warm panel)
// ============================================================================
function CoachLogin({ onAuthed, onBack, onGetStarted, mode = "login" }) {
  const [isSignup, setIsSignup] = useSL(mode === "signup");
  const [email, setEmail] = useSL("");
  const [pw, setPw] = useSL("");
  const [showPw, setShowPw] = useSL(false);
  const [name, setName] = useSL("");
  const [institution, setInstitution] = useSL("");
  const [program, setProgram] = useSL("");
  const [err, setErr] = useSL("");
  const [busy, setBusy] = useSL(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      let authedUser = null;
      if (isSignup) {
        const parts = name.trim().split(/\s+/).filter(Boolean);
        authedUser = await window.CoachAPI.signup({
          firstName: parts[0] || name.trim() || "PhD",
          lastName: parts.slice(1).join(" "),
          email, password: pw, institution, program, researchArea: program
        });
      } else {
        authedUser = await window.CoachAPI.login(email, pw);
      }
      onAuthed(isSignup, authedUser);
    } catch (e) {
      // fetch() throwing a TypeError means the backend is unreachable → fall
      // back to an offline demo session so the app stays usable. A real HTTP
      // error (e.g. wrong password) is surfaced to the user instead.
      if (e instanceof TypeError) {
        const authedUser = window.CoachAPI.demoAuth({ email, name: isSignup ? name : "", institution: isSignup ? institution : "", program: isSignup ? program : "" });
        onAuthed(isSignup, authedUser);
      } else {
        setErr(e.message || "Authentication failed. Please try again.");
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <aside className="auth-aside">
        <button className="auth-back" onClick={onBack}><IcoL name="ArrowLeft" size={15} /> Back to home</button>
        <div className="auth-aside-mid">
          <div className="auth-aside-brand">
            <div className="lp-mark"><IcoL name="Compass" size={20} color="#fff" /></div>
            <span>PhD Navigator</span>
          </div>
          <h2 className="display">{isSignup ? "Your path is waiting." : "Welcome back."}</h2>
          <p>{isSignup
            ? "Tell us about your program and we'll build a plan tuned to exactly where you are."
            : "Pick up right where you left off — your plan, your tools, your progress."}</p>
          <div className="auth-checks">
            <div><span className="ac-dot"><IcoL name="Check" size={12} color="#fff" /></span> A living, step-by-step plan</div>
            <div><span className="ac-dot"><IcoL name="Check" size={12} color="#fff" /></span> Tools that fit each step</div>
            <div><span className="ac-dot"><IcoL name="Check" size={12} color="#fff" /></span> Lenses that know where you are</div>
          </div>
        </div>
        <div className="auth-aside-foot">© 2026 University of Colorado Boulder</div>
      </aside>

      <section className="auth-form-side">
        <div className="auth-form">
          <h1 className="display">{isSignup ? "Create your account" : "Sign in"}</h1>
          <p className="auth-lead">{isSignup ? "Build your starter roadmap in two minutes." : "Continue your PhD journey."}</p>

          {isSignup && (
            <div className="field">
              <label>Full name</label>
              <div className="wrap"><span className="fi"><IcoL name="User" size={15} /></span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>
            </div>
          )}
          {isSignup && (
            <>
              <div className="field">
                <label>University</label>
                <window.AcademicCombo
                  value={institution}
                  onChange={setInstitution}
                  options={LANDING_INSTITUTIONS}
                  placeholder="Choose your university"
                  icon="Building2"
                />
              </div>
              <div className="field">
                <label>Program</label>
                <window.AcademicCombo
                  value={program}
                  onChange={setProgram}
                  options={LANDING_PROGRAMS}
                  placeholder="Choose your program"
                  icon="GraduationCap"
                />
              </div>
            </>
          )}
          <div className="field">
            <label>Email</label>
            <div className="wrap"><span className="fi"><IcoL name="Mail" size={15} /></span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@university.edu" autoComplete="email" /></div>
          </div>
          <div className="field">
            <label>Password</label>
            <div className="wrap"><span className="fi"><IcoL name="Lock" size={15} /></span>
              <input type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" style={{ paddingRight: 42 }} />
              <button type="button" className="auth-eye" onClick={() => setShowPw(s => !s)}><IcoL name={showPw ? "EyeOff" : "Eye"} size={15} /></button>
            </div>
          </div>

          {err && (
            <div style={{ background: "var(--rose-soft)", color: "var(--rose)", borderRadius: "var(--r-sm)",
              padding: "10px 12px", fontSize: 13, margin: "4px 0 10px", display: "flex", gap: 8, alignItems: "center" }}>
              <IcoL name="AlertTriangle" size={15} /> {err}
            </div>
          )}

          <button className="btn primary lg" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
            disabled={busy || !email.trim() || !pw.trim() || (isSignup && !name.trim())} onClick={submit}>
            {busy
              ? <><IcoL name="Loader" size={15} color="#fff" className="spin" /> {isSignup ? "Creating account…" : "Signing in…"}</>
              : <>{isSignup ? "Create account" : "Sign in"} <IcoL name="ArrowRight" size={15} color="#fff" /></>}
          </button>

          <div className="auth-switch">
            {isSignup ? (
              <>Already have an account? <button onClick={() => setIsSignup(false)}>Sign in</button></>
            ) : (
              <>New here? <button onClick={() => setIsSignup(true)}>Create an account</button></>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

window.CoachLanding = CoachLanding;
window.CoachLogin = CoachLogin;
