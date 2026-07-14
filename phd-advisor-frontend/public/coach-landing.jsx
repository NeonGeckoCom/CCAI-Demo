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
function CoachLanding({ onGetStarted, onSignIn }) {
  const advisors = (window.ADVISORS || []).slice(0, 3);
  const moreAdvisors = (window.ADVISORS || []).slice(3);
  const steps = [
    { icon: "GraduationCap", title: "Tell us your program", body: "Add your institution, department, degree stage, and handbook." },
    { icon: "Map", title: "Get a starter roadmap", body: "See common milestones, upcoming steps, and missing information — then confirm what we found." },
    { icon: "Sparkles", title: "Personalize over time", body: "Add documents, meeting notes, deadlines, and research plans as your PhD develops." }
  ];
  const features = [
    { icon: "Compass", title: "One living plan", body: "Your program's milestones, your deadlines, and your next three steps — in one place that updates as things change, from first topic to submitting your finished dissertation." },
    { icon: "Users", title: "Advisors on demand", body: "Six specialized AI mentors who know exactly where you are in your plan and tailor every answer to your current step." },
    { icon: "LifeBuoy", title: "Re-plans when things go wrong", body: "Data rejected? Committee change? Describe what happened in plain words and your plan re-routes with concrete recovery steps." }
  ];

  return (
    <div className="lp">
      {/* Nav */}
      <header className="lp-nav">
        <div className="lp-brand">
          <div className="lp-mark"><IcoL name="Compass" size={20} color="#fff" /></div>
          <span className="lp-brand-name">PhD Navigator</span>
        </div>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#engine">The engine</a>
          <a href="#advisors">Advisors</a>
          <a href="#why">Why Navigator</a>
        </nav>
        <div className="lp-nav-cta">
          <button className="btn ghost" onClick={onSignIn}>Sign in</button>
          <button className="btn primary" onClick={onGetStarted}>Get started</button>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge"><IcoL name="Sparkles" size={13} /> Your guided path through the PhD</div>
          <h1 className="display lp-h1">The PhD is a marathon.<br />You deserve a <span className="lp-underline">map</span>.</h1>
          <p className="lp-sub">Turn the doctoral journey into a clear, living plan — built around your program's real milestones, updated as you move.</p>
          <div className="lp-hero-cta">
            <button className="btn primary lg" onClick={onGetStarted}><IcoL name="ArrowRight" size={16} color="#fff" /> Start your plan</button>
            <button className="btn lg" onClick={onSignIn}><IcoL name="LogIn" size={16} /> I have an account</button>
          </div>
          <div className="lp-trust"><IcoL name="ShieldCheck" size={14} /> Free for academic use · your documents stay yours</div>
        </div>
        <div className="lp-hero-art" aria-hidden="true">
          <div className="lp-art-card lp-art-1">
            <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
            <div className="lp-art-tag"><IcoL name="MapPin" size={12} /> You are here</div>
            <div className="lp-art-title">Own the Literature</div>
            <div className="lp-art-ring"><div className="lp-art-ring-fill" /></div>
            <div className="lp-art-row"><span className="lp-art-dot done" /> Build your matrix</div>
            <div className="lp-art-row"><span className="lp-art-dot done" /> Find the gap</div>
            <div className="lp-art-row"><span className="lp-art-dot" /> Write the gap statement</div>
          </div>
          <div className="lp-art-card lp-art-2">
            <span className="lp-preview-pill"><IcoL name="Eye" size={11} /> Preview</span>
            <div className="lp-art-mini-h"><IcoL name="Lightbulb" size={13} color="#fff" /></div>
            <div className="lp-art-mini-t">Example tip</div>
            <div className="lp-art-mini-b">Block 25 minutes today to skim your program handbook.</div>
          </div>
        </div>
      </section>

      {/* The engine — lead with what a chatbot can't do */}
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

      {/* Why / features */}
      <section className="lp-section lp-section-alt" id="why">
        <div className="lp-section-head">
          <div className="lp-eyebrow">Why PhD Navigator</div>
          <h2 className="display lp-h2">Concrete help, not pep talks</h2>
        </div>
        <div className="lp-features">
          {features.map((f, i) => (
            <div className="lp-feature" key={i}>
              <div className="lp-feature-ico"><IcoL name={f.icon} size={22} /></div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Advisors */}
      <section className="lp-section" id="advisors">
        <div className="lp-section-head">
          <div className="lp-eyebrow">Your panel</div>
          <h2 className="display lp-h2">Six advisors, one team</h2>
          <p className="lp-section-sub">Each brings a different lens — and all of them adapt to your current step.</p>
        </div>
        <div className="lp-advisors">
          {advisors.map(a => (
            <div className="lp-advisor" key={a.id}>
              <div className="lp-advisor-i" style={{ background: a.color }}><IcoL name={a.icon} size={20} color="#fff" /></div>
              <div className="lp-advisor-n">{a.name}</div>
              <div className="lp-advisor-r">{a.role}</div>
            </div>
          ))}
          <div className="lp-advisor lp-advisor-more">
            <div className="lp-advisor-stack">
              {moreAdvisors.map(a => (
                <span key={a.id} className="lp-advisor-mini" style={{ background: a.color }}><IcoL name={a.icon} size={13} color="#fff" /></span>
              ))}
            </div>
            <div className="lp-advisor-n">…and three more</div>
            <div className="lp-advisor-r">{moreAdvisors.map(a => a.name).join(" · ")}</div>
          </div>
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
          <p>Build your plan in two minutes. No credit card, no setup headache.</p>
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
  const [email, setEmail] = useSL("alex.morgan@colorado.edu");
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

  const googleDemo = () => {
    const authedUser = window.CoachAPI.demoAuth({ email: email || "you@example.com", name: isSignup ? name : "", institution: isSignup ? institution : "", program: isSignup ? program : "" });
    onAuthed(isSignup, authedUser);
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
            <div><span className="ac-dot"><IcoL name="Check" size={12} color="#fff" /></span> Advisors who know where you are</div>
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
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
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

          <div className="auth-divider"><span>or</span></div>
          <button className="btn lg" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={googleDemo}>
            <IcoL name="Globe" size={15} /> Continue with Google
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
