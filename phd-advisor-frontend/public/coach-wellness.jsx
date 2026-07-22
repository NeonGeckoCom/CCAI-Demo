/* coach-wellness.jsx — Wellbeing as a personal insight engine.
   A 10-second daily check-in feeds an AI insight that connects mood/stress
   trends to the student's actual PhD life (plan deadlines, work hours, notes,
   coach memory) plus ONE concrete suggested action. External support lives in
   a single quiet row (researched, verified links) — this app connects to help,
   it doesn't impersonate it. Exports window.CoachWellness. */

const { useState: useSW, useEffect: useEW, useRef: useRW } = React;
const IcoW = window.Icon;
const HW = window.coachHelpers;

const WELLNESS_KEY = "phd-coach-wellness-v1";
const MOODS = [
  { v: 1, e: "😞", l: "Rough" },
  { v: 2, e: "😕", l: "Low" },
  { v: 3, e: "😐", l: "Okay" },
  { v: 4, e: "🙂", l: "Good" },
  { v: 5, e: "😄", l: "Great" },
];

// Evidence-backed practices the insight may reference (kept as lookup data,
// not rendered as a brochure — each cites its meta-analysis/trial).
const PRACTICE_DETAILS = {
  "Move most days": { time: "~150 min/week", do_this: "Put 3-5 exercise sessions in your calendar like lab meetings. Even two 20-30 minute brisk walks a week meaningfully lowers depression risk.", why: "Singh et al. 2023, British Journal of Sports Medicine (1,039 trials)." },
  "Schedule things that aren't the thesis": { time: "20-30 min/week", do_this: "Book 3-5 pleasurable or social activities into specific slots and keep them regardless of mood — acting on the plan instead of the mood is the mechanism.", why: "Ekers et al. 2014 meta-analysis; the COBRA trial found it matches full CBT." },
  "Guided online CBT course": { time: "20-60 min/week", do_this: "One module a week of a structured program — your university may include TAO or SilverCloud free, or use moodgym (AU$39).", why: "Harrer et al. 2019 meta-analysis of 48 university-student trials." },
  "Protect your wake time": { time: "Daily habit", do_this: "Fix a consistent wake time within ~30 minutes (weekends too), bright light on waking. Persistent insomnia? Do a digital CBT-I course rather than white-knuckling it.", why: "Freeman et al. 2017 OASIS trial, Lancet Psychiatry (3,755 students)." },
  "Ten minutes of mindfulness": { time: "10-20 min/day", do_this: "Guided practice daily, attached to a fixed cue like morning coffee. Mind wandering and returning IS the exercise.", why: "Goyal et al. 2014, JAMA Internal Medicine (47 trials)." },
  "Self-compassion break": { time: "5 min", do_this: "Name it ('this is a moment of struggle'), normalize it ('most PhD students feel this'), then say what you'd tell a good friend in your exact situation.", why: "Ferrari et al. 2019 meta-analysis (27 randomized trials)." },
  "Real breaks and a shutdown ritual": { time: "5-10 min", do_this: "A genuine micro-break every 60-90 minutes, and a 5-minute end-of-day shutdown: tomorrow's top 3, one line on where you left off, laptop closed.", why: "Albulescu et al. 2022; Wendsche & Lohmann-Haislah meta-analyses." },
  "Put people on the calendar": { time: "1-3 hrs/week", do_this: "One standing social block a week plus one small daily touchpoint — lunch with a labmate instead of at your desk.", why: "Holt-Lunstad et al. 2010, PLoS Medicine (308,849 people)." },
  "Write it out": { time: "15-20 min × 3-4 days", do_this: "After a hard event, write continuously about your deepest thoughts around it for 15-20 minutes on 3-4 consecutive days. Only for yourself.", why: "Frattaroli 2006 meta-analysis (146 studies)." },
  "Engineer the advisor relationship": { time: "30-60 min/week", do_this: "A standing meeting with a sent agenda — progress, blockers, one decision needed. Once a semester, negotiate expectations explicitly.", why: "Levecque et al. 2017 (3,659 PhD students): supervision factors are the strongest work predictors of PhD mental health." },
};

const SUPPORT_LINKS = [
  { name: "988 (call/text)", url: "https://988lifeline.org/", tag: "crisis" },
  { name: "Grad Crisis Line 1-877-472-3457", url: "https://gradresources.org/crisis/", tag: "crisis" },
  { name: "International helplines", url: "https://findahelpline.com/", tag: "crisis" },
  { name: "Free anonymous screening", url: "https://screening.mhanational.org/screening-tools/", tag: "check" },
  { name: "Dragonfly Cafes", url: "https://dragonflymentalhealth.org/", tag: "community" },
  { name: "PhD Balance", url: "https://www.phdbalance.com/", tag: "community" },
  { name: "The Wellbeing Thesis", url: "https://thewellbeingthesis.org.uk/", tag: "read" },
];

const DISCLAIMER = "Check-ins help you notice patterns — they can't diagnose anything, and this app isn't a substitute for professional care. If something feels wrong, trust that feeling and talk to a counselor or doctor.";

function WellSlider({ label, value, onChange, lowLabel, highLabel }) {
  return (
    <div className="well-field">
      <div className="well-field-l">{label} <span className="well-field-v">{value}/5</span></div>
      <input type="range" min={1} max={5} step={1} value={value} onChange={e => onChange(Number(e.target.value))} />
      <div className="well-field-ends"><span>{lowLabel}</span><span>{highLabel}</span></div>
    </div>
  );
}

function CoachWellness({ onNav, roadmap }) {
  const authed = window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed();
  const [local, setLocal] = useSW(() => HW.loadJSON(WELLNESS_KEY, { checkins: [] }));
  useEW(() => HW.saveJSON(WELLNESS_KEY, local), [local]);

  const [summary, setSummary] = useSW(null);
  const [insight, setInsight] = useSW(null);
  const [insightBusy, setInsightBusy] = useSW(false);
  const [mood, setMood] = useSW(0);
  const [energy, setEnergy] = useSW(3);
  const [stress, setStress] = useSW(3);
  const [detail, setDetail] = useSW(false);
  const [sleep, setSleep] = useSW("");
  const [work, setWork] = useSW("");
  const [note, setNote] = useSW("");
  const [saving, setSaving] = useSW(false);
  const [savedFlash, setSavedFlash] = useSW(false);
  const [err, setErr] = useSW("");
  const [supportGlow, setSupportGlow] = useSW(false);
  const supportRef = useRW(null);

  const todayKey = new Date().toISOString().slice(0, 10);

  // ---- roadmap context the insight engine reasons over ---------------------
  const planContext = () => {
    const steps = (roadmap && roadmap.steps) || [];
    const curIdx = steps.findIndex(s => s.status === "current" || s.status === "redo");
    const current = curIdx >= 0 ? steps[curIdx] : null;
    const upcoming = steps.slice(Math.max(0, curIdx), curIdx + 5)
      .map(s => ({ title: s.title, when: s.estimate || s.deadline || "" }));
    return { current_step: current ? current.title : "", upcoming };
  };

  const localSummary = () => {
    const now = Date.now();
    const recent = (local.checkins || []).filter(c => now - c.ts < 14 * 864e5).sort((a, b) => b.ts - a.ts);
    const last7 = recent.filter(c => now - c.ts < 7 * 864e5);
    const avg = (k) => { const v = last7.map(c => c[k]).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
    const s = avg("stress") || 3, e = avg("energy") || 3, m = avg("mood") || 3;
    const score = last7.length ? Math.round(Math.min(100, Math.max(0, (s - 1) / 4 * 40 + (5 - e) / 4 * 30 + (5 - m) / 4 * 30))) : null;
    const level = score == null ? "unknown" : score < 35 ? "low" : score < 65 ? "moderate" : "high";
    const days = new Set(recent.map(c => c.date));
    let streak = 0; const d = new Date();
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
    return {
      count_14d: recent.length, streak, today_logged: days.has(todayKey),
      averages: { mood: avg("mood"), energy: avg("energy"), stress: avg("stress"), sleep_hours: avg("sleep_hours"), work_hours: avg("work_hours") },
      burnout: { level, score, drivers: [] },
      recent: recent.map(c => ({ ...c, created_at: new Date(c.ts).toISOString() })),
    };
  };

  const localInsight = (sum) => {
    const ctx = planContext();
    const b = (sum && sum.burnout) || { level: "unknown" };
    const a = (sum && sum.averages) || {};
    let text;
    if (!sum || sum.count_14d === 0) text = "Log your first check-in and I'll start connecting your energy to what's actually on your plate.";
    else {
      text = `This week you've averaged mood ${a.mood ?? "–"}/5 and stress ${a.stress ?? "–"}/5`;
      if (a.work_hours != null) text += ` on ~${a.work_hours}h workdays`;
      text += ctx.upcoming && ctx.upcoming.length ? `, with "${ctx.upcoming[0].title}" coming up next.` : ".";
      if (b.level === "high") text += " That's a heavy pattern — worth protecting real recovery time this week.";
    }
    return {
      insight: text,
      suggestion_label: b.level === "high" ? "Talk to a human this week" : "Keep the streak going",
      suggestion_detail: b.level === "high" ? "Campus counseling or the Grad Crisis Line — they handle exactly this, every day." : "Daily 10-second check-ins are what make these insights sharp.",
      action: b.level === "high" ? "support" : "none",
      practice: "", cached: false,
    };
  };

  const fetchInsight = async (sum, force) => {
    setInsightBusy(true);
    if (authed) {
      try { setInsight(await window.CoachAPI.wellnessInsight(planContext(), !!force)); setInsightBusy(false); return; } catch (e) {}
    }
    setInsight(localInsight(sum || summary || localSummary()));
    setInsightBusy(false);
  };

  const refresh = async () => {
    let sum = null;
    if (authed) { try { sum = await window.CoachAPI.wellnessSummary(); } catch (e) {} }
    if (!sum) sum = localSummary();
    setSummary(sum);
    fetchInsight(sum, false);
  };
  useEW(() => { refresh(); }, []);

  const submit = async () => {
    if (!mood) { setErr("Pick a mood first — that's the only required part."); return; }
    setErr(""); setSaving(true);
    const payload = {
      mood, energy, stress,
      sleep_hours: sleep === "" ? null : Number(sleep),
      work_hours: work === "" ? null : Number(work),
      note: note.trim(),
    };
    setLocal(l => ({ checkins: [...(l.checkins || []).filter(c => c.date !== todayKey), { ...payload, date: todayKey, ts: Date.now() }] }));
    let sum = null;
    if (authed) {
      try { const r = await window.CoachAPI.wellnessCheckin(payload); sum = r && r.summary; }
      catch (e) { setErr("Couldn't reach the server — your check-in is saved on this device."); }
    }
    if (!sum) sum = localSummary();
    setSummary(sum);
    setSaving(false); setSavedFlash(true); setNote("");
    setTimeout(() => setSavedFlash(false), 3000);
    fetchInsight(sum, true);
  };

  const s = summary;
  const burnout = (s && s.burnout) || { level: "unknown", score: null, drivers: [] };
  const level = burnout.level || "unknown";
  const gaugeColor = level === "high" ? "var(--rose)" : level === "moderate" ? "#D9774B" : "#3E9B6E";

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const c = s && s.recent ? s.recent.find(x => x.date === key) : null;
    days.push({ key, mood: c ? c.mood : null, label: d.toLocaleDateString(undefined, { weekday: "narrow" }) });
  }

  const inst = (window.CoachAPI && window.CoachAPI.getUser && window.CoachAPI.getUser().institution) || "";
  const campusUrl = `https://www.google.com/search?q=${encodeURIComponent((inst || "my university") + " counseling center appointment")}`;

  const showSupport = () => {
    setSupportGlow(true);
    if (supportRef.current) supportRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setSupportGlow(false), 3500);
  };
  const actionButton = (ins) => {
    if (!ins) return null;
    if (ins.action === "plan") return <button className="btn sm primary" onClick={() => onNav && onNav("plan")}><IcoW name="Map" size={13} color="#fff" /> Open My Plan</button>;
    if (ins.action === "chat") return <button className="btn sm primary" onClick={() => onNav && onNav("chat")}><IcoW name="MessageCircle" size={13} color="#fff" /> Talk it through</button>;
    if (ins.action === "support") return <button className="btn sm primary" onClick={showSupport}><IcoW name="LifeBuoy" size={13} color="#fff" /> See support options</button>;
    return null;
  };
  const practice = insight && insight.practice && PRACTICE_DETAILS[insight.practice];

  return (
    <div className="page page-narrow">
      <div className="greeting">
        <h1 className="display" style={{ fontSize: 26 }}>Wellbeing</h1>
        <div className="sub">Ten seconds a day. Your coach connects the dots to what's actually on your plate.</div>
      </div>

      <div className="well-grid">
        {/* ---- Check-in (compact) ---- */}
        <div className="well-card">
          <div className="well-card-h"><IcoW name="Heart" size={16} color="#EC4899" /> {s && s.today_logged ? "Update today" : "Today's check-in"}
            {s && s.streak > 1 && <span className="chip" style={{ marginLeft: "auto" }}>🔥 {s.streak} days</span>}
          </div>
          <div className="well-moods">
            {MOODS.map(m => (
              <button key={m.v} className={`well-mood ${mood === m.v ? "active" : ""}`} onClick={() => setMood(m.v)}>
                <span className="well-mood-e">{m.e}</span><span className="well-mood-l">{m.l}</span>
              </button>
            ))}
          </div>
          <WellSlider label="Energy" value={energy} onChange={setEnergy} lowLabel="Running on empty" highLabel="Fully charged" />
          <WellSlider label="Stress" value={stress} onChange={setStress} lowLabel="Calm" highLabel="Overwhelmed" />
          {!detail ? (
            <button className="well-more" onClick={() => setDetail(true)}><IcoW name="Plus" size={12} /> Add sleep, work hours, or a note</button>
          ) : (
            <>
              <div className="well-hours">
                <label>Sleep last night <input type="number" min="0" max="24" step="0.5" placeholder="h" value={sleep} onChange={e => setSleep(e.target.value)} /></label>
                <label>Work today <input type="number" min="0" max="24" step="0.5" placeholder="h" value={work} onChange={e => setWork(e.target.value)} /></label>
              </div>
              <textarea className="well-note" placeholder="Anything on your mind? Your coach reads this." value={note} onChange={e => setNote(e.target.value)} rows={2} />
            </>
          )}
          {err && <div className="doc-upload-err" style={{ marginBottom: 8 }}><IcoW name="AlertTriangle" size={14} /> {err}</div>}
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={submit}>
            {saving ? <><IcoW name="Loader" size={15} className="spin" color="#fff" /> Saving…</> : savedFlash ? <><IcoW name="Check" size={15} color="#fff" /> Logged.</> : <><IcoW name="Heart" size={15} color="#fff" /> Log check-in</>}
          </button>
          <div className="well-privacy"><IcoW name="Lock" size={12} /> Only your AI coach sees this — never your advisor or program.</div>
        </div>

        {/* ---- Insight ---- */}
        <div className="well-card well-ins-card">
          <div className="well-card-h"><IcoW name="Sparkles" size={16} /> Your insight
            {insight && !insightBusy && <button className="btn icon sm" style={{ marginLeft: "auto" }} title="Regenerate" onClick={() => fetchInsight(s, true)}><IcoW name="RefreshCw" size={13} /></button>}
          </div>
          {insightBusy && !insight ? (
            <div className="well-empty"><IcoW name="Loader" size={14} className="spin" /> Reading your week…</div>
          ) : insight ? (
            <>
              <p className="well-ins-text">{insight.insight}</p>
              {insight.suggestion_label && (
                <div className="well-suggest">
                  <div className="well-suggest-l"><IcoW name="ArrowRight" size={13} /> {insight.suggestion_label}</div>
                  {insight.suggestion_detail && <div className="well-suggest-d">{insight.suggestion_detail}</div>}
                  {practice && (
                    <div className="well-suggest-p">
                      <strong>{insight.practice}</strong> · {practice.time} — {practice.do_this}
                      <span className="well-tk-why" style={{ marginTop: 4 }}><IcoW name="BookOpen" size={11} /> {practice.why}</span>
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>{actionButton(insight)}</div>
                </div>
              )}
            </>
          ) : (
            <div className="well-empty">Log a check-in to get your first insight.</div>
          )}

          {s && s.count_14d > 0 && (
            <>
              <div className="well-gauge" style={{ marginTop: 12 }}>
                <div className="well-gauge-track"><div className="well-gauge-fill" style={{ width: `${burnout.score == null ? 0 : burnout.score}%`, background: gaugeColor }} /></div>
                <div className="well-gauge-meta"><span>Burnout signal: <strong style={{ color: gaugeColor }}>{level === "unknown" ? "—" : level}</strong>{burnout.score != null ? ` (${burnout.score}/100)` : ""}</span></div>
              </div>
              <div className="well-chart" style={{ height: 56 }}>
                {days.map(d => (
                  <div key={d.key} className="well-chart-col" title={d.key}>
                    <div className="well-chart-bar" style={{ height: d.mood ? `${d.mood * 20}%` : "4%", opacity: d.mood ? 1 : 0.25, background: d.mood ? (d.mood >= 4 ? "#3E9B6E" : d.mood >= 3 ? "#D9774B" : "var(--rose)") : "var(--border-2)" }} />
                    <span className="well-chart-l">{d.label}</span>
                  </div>
                ))}
              </div>
              <div className="well-chart-cap">Mood, last 14 days</div>
            </>
          )}
        </div>
      </div>

      {/* ---- Support: one quiet row (glows when the insight points here) ---- */}
      <div ref={supportRef} className={`well-support ${level === "high" || supportGlow ? "urgent" : ""}`}>
        <span className="well-support-l"><IcoW name="LifeBuoy" size={13} /> Need more than a nudge?</span>
        <a className="well-support-a" href={campusUrl} target="_blank" rel="noreferrer" title="Usually free, confidential, and used to PhD problems"><IcoW name="Building2" size={12} /> {inst ? `${inst} counseling` : "Campus counseling"}</a>
        {SUPPORT_LINKS.map((l, i) => <a key={i} className="well-support-a" href={l.url} target="_blank" rel="noreferrer">{l.name}</a>)}
      </div>
      <div className="well-disclaimer" style={{ marginTop: 10 }}><IcoW name="Info" size={13} /> {DISCLAIMER}</div>
    </div>
  );
}

window.CoachWellness = CoachWellness;
