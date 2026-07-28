/* coach-page-tours.jsx — Per-page first-view walkthroughs.

   Separate from the app-wide welcome tour (coach-tour.jsx): that one runs once
   across the whole app; THIS one fires the first time you open a specific page
   (Documents, Insights, Skills, Defense Room) and highlights the controls on
   that page in place. Seen-state is per page in localStorage, so each page
   teaches itself exactly once. A small "Page tips" pill lets you replay it.

   Exports window.PageTour (drop <window.PageTour page={currentView} /> in the
   shell) and window.PAGE_TOURS (the step definitions, reused by any help UI).

   Reuses the .tour-* CSS from coach-styles.css so it looks identical to the
   welcome tour. Steps anchor to elements marked data-ptour="<key>" on each
   page; a step whose anchor isn't on screen falls back to a centered card. */

(function () {
  const { useState: usePT, useEffect: useEPT, useLayoutEffect: useLPT } = React;
  const IcoPT = window.Icon;

  const key = (page) => `phd-page-tour-${page}-v1`;
  const seen = (page) => { try { return localStorage.getItem(key(page)) === "1"; } catch (e) { return false; } };
  const markSeen = (page) => { try { localStorage.setItem(key(page), "1"); } catch (e) {} };

  // Each step: { anchor?: "<data-ptour key>", center?: bool, icon, title, body }.
  // anchor missing OR element not found → the card centers itself.
  const PAGE_TOURS = {
    documents: [
      { center: true, icon: "FileText", title: "This is your Documents shelf.",
        body: "Everything your program requires you to produce lives here — the forms they emailed you, and the drafts your Skills generate. Here's the 20-second tour." },
      { anchor: "doc-upload", icon: "Upload", title: "Upload what your program sent you",
        body: "Drop in a PDF, Word doc, or text file. Word and text open as fully editable drafts; PDFs are stored so you can read them anytime." },
      { anchor: "doc-dropzone", icon: "UploadCloud", title: "Or drag it right here",
        body: "This dropzone does the same thing — grab a file and let go. We keep your original so you can always download it back." },
      { center: true, icon: "Sparkles", title: "Skills draft documents for you",
        body: "Run a Skill (like “Chapter outline” or “Meeting prep”) and the finished draft lands right here, ready to edit. That's the loop." }
    ],
    insights: [
      { center: true, icon: "Lightbulb", title: "This page composes itself.",
        body: "Every visit, Navigator scores every metric and every block it could show you — from your plan, documents, conversations and check-ins — and keeps only the eight that matter this week. Everything else is set aside, not deleted." },
      { anchor: "ins-kpis", icon: "Gauge", title: "Four metrics, chosen over the rest",
        body: "A dated deadline beats a trend; a signal that moved beats one that sat still. Click any tile to see why it earned the slot and exactly which of your records it was built from." },
      { anchor: "ins-blocks", icon: "LayoutGrid", title: "…and four blocks that earned their space",
        body: "Charts, tables, and written reads, ranked the same way. If one isn't useful, open it and say so — the next candidate takes its place. There's no refresh button: the page rebuilds itself whenever the system learns something new." }
    ],
    skills: [
      { center: true, icon: "Sparkles", title: "Skills are assistants that do the work.",
        body: "Each one is tuned to a single task — find a literature gap, critique your methods, outline a chapter — and drops its result into your Workspace or Documents." },
      { anchor: "sk-search", icon: "Search", title: "Find the right skill",
        body: "Search by what you're trying to do. Turn a skill on with its switch, then hit Run — or “Use in chat” to bring it into a conversation." },
      { anchor: "sk-create", icon: "Wand2", title: "Build your own — no code",
        body: "Describe a task in plain words (“review my draft like an NSF panelist”) and we tune a specialized assistant for it. It shows up alongside the rest." }
    ],
    defense: [
      { center: true, icon: "Presentation", title: "Welcome to the Defense Room.",
        body: "A private room to rehearse before the real thing. Two ways to practice: field committee questions, or present your slides deck out loud and get feedback." },
      { anchor: "def-mode", icon: "LayoutTemplate", title: "Pick how you want to practice",
        body: "“Answer questions” drops you into a committee grilling. “Present your slides” walks you through your deck slide-by-slide while recording you." },
      { anchor: "def-committee", icon: "Users", title: "Choose who grills you",
        body: "Build a committee from advisor personas, or add your real committee members by name so their questions sound like the people you'll actually face." },
      { anchor: "def-materials", icon: "Upload", title: "Bring your materials",
        body: "Upload your slides or draft. Once the backend is wired, your materials seed the questions so they're about your work — not generic ones." },
      { anchor: "def-start", icon: "Play", title: "Flip voice on and go",
        body: "Turn on Voice to hear questions read aloud, then start. Answer by typing or by mic — you'll get a debrief with coverage and gaps at the end." }
    ]
  };

  function PageTour({ page }) {
    const steps = PAGE_TOURS[page] || null;
    // showing: null = decide on mount; true = running; false = done/dismissed.
    const [showing, setShowing] = usePT(null);
    const [i, setI] = usePT(0);
    const [rect, setRect] = usePT(null);

    // Decide whether to auto-run whenever the page changes.
    useEPT(() => {
      setI(0); setRect(null);
      if (steps && !seen(page)) setShowing(true);
      else setShowing(false);
    }, [page]);

    const step = (showing && steps) ? steps[i] : null;
    const isLast = steps ? i === steps.length - 1 : false;

    // Measure the anchored element after the page settles. setTimeout (not rAF)
    // so it still fires when the tab is throttled — same approach as the welcome tour.
    useLPT(() => {
      if (!step) return;
      const measure = () => {
        if (step.center || !step.anchor) { setRect(null); return; }
        const el = document.querySelector(`[data-ptour="${step.anchor}"]`);
        setRect(el ? el.getBoundingClientRect() : null);
      };
      measure();
      const t1 = setTimeout(measure, 60);
      const t2 = setTimeout(measure, 260);
      window.addEventListener("resize", measure);
      window.addEventListener("scroll", measure, true);
      return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
    }, [showing, i, step]);

    if (!steps) return null;

    const finish = () => { markSeen(page); setShowing(false); };
    const replay = () => { setI(0); setRect(null); setShowing(true); };
    const next = () => { if (isLast) finish(); else setI(i + 1); };
    const back = () => setI(Math.max(0, i - 1));

    // When not running, offer a quiet "Page tips" pill so the walkthrough is replayable.
    if (!showing) {
      return (
        <button className="ptour-replay" onClick={replay} title={`Replay the ${page} walkthrough`}>
          <IcoPT name="Sparkles" size={13} /> Page tips
        </button>
      );
    }

    let cardStyle;
    if (rect) {
      const top = Math.min(Math.max(rect.top + rect.height / 2, 130), window.innerHeight - 180);
      cardStyle = { position: "fixed", left: Math.min(rect.right + 18, window.innerWidth - 360), top, transform: "translateY(-50%)" };
    } else {
      cardStyle = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)" };
    }

    return (
      <div className="tour-root">
        {!rect && <div className="tour-dim" onClick={finish} />}
        {rect && (
          <div className="tour-ring" style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }} />
        )}
        <div className={`tour-card ${rect ? "anchored" : "centered"}`} style={cardStyle}>
          {rect && <span className="tour-arrow" />}
          <div className="tour-card-top">
            <span className="tour-ico"><IcoPT name={step.icon} size={17} /></span>
            <span className="tour-step-count">{isLast ? "Last tip" : `${i + 1} of ${steps.length}`}</span>
            <button className="tour-skip" onClick={finish} title="Dismiss"><IcoPT name="X" size={15} /></button>
          </div>
          <h3 className="tour-title display">{step.title}</h3>
          <p className="tour-body">{step.body}</p>
          <div className="tour-dots">
            {steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
          </div>
          <div className="tour-actions">
            <button className="btn ghost sm" onClick={finish}>Skip</button>
            <div style={{ display: "flex", gap: 8 }}>
              {i > 0 && <button className="btn sm" onClick={back}><IcoPT name="ArrowLeft" size={13} /> Back</button>}
              <button className="btn primary sm" onClick={next}>
                {isLast ? <><IcoPT name="Check" size={14} color="#fff" /> Got it</> : <>Next <IcoPT name="ArrowRight" size={14} color="#fff" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.PageTour = PageTour;
  window.PAGE_TOURS = PAGE_TOURS;
})();
