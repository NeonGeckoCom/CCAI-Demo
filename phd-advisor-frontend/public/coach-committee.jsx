/* coach-committee.jsx — Committee Builder for the "Build Your Committee" step.
   1) Chair-structure helper: decide if one chair or co-chairs fits you.
   2) Add real names → mock match score (BACKEND: faculty-pub overlap model).
   3) "Help me find the best" → suggested faculty (BACKEND: directory search).
   Persists to localStorage. Exposes window.CommitteeBuilder. */

(function () {
  const { useState, useEffect } = React;
  const CIcon = window.Icon;
  const CB_KEY = "phd-tool-committee";

  const cbLoad = () => { try { const r = localStorage.getItem(CB_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } };
  const cbSave = (v) => { try { localStorage.setItem(CB_KEY, JSON.stringify(v)); } catch (e) {} };

  // Deterministic mock score from a name (BACKEND: publication/topic overlap model)
  function mockScore(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return 58 + (h % 38); // 58–95
  }
  const STRENGTHS = ["Topic overlap", "Methods fit", "Funding record", "Responsive mentor", "Grad-rate strong", "Network reach"];
  function mockStrengths(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 17 + name.charCodeAt(i)) >>> 0;
    return [STRENGTHS[h % 6], STRENGTHS[(h >>> 3) % 6]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  }

  // BACKEND: faculty directory + Perplexity search over department pages
  const SUGGESTED = [
    { name: "Dr. Maya Chen", area: "HCI · qualitative methods", outside: false },
    { name: "Dr. Rotimi Okafor", area: "Quantitative modeling · stats", outside: false },
    { name: "Dr. Sarah Whitfield", area: "Information policy", outside: true },
    { name: "Dr. Liam Park", area: "ML & data science", outside: true }
  ];

  const ROLES = ["Chair", "Co-chair", "Member", "Outside member"];

  const QUESTIONS = [
    { id: "twofields", label: "My topic spans two fields" },
    { id: "twomethods", label: "I want two methodological perspectives" },
    { id: "availability", label: "My preferred advisor has limited availability" }
  ];

  function CommitteeBuilder() {
    const [state, setState] = useState(() => cbLoad() || { people: [], answers: {}, helperOpen: true });
    const [name, setName] = useState("");
    const [area, setArea] = useState("");
    useEffect(() => cbSave(state), [state]);

    const yesCount = QUESTIONS.filter(q => state.answers[q.id]).length;
    const recommendCo = yesCount >= 2;
    const answered = Object.keys(state.answers).length > 0;

    const addPerson = (p) => {
      const nm = (p?.name || name).trim(); if (!nm) return;
      if (state.people.some(x => x.name.toLowerCase() === nm.toLowerCase())) { setName(""); return; }
      const person = {
        id: "p" + Date.now(), name: nm, area: p?.area || area.trim() || "—",
        outside: p?.outside || false, role: state.people.length === 0 ? "Chair" : "Member",
        score: mockScore(nm), strengths: mockStrengths(nm)
      };
      setState(s => ({ ...s, people: [...s.people, person] }));
      setName(""); setArea("");
    };
    const remove = (id) => setState(s => ({ ...s, people: s.people.filter(p => p.id !== id) }));
    const setRole = (id, role) => setState(s => ({ ...s, people: s.people.map(p => p.id === id ? { ...p, role, outside: role === "Outside member" ? true : p.outside } : p) }));
    const toggleAnswer = (qid) => setState(s => ({ ...s, answers: { ...s.answers, [qid]: !s.answers[qid] } }));

    // Committee health
    const chairs = state.people.filter(p => p.role === "Chair" || p.role === "Co-chair").length;
    const hasOutside = state.people.some(p => p.outside || p.role === "Outside member");
    const checks = [
      { ok: chairs >= 1, label: chairs === 0 ? "No chair yet" : recommendCo && chairs < 2 ? "Consider a co-chair (your answers point that way)" : "Chair structure set" },
      { ok: state.people.length >= 4, label: `${state.people.length}/4+ members` },
      { ok: hasOutside, label: hasOutside ? "Outside member ✓" : "Outside member missing" }
    ];

    const scoreColor = (s) => s >= 85 ? "var(--sage)" : s >= 70 ? "var(--amber)" : "var(--rose)";

    return (
      <div className="cb">
        {/* 1 · Chair structure helper */}
        <div className="cb-col">
          <div className="cb-h"><CIcon name="GitFork" size={14} /> One chair or two?</div>
          <div className="cb-qs">
            {QUESTIONS.map(q => (
              <button key={q.id} className={`cb-q ${state.answers[q.id] ? "on" : ""}`} onClick={() => toggleAnswer(q.id)}>
                <span className="cb-q-dot">{state.answers[q.id] && <CIcon name="Check" size={11} color="#fff" />}</span> {q.label}
              </button>
            ))}
          </div>
          {answered && (
            <div className={`cb-rec ${recommendCo ? "co" : ""}`}>
              <CIcon name={recommendCo ? "Users" : "User"} size={15} />
              <span><strong>{recommendCo ? "Co-chairs look right for you." : "A single chair looks right for you."}</strong> {recommendCo
                ? "Two chairs cover both fields/methods — confirm your program allows it."
                : "One accountable advisor keeps decisions fast; add breadth through members instead."}</span>
            </div>
          )}

          <div className="cb-h" style={{ marginTop: 16 }}><CIcon name="ShieldCheck" size={14} /> Committee health</div>
          <div className="cb-checks">
            {checks.map((c, i) => (
              <div key={i} className={`cb-check ${c.ok ? "ok" : ""}`}>
                <CIcon name={c.ok ? "CheckCircle2" : "Circle"} size={13} /> {c.label}
              </div>
            ))}
          </div>
        </div>

        {/* 2 · Roster + scoring */}
        <div className="cb-col wide">
          <div className="cb-h"><CIcon name="Users" size={14} /> Your committee · match scores are estimates</div>
          <div className="cb-add">
            <input placeholder="Faculty name (e.g. Dr. Jane Doe)" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPerson()} />
            <input placeholder="Research area (optional)" value={area} onChange={e => setArea(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPerson()} />
            <button className="tool-add" onClick={() => addPerson()} title="Add"><CIcon name="Plus" size={15} color="#fff" /></button>
          </div>

          {state.people.length === 0 && <div className="tool-empty">Type a real name to score them — or pull from suggestions below.</div>}

          <div className="cb-roster">
            {state.people.map(p => (
              <div key={p.id} className="cb-person">
                <div className="cb-score" style={{ "--sc": scoreColor(p.score) }}>
                  <svg width="44" height="44"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
                    <circle cx="22" cy="22" r="18" fill="none" stroke={scoreColor(p.score)} strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 18} strokeDashoffset={2 * Math.PI * 18 * (1 - p.score / 100)} transform="rotate(-90 22 22)" /></svg>
                  <b>{p.score}</b>
                </div>
                <div className="cb-p-main">
                  <div className="cb-p-name">{p.name} {p.outside && <span className="cb-out">outside</span>}</div>
                  <div className="cb-p-area">{p.area}</div>
                  <div className="cb-p-str">{(p.strengths || []).filter(Boolean).map(s => <span key={s}>{s}</span>)}</div>
                </div>
                <select className="cb-role" value={p.role} onChange={e => setRole(p.id, e.target.value)}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
                <button className="tool-del" onClick={() => remove(p.id)}><CIcon name="X" size={13} /></button>
              </div>
            ))}
          </div>

          <div className="cb-h" style={{ marginTop: 14 }}><CIcon name="Sparkles" size={14} /> Or let us help find the best</div>
          <div className="cb-suggest">
            {SUGGESTED.filter(sg => !state.people.some(p => p.name === sg.name)).map(sg => {
              const sc = mockScore(sg.name);
              return (
                <button key={sg.name} className="cb-sug" onClick={() => addPerson(sg)}>
                  <span className="cb-sug-score" style={{ background: scoreColor(sc) }}>{sc}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="cb-p-name" style={{ display: "block" }}>{sg.name} {sg.outside && <span className="cb-out">outside</span>}</span>
                    <span className="cb-p-area">{sg.area}</span>
                  </span>
                  <CIcon name="Plus" size={14} />
                </button>
              );
            })}
          </div>
          <div className="cb-foot"><CIcon name="Globe" size={11} /> Suggestions via faculty-directory search · scores estimate topic + methods overlap, not guarantees</div>
        </div>
      </div>
    );
  }

  window.CommitteeBuilder = CommitteeBuilder;
})();
