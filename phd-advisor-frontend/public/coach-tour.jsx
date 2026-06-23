/* coach-tour.jsx — Welcome tutorial. A guided, anchored walkthrough that lights
   up each rail destination and explains what the page is for. Auto-navigates the
   app as it goes so you see each page live. Exports window.CoachTour.
   Shares scope; uses window.Icon. */

const { useState: useST, useEffect: useET, useLayoutEffect: useLT, useRef: useRT } = React;
const IcoT = window.Icon;

const TOUR_KEY = "phd-coach-tour-done-v1";

const TOUR_STEPS = [
  { view: null, center: true, icon: "Compass", title: "Welcome — here's the 60-second tour.",
    body: "PhD Navigator isn't a chatbot. It knows your program's milestones, where you are, and what changes when something goes wrong. Let me show you each part." },
  { view: "home", icon: "Home", title: "Home — your command center",
    body: "See how far along you are, what to do next, and a gentle nudge if something's slipping. Start here each day." },
  { view: "plan", icon: "Map", title: "My Plan — your living roadmap",
    body: "Every milestone for your program, in order. Finish one and the plan shows what tools retire and what unlocks next. This is the engine." },
  { view: "chat", icon: "MessageCircle", title: "Chat — advisors who know your plan",
    body: "Ask questions and get answers tuned to your current step. When you describe a change or setback, the AI quietly re-routes your plan on its own." },
  { view: "skills", icon: "Sparkles", title: "Skills — specialized assistants",
    body: "Each skill is tuned to one task — find a literature gap, critique your methods, outline a chapter. They do the work and drop results into your Workspace or Documents." },
  { view: "insights", icon: "Lightbulb", title: "Insights — patterns & focus",
    body: "A read on your momentum and where your attention will pay off most this week." },
  { view: "workspace", icon: "LayoutDashboard", title: "Workspace — your live tools",
    body: "Task boards, reading queues, notes, timers — the tools you and your skills create. Everything stays here and persists." },
  { view: "documents", icon: "FileText", title: "Documents — drafts & deliverables",
    body: "Your real deliverables, scaffolded and ready to edit — meeting prep, chapter outlines, IRB protocols, and more." },
  { view: null, center: true, icon: "Sparkles", title: "That's the tour. You're set.",
    body: "One last thing: if something goes wrong — rejected data, a committee change — just say so in Chat and the plan re-routes around it. You can replay this tour anytime from Settings." }
];

function CoachTour({ onNav, onClose, skillsUnlocked = true }) {
  const [i, setI] = useST(0);
  const [rect, setRect] = useST(null);
  const cardRef = useRT(null);
  // Drop the Skills step from the tour while Skills is still locked.
  const steps = skillsUnlocked ? TOUR_STEPS : TOUR_STEPS.filter(s => s.view !== "skills");
  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;

  // navigate to the step's page so it's shown live behind the tour
  useET(() => { if (step.view) onNav(step.view); }, [i]);

  // measure the highlighted rail item after navigation settles.
  // Uses setTimeout (not rAF) so it still fires when the tab is unfocused/throttled.
  useLT(() => {
    const measure = () => {
      if (step.center || !step.view) { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${step.view}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 240);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [i]);

  const next = () => { if (isLast) finish(); else setI(i + 1); };
  const back = () => setI(Math.max(0, i - 1));
  const finish = () => { try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) {} onClose(); };

  // card position: anchored to the rail item, else centered
  let cardStyle;
  if (rect) {
    const top = Math.min(Math.max(rect.top + rect.height / 2, 130), window.innerHeight - 170);
    cardStyle = { position: "fixed", left: rect.right + 18, top, transform: "translateY(-50%)" };
  } else {
    cardStyle = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)" };
  }

  return (
    <div className="tour-root">
      {!rect && <div className="tour-dim" onClick={finish} />}
      {rect && (
        <div className="tour-ring" style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }} />
      )}
      <div ref={cardRef} className={`tour-card ${rect ? "anchored" : "centered"}`} style={cardStyle}>
        {rect && <span className="tour-arrow" />}
        <div className="tour-card-top">
          <span className="tour-ico"><IcoT name={step.icon} size={17} /></span>
          <span className="tour-step-count">{i === 0 ? "Welcome" : isLast ? "Done" : `${i} of ${steps.length - 2}`}</span>
          <button className="tour-skip" onClick={finish} title="Skip tour"><IcoT name="X" size={15} /></button>
        </div>
        <h3 className="tour-title display">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots">
          {steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
        </div>
        <div className="tour-actions">
          <button className="btn ghost sm" onClick={finish}>Skip</button>
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && <button className="btn sm" onClick={back}><IcoT name="ArrowLeft" size={13} /> Back</button>}
            <button className="btn primary sm" onClick={next}>
              {isLast ? <><IcoT name="Check" size={14} color="#fff" /> Get started</> : isFirst ? <>Start tour <IcoT name="ArrowRight" size={14} color="#fff" /></> : <>Next <IcoT name="ArrowRight" size={14} color="#fff" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CoachTour = CoachTour;
window.COACH_TOUR_KEY = TOUR_KEY;
window.COACH_TOUR_STEPS = TOUR_STEPS; // reused by the Settings Help center
