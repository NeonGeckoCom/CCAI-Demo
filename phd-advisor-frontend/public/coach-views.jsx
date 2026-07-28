/* coach-views.jsx — Insights, Workspace, Documents in the warm coach system.
   Exports window.CoachInsights, window.CoachWorkspace, window.CoachDocuments. */

const { useState: useSV, useEffect: useEV, useMemo: useMV } = React;
const IcoV = window.Icon;
const HV = window.coachHelpers;

const bMd = (s) => (s || "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/* ---------------------------------------------------------------------------
   INSIGHTS — the page that composes itself.

   The page composes itself. On every visit the backend builds a candidate
   library — every metric and every block it could possibly show — scores all of
   them against each other, and hands back the handful that earned a slot plus
   the bench that didn't. Four metrics, four blocks, everything else set aside.

   Two things follow from that, and they are the whole page:

     · The composition is a real markdown document server-side — a ::select
       block with the scores, then a directive per card. It stays behind the
       page: no x-ray toggle, no file viewer. What surfaces instead is the
       drill-in — click any card for why it beat the others and which of your
       records built it.
     · Nothing here is a number the model made up. Every figure is computed
       server-side from real records (check-ins, documents, chat sessions, the
       plan, the deadlines and meetings you logged). The model ranks, titles and
       narrates — it never counts.

   There is deliberately no refresh button. The page recomposes when the system
   has learned something since the last composition, which is the only moment a
   rebuild would change anything.

   Falls back cleanly: an older deployed backend returns the previous `sections`
   schema and gets adapted into cards; with no backend at all the page still
   renders metrics computed from local plan/tool state.

   --------------------------------------------------------------------------- */

(function () {
  const { useState: useS, useEffect: useE, useMemo: useM, useRef: useR } = React;
  const Ico = window.Icon;

  // ---------------------------------------------------------------------------
  // tokens — semantic names from the backend map to theme variables, so the page
  // is correct in dark mode without a second palette.
  // ---------------------------------------------------------------------------
  const TINT = {
    primary: "var(--primary)", sage: "var(--sage)", amber: "var(--amber)",
    rose: "var(--rose)", muted: "var(--border-2)", off: "var(--surface-3)"
  };
  const SOFT = {
    primary: "var(--primary-soft)", sage: "var(--sage-soft)", amber: "var(--amber-soft)",
    rose: "var(--rose-soft)", muted: "var(--surface-2)", off: "var(--surface-2)"
  };
  const tint = (t) => TINT[t] || TINT.primary;
  const soft = (t) => SOFT[t] || SOFT.primary;

  const TYPE_ICON = {
    prose: "Sparkles", callout: "AlertTriangle", area: "TrendingUp", bars: "BarChart3",
    donut: "PieChart", heatmap: "LayoutGrid", tasks: "ListChecks", table: "Table2", quote: "Quote"
  };
  const ID_ICON = {
    wellbeing: "HeartPulse", win: "Star", narrative: "Sparkles", decision: "GitBranch",
    mood_chart: "HeartPulse", work_chart: "Clock", activity: "CalendarDays",
    topic_bars: "BookOpen", milestone_table: "Flag", phase_bars: "Map"
  };
  const iconFor = (b) => ID_ICON[b.id] || TYPE_ICON[b.type] || "Sparkles";

  // Callout skins. `tone` comes from the composer: win / watch / risk.
  const SKIN = {
    win: { bg: "var(--sage-soft)", border: "var(--sage)", accent: "var(--sage)" },
    watch: { bg: "var(--amber-soft)", border: "var(--amber)", accent: "var(--amber)" },
    risk: { bg: "var(--rose-soft)", border: "var(--rose)", accent: "var(--rose)" }
  };

  const fmtAgo = (secs) => secs < 45 ? "just now"
    : secs < 3600 ? `${Math.round(secs / 60)} min ago`
    : secs < 86400 ? `${Math.round(secs / 3600)} hr ago`
    : `${Math.round(secs / 86400)}d ago`;

  // ===========================================================================
  // VIZ — every one reads its numbers straight off the card
  // ===========================================================================

  function Spark({ values, tone }) {
    const vals = (values || []).filter(v => typeof v === "number");
    if (!vals.length) return null;
    const max = Math.max(...vals) || 1;
    const cut = Math.max(0, vals.length - 6);
    return (
      <div className="ix-spark">
        {vals.map((v, i) => (
          <span key={i} style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background: i >= cut ? tint(tone === "warn" ? "rose" : "primary") : "var(--surface-3)"
          }} />
        ))}
      </div>
    );
  }

  // Area chart with the student's own average as the reference line.
  function Area({ b }) {
    const series = (b.series || []).filter(v => typeof v === "number");
    if (series.length < 2) return null;
    const W = 620, H = 138, TOP = 12;
    const max = b.max || Math.max(...series) || 1;
    const x = (i) => 14 + (i * (W - 28)) / (series.length - 1);
    const y = (v) => TOP + (H - TOP) * (1 - Math.min(1, v / max));
    const pts = series.map((v, i) => [x(i), y(v)]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${x(series.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
    const ticks = max > 10 ? [max, max * 0.5, 0] : [max, max / 2, 0];
    const gid = `ixg-${b.id}`;
    const labels = b.xLabels || [];
    const marks = [0, Math.floor(series.length / 3), Math.floor((2 * series.length) / 3), series.length - 1];
    return (
      <div className="ix-area">
        <div className="ix-area-top">
          {b.body && <span className="ix-area-cap">{b.body}</span>}
          <span className="ix-legend">
            <span><i className="ix-key line" /> Logged</span>
            {typeof b.pace === "number" && <span><i className="ix-key dash" /> {b.paceLabel || "Average"}</span>}
          </span>
        </div>
        <div className="ix-area-plot">
          <svg viewBox={`0 0 ${W} 170`} preserveAspectRatio="none" role="img"
            aria-label={`${b.body || b.kicker}. ${series.length} points, high ${Math.max(...series)}, low ${Math.min(...series)}.`}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((v, i) => <line key={i} x1="0" y1={y(v)} x2={W} y2={y(v)} className="ix-gridline" />)}
            <path d={area} fill={`url(#${gid})`} />
            {typeof b.pace === "number" && (
              <path d={`M14 ${y(b.pace).toFixed(1)} L${W - 14} ${y(b.pace).toFixed(1)}`}
                fill="none" stroke="var(--border-2)" strokeWidth="1.6" strokeDasharray="5 5" />
            )}
            <path className="ix-draw" d={line} fill="none" stroke="var(--primary)" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 5 : 3}
                fill="var(--surface)" stroke="var(--primary)" strokeWidth={i === pts.length - 1 ? 3 : 2} />
            ))}
          </svg>
          {ticks.map((v, i) => (
            <span key={i} className="ix-ytick" style={{ top: `${(y(v) / 170) * 100}%` }}>
              {v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v * 10) / 10}
            </span>
          ))}
          {labels.length > 0 && marks.map((i, j) => labels[i] && (
            <span key={j} className="ix-xtick" style={{ left: `${(x(i) / W) * 100}%` }}>{labels[i]}</span>
          ))}
        </div>
        {b.note && <div className="ix-foot"><i className="ix-dot" />{b.note}</div>}
      </div>
    );
  }

  function Bars({ b }) {
    const rows = b.rows || [];
    const max = Math.max(1, ...rows.map(r => r.of || r.value || 0));
    return (
      <div>
        {b.body && <div className="ix-sub">{b.body}</div>}
        <div className="ix-bars">
          {rows.map((r, i) => (
            <div key={i} className="ix-bar">
              <div className="ix-bar-h"><span>{r.name}</span><b>{r.n}</b></div>
              <div className="ix-bar-t">
                <span style={{ width: `${Math.max(2, ((r.value || 0) / max) * 100)}%`, background: tint(r.tint) }} />
              </div>
            </div>
          ))}
        </div>
        {b.note && <div className="ix-foot bordered">{b.note}</div>}
      </div>
    );
  }

  function Donut({ b }) {
    const slices = b.slices || [];
    const C = 2 * Math.PI * 52;
    let acc = 0;
    return (
      <div>
        <div className="ix-donut">
          <svg viewBox="0 0 120 120" role="img" aria-label={slices.map(s => `${s.label} ${s.pct}%`).join(", ")}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="15" />
            {slices.map((s, i) => {
              const len = (s.pct / 100) * C;
              const el = (
                <circle key={i} cx="60" cy="60" r="52" fill="none" strokeWidth="15" stroke={tint(s.tint)}
                  strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`} strokeDashoffset={-acc} />
              );
              acc += len;
              return el;
            })}
          </svg>
          <div className="ix-donut-k">
            {slices.map((s, i) => (
              <div key={i}><i style={{ background: tint(s.tint) }} /><span>{s.label}</span><b>{s.pct}%</b></div>
            ))}
          </div>
        </div>
        {b.note && <div className="ix-foot bordered">{b.note}</div>}
      </div>
    );
  }

  function Heatmap({ b }) {
    const cells = b.cells || [];
    return (
      <div>
        <div className="ix-area-top">
          {b.body && <span className="ix-area-cap">{b.body}</span>}
          <span className="ix-legend">Quiet{[0, 1, 2, 3, 4].map(l => <i key={l} className={`ix-cell l${l}`} />)}Busy</span>
        </div>
        <div className="ix-heat">
          <div className="ix-heat-d"><span>M</span><span /><span>W</span><span /><span>F</span><span /><span>S</span></div>
          <div className="ix-heat-g">
            {cells.map((l, i) => <span key={i} className={`ix-cell l${l}`} />)}
          </div>
        </div>
        {(b.stats || []).length > 0 && (
          <div className="ix-stats">
            {b.stats.map((s, i) => <div key={i}><span>{s.k}</span><b>{s.v}</b></div>)}
          </div>
        )}
      </div>
    );
  }

  function Table({ b }) {
    const cols = b.cols || ["", "", ""];
    return (
      <div className="ix-table">
        <div className="ix-tr head"><span>{cols[0]}</span><span>{cols[1]}</span><span>{cols[2]}</span></div>
        {(b.trows || []).map((r, i) => (
          <div key={i} className="ix-tr">
            <span className="ix-tname"><i style={{ background: tint(r.tint) }} />{r.name}</span>
            <span>{r.c2}</span>
            <span className="ix-tchip" style={{ background: soft(r.tint), color: tint(r.tint) }}>{r.c3}</span>
          </div>
        ))}
      </div>
    );
  }

  function Tasks({ b, done, onToggle }) {
    return (
      <div>
        {b.body && <div className="ix-sub">{b.body}</div>}
        <div className="ix-tasks">
          {(b.items || []).map((a) => {
            const on = !!done[a.id];
            return (
              <button key={a.id} className={`ix-task ${on ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); onToggle(a.id); }}
                aria-pressed={on}>
                <span className="ix-check">{on && <Ico name="Check" size={11} color="var(--on-accent)" />}</span>
                <span className="ix-task-b">
                  <span className="ix-task-t">{a.title}</span>
                  <span className="ix-task-m">
                    {a.due && <em className={a.urgent && !on ? "urgent" : ""}>{a.due}</em>}
                    {a.source && <span>from {a.source}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ===========================================================================
  // CARDS
  // ===========================================================================

  function Kpi({ k, onOpen }) {
    return (
      <button className="ix-kpi" onClick={onOpen} aria-label={`${k.label}: ${k.value}${k.suffix || ""}. Open the reasoning.`}>
        <span className="ix-kpi-l">{k.label}</span>
        <span className="ix-kpi-v">
          <b>{k.value}</b>{k.suffix && <em>{k.suffix}</em>}
        </span>
        {k.viz === "progress" && (
          <span className="ix-track"><i style={{ width: k.pct || "0%", background: tint(k.tint) }} /></span>
        )}
        {k.viz === "pips" && (
          <span className="ix-pips">{(k.pips || []).map((p, i) => <i key={i} style={{ background: tint(p) }} />)}</span>
        )}
        {k.viz === "spark" && <Spark values={k.spark} tone={k.tone} />}
        {k.viz === "delta" && (
          <span className="ix-delta" style={{ background: soft(k.good ? "sage" : "rose"), color: tint(k.good ? "sage" : "rose") }}>
            {k.delta}
          </span>
        )}
        <span className={`ix-kpi-s ${k.tone === "warn" ? "warn" : ""}`}>{k.sub}</span>
      </button>
    );
  }

  function Block({ b, rank, onOpen, done, onToggle }) {
    const skin = SKIN[b.tone];
    const style = { gridColumn: `span ${b.span || 7}` };
    if (skin) { style.background = skin.bg; style.borderColor = skin.border; }
    return (
      <div className={`ix-block ${b.tone ? "toned" : ""}`} style={style} onClick={onOpen}>
        <div className="ix-block-h">
          <span className="ix-block-i" style={skin ? { background: skin.accent, color: "var(--on-accent)" } : null}>
            <Ico name={iconFor(b)} size={14} color={skin ? "var(--on-accent)" : "var(--primary-deep)"} />
          </span>
          <span className="ix-block-k" style={skin ? { color: skin.accent } : null}>{b.kicker}</span>
          <button className="ix-block-r" onClick={(e) => { e.stopPropagation(); onOpen(); }}
            aria-label={`Ranked ${rank}. Why this card is on your page.`} title="Why this card is here">#{rank}</button>
        </div>

        {b.type === "prose" && (
          <div>
            <p className="ix-lead">{b.lead}</p>
            {(b.paras || []).map((p, i) => <p key={i} className="ix-para">{p}</p>)}
          </div>
        )}
        {b.type === "callout" && (
          <div className="ix-callout">
            <p className="ix-lead sm">{b.lead}</p>
            {b.body && <p className="ix-para">{b.body}</p>}
            {b.cta && <span className="ix-cta" style={skin ? { borderColor: skin.border, color: skin.accent } : null}>{b.cta}</span>}
          </div>
        )}
        {b.type === "quote" && (
          <div className="ix-quote">
            <Ico name="Quote" size={20} color="var(--border-2)" />
            <p className="ix-lead">{b.lead}</p>
            <div className="ix-cite"><b>{b.cite}</b>{b.body && <span>{b.body}</span>}</div>
            {b.cta && <span className="ix-cta">{b.cta}</span>}
          </div>
        )}
        {b.type === "area" && <Area b={b} />}
        {b.type === "bars" && <Bars b={b} />}
        {b.type === "donut" && <Donut b={b} />}
        {b.type === "heatmap" && <Heatmap b={b} />}
        {b.type === "table" && <Table b={b} />}
        {b.type === "tasks" && <Tasks b={b} done={done} onToggle={onToggle} />}
      </div>
    );
  }

  // ===========================================================================
  // DRILL-IN PANEL — why this card is on your page, and what it was built from
  // ===========================================================================

  function Panel({ card, kind, rank, total, onClose, onSwap }) {
    useE(() => {
      const esc = (e) => { if (e.key === "Escape") onClose(); };
      window.addEventListener("keydown", esc);
      return () => window.removeEventListener("keydown", esc);
    }, [onClose]);

    if (!card) return null;
    const score = Math.round((card.score || 0) * 100);

    return (
      <div className="ix-panel-root">
        <div className="ix-scrim" onClick={onClose} />
        <aside className="ix-panel" role="dialog" aria-modal="true" aria-label={card.title || card.label || "Details"}>
          <header className="ix-panel-h">
            <span className="ix-eyebrow">{`${kind === "kpi" ? "Metric" : "Block"} · ranked ${rank} of ${total}`}</span>
            <button className="ix-x" onClick={onClose} aria-label="Close"><Ico name="X" size={15} /></button>
          </header>

          <div className="ix-panel-b">
            <h3 className="display ix-panel-t">{card.title || card.label}</h3>
            {card.why && <p className="ix-panel-w">{card.why}</p>}

            <div className="ix-score">
              <div className="ix-score-h"><span>Why this made the cut</span><span>{score} / 100</span></div>
              <div className="ix-score-t"><i style={{ width: `${score}%` }} /></div>
              {card.note && <p>{card.note}</p>}
            </div>

            {(card.evidence || []).length > 0 && (
              <>
                <div className="ix-eyebrow block">What this was built from</div>
                <div className="ix-ev">
                  {card.evidence.map((e, i) => (
                    <div key={i} className="ix-ev-r">
                      <span className="ix-ev-t" style={{ background: soft(e.tint), color: tint(e.tint) }}>{e.tag}</span>
                      <span><b>{e.label}</b><em>{e.when}</em></span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {onSwap && (
              <button className="btn sm ix-swap" onClick={onSwap}>
                <Ico name="Shuffle" size={13} /> Not useful — show something else
              </button>
            )}
          </div>
        </aside>
      </div>
    );
  }

  // ===========================================================================
  // LOCAL FALLBACKS — the page still says something true with no backend, and
  // adapts an older backend's `sections` payload into cards.
  // ===========================================================================

  function localKpis(local) {
    const out = [];
    const { steps, stepsDone, tasksDone, tasksTotal, docs, words, deadlines } = local;
    if (steps) out.push({
      id: "milestones", label: "Milestones done", value: String(stepsDone), suffix: `/ ${steps}`,
      sub: local.current ? `Now: ${local.current}` : "Straight from My Plan.", viz: "progress",
      pct: `${Math.round((stepsDone / steps) * 100)}%`, tint: "primary", score: 0.7,
      why: "Milestones marked done in My Plan, counted in your browser.",
      note: "Computed locally — the composer isn't reachable right now.",
      evidence: [{ tag: "PLAN", label: `${steps}-step roadmap`, when: "My Plan", tint: "sage" }]
    });
    if (tasksTotal) out.push({
      id: "tasks", label: "Tasks done", value: String(tasksDone), suffix: `/ ${tasksTotal}`,
      sub: `${Math.round((tasksDone / tasksTotal) * 100)}% of everything on your plan.`, viz: "pips",
      pips: Array.from({ length: 5 }, (_, i) => i < Math.round((tasksDone / tasksTotal) * 5) ? "sage" : "off"),
      score: 0.6, why: "Sub-tasks checked off across every milestone in My Plan.",
      note: "Computed locally.", evidence: [{ tag: "PLAN", label: `${tasksTotal} tasks on the plan`, when: "My Plan", tint: "sage" }]
    });
    const late = deadlines.filter(d => d.days < 0);
    if (late.length) out.push({
      id: "overdue", label: "Overdue items", value: String(late.length), sub: `Oldest is ${Math.abs(late[0].days)} days past.`,
      tone: "warn", viz: "delta", delta: `${Math.abs(late[0].days)} days late`, good: false, score: 0.85,
      why: "Deadlines you added whose date has passed.", note: "A date that has gone by outranks everything soft.",
      evidence: late.slice(0, 3).map(d => ({ tag: "PLAN", label: d.label, when: `${Math.abs(d.days)} days overdue`, tint: "rose" }))
    });
    else if (deadlines.length) out.push({
      id: "next_deadline", label: `Days to ${deadlines[0].label.slice(0, 24)}`, value: String(deadlines[0].days),
      sub: deadlines[0].days <= 7 ? "This week." : "Next dated thing on your list.", viz: "progress",
      pct: `${Math.max(4, 100 - Math.min(100, deadlines[0].days * 2))}%`, tint: deadlines[0].days <= 14 ? "amber" : "primary",
      score: 0.8, why: `Counted from today to ${deadlines[0].date}, the nearest deadline you've entered.`,
      note: "A real date always beats a trend.",
      evidence: deadlines.slice(0, 3).map(d => ({ tag: "PLAN", label: d.label, when: d.date, tint: "amber" }))
    });
    if (docs) out.push({
      id: "library_words", label: "Words in your library", value: words >= 1000 ? `${Math.round(words / 1000)}k` : String(words),
      sub: `Across ${docs} document${docs === 1 ? "" : "s"}.`, viz: "delta", delta: `${docs} on the shelf`, good: true, score: 0.5,
      why: "Every word in every document on your shelf.", note: "Inventory, not insight.",
      evidence: [{ tag: "DOC", label: `${docs} documents`, when: "Documents shelf", tint: "sage" }]
    });
    return out;
  }

  // First sentence / the rest. Plain split — lookbehind regexes are still a
  // compatibility gamble in browsers this app has to run in.
  function firstSentence(text) {
    const s = String(text || "").trim();
    const i = s.indexOf(". ");
    return i > 0 ? [s.slice(0, i + 1), s.slice(i + 2).trim()] : [s, ""];
  }

  // Older backend: { sections: [...] }. Map each section onto the card model so
  // the page looks identical whichever API answers.
  function adaptLegacy(sections, local) {
    const kpis = [];
    const blocks = [];
    (sections || []).forEach((s, i) => {
      const base = 0.9 - i * 0.05;
      if (s.type === "highlight") {
        kpis.push({
          id: `hl${i}`, label: s.label || "Highlight", value: s.stat, sub: s.comment || "", viz: "none",
          score: base, why: s.comment || "", note: "Composed by the previous version of the brain.",
          evidence: [{ tag: "DATA", label: "Composed from your accumulated notes", when: "This visit", tint: "sage" }]
        });
      } else if (s.type === "actions") {
        blocks.push({
          id: `act${i}`, type: "tasks", kicker: s.title || "What to do next", span: 5, score: base,
          body: "Pulled from your notes — you never typed these.",
          items: (s.items || []).map((t, j) => ({ id: `act${i}-${j}`, title: t, due: "", source: "", urgent: false })),
          title: s.title || "What to do next", why: "Extracted from everything the coach has written down about you.",
          md: [`::tasks{id=act${i}}`], evidence: [{ tag: "DATA", label: "Composed from your notes", when: "This visit", tint: "sage" }]
        });
      } else if (s.type === "chart") {
        const b = local.chartBlocks[s.series];
        if (b) blocks.push(Object.assign({}, b, {
          id: `ch${i}-${s.series}`, kicker: s.title || b.kicker, note: s.comment || b.note, score: base
        }));
      } else if (s.type === "narrative" && s.body) {
        const tone = s.tone === "win" ? "win" : s.tone === "watch" ? "watch" : "";
        const [lead, rest] = firstSentence(s.body);
        const why = "Written from everything the coach has recorded about you.";
        const ev = [{ tag: "DATA", label: "Composed from your notes", when: "This visit", tint: "sage" }];
        blocks.push(tone
          ? { id: `nar${i}`, type: "callout", tone, kicker: s.title || "Worth noticing", span: 5, score: base,
              lead, body: rest, title: s.title || "", why, md: [`::callout{kind=${tone}}`], evidence: ev }
          : { id: `nar${i}`, type: "prose", kicker: s.title || "What I'm seeing", span: 7, score: base,
              lead, paras: rest ? [rest] : [], title: s.title || "", why, md: [`::prose{id=nar${i}}`], evidence: ev });
      }
    });
    return { kpis, blocks };
  }

  // Charts the browser can build on its own, from data it already has.
  function localChartBlocks(wellness, phases, docs) {
    const recent = (wellness && wellness.recent) || [];
    const out = {};
    const mood = recent.map(c => c.mood).filter(v => v != null).reverse();
    if (mood.length >= 4) out.mood_stress = {
      type: "area", kicker: "How the weeks have felt", span: 7, series: mood.slice(-14), max: 5,
      pace: Math.round((mood.reduce((a, b) => a + b, 0) / mood.length) * 10) / 10, paceLabel: "Your average",
      body: "Mood per check-in", xLabels: recent.filter(c => c.mood != null).map(c => (c.date || "").slice(5)).reverse().slice(-14),
      title: "Your mood line, plotted", why: "Every mood rating you logged, in order, against your own average.",
      md: ["::chart{type=area src=wellbeing-checkins field=mood}"],
      evidence: [{ tag: "DATA", label: `${mood.length} mood ratings`, when: "Wellbeing check-ins", tint: "sage" }]
    };
    const work = recent.map(c => c.work_hours).filter(v => v != null).reverse();
    if (work.length >= 4) out.work_hours = {
      type: "area", kicker: "Hours, day by day", span: 7, series: work.slice(-14), max: Math.max(10, ...work),
      pace: Math.round((work.reduce((a, b) => a + b, 0) / work.length) * 10) / 10, paceLabel: "Your average",
      body: "Hours worked per day", xLabels: recent.filter(c => c.work_hours != null).map(c => (c.date || "").slice(5)).reverse().slice(-14),
      title: "Where the hours actually went", why: "Self-reported hours from each check-in, against your own average.",
      md: ["::chart{type=area src=wellbeing-checkins field=work_hours}"],
      evidence: [{ tag: "DATA", label: `${work.length} days logged`, when: "Wellbeing check-ins", tint: "sage" }]
    };
    const withTasks = (phases || []).filter(p => p.tasksTotal);
    if (withTasks.length) out.phase_progress = {
      type: "bars", kicker: "Progress by phase", span: 5, body: "Tasks completed in each phase of your plan",
      rows: withTasks.map(p => ({
        name: p.phase, n: `${p.tasksDone}/${p.tasksTotal}`, value: p.tasksDone, of: p.tasksTotal,
        tint: p.tasksDone >= p.tasksTotal ? "sage" : p.tasksDone ? "primary" : "muted"
      })),
      title: "Which phase is carrying the work", why: "Task completion per phase, read directly off My Plan.",
      md: ["::chart{type=bar src=plan group=phase}"],
      evidence: [{ tag: "PLAN", label: `${withTasks.length} phases with tasks`, when: "My Plan", tint: "sage" }]
    };
    const bySource = {};
    (docs || []).forEach(d => { const k = d.source || "documents"; bySource[k] = (bySource[k] || 0) + 1; });
    const keys = Object.keys(bySource);
    if (keys.length > 1) {
      const total = docs.length;
      const palette = ["primary", "sage", "amber", "muted"];
      out.library = {
        type: "donut", kicker: "What's on your shelf", span: 5,
        slices: keys.sort((a, b) => bySource[b] - bySource[a]).slice(0, 4).map((k, i) => ({
          label: k.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          pct: Math.round((bySource[k] / total) * 100), tint: palette[i % 4]
        })),
        note: `${total} documents in total, grouped by where each one came from.`,
        title: "Your library, by origin", why: "Every document on your shelf, grouped by origin.",
        md: ["::chart{type=donut src=documents group=source}"],
        evidence: [{ tag: "DOC", label: `${total} documents`, when: "Documents shelf", tint: "sage" }]
      };
    }
    return out;
  }

  const loadLocal = (key) => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } };

  // ===========================================================================
  // PAGE
  // ===========================================================================

  const GEN_STEPS = [
    "Reading the documents on your shelf",
    "Scanning your conversations and check-ins",
    "Scoring every metric and block it could show",
    "Keeping the ones that matter this week…"
  ];

  function CoachInsights({ onNav, roadmap, doneTasks }) {
    const authed = !!(window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed());
    const [phase, setPhase] = useS("gen");      // gen | ready | empty | offline
    const [step, setStep] = useS(0);
    const [brain, setBrain] = useS(null);
    const [wellness, setWellness] = useS(null);
    const [docs, setDocs] = useS([]);
    const [chats, setChats] = useS(0);
    const [panel, setPanel] = useS(null);        // {kind:"kpi"|"block"|"md", id}
    const [banned, setBanned] = useS({});
    const [done, setDone] = useS({});
    const [ago, setAgo] = useS(0);
    const composedAt = useR(null);

    // ---- plan + local tool state ------------------------------------------
    const local = useM(() => {
      const steps = (roadmap && roadmap.steps) || [];
      const byPhase = {};
      steps.forEach(s => {
        const p = s.phase || "Plan";
        byPhase[p] = byPhase[p] || { phase: p, done: 0, total: 0, tasksDone: 0, tasksTotal: 0 };
        byPhase[p].total++;
        if (s.status === "done") byPhase[p].done++;
        const subs = s.subtasks || [];
        byPhase[p].tasksTotal += subs.length;
        byPhase[p].tasksDone += subs.filter(t => doneTasks && doneTasks.has(`${s.id}::${t}`)).length;
      });
      const phases = Object.values(byPhase);
      const cur = steps.find(s => s.status === "current" || s.status === "redo");
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = (iso) => Math.round((new Date(iso).setHours(0, 0, 0, 0) - today) / 86400000);
      const deadlines = loadLocal("phd-coach-deadlines-v1")
        .filter(d => d && d.date && (d.label || d.title) && !d.done)
        .map(d => ({ label: String(d.label || d.title), date: d.date, days: days(d.date) }))
        .sort((a, b) => a.days - b.days);
      const meetings = loadLocal("phd-coach-meetings-v1")
        .filter(m => m && m.date)
        .map(m => ({ title: m.title || m.with || "Meeting", date: m.date, with: m.with || "" }));
      return {
        phases, steps: steps.length, stepsDone: steps.filter(s => s.status === "done").length,
        current: cur ? cur.title : "", program: (roadmap && roadmap.program && roadmap.program.name) || "",
        tasksDone: phases.reduce((a, p) => a + p.tasksDone, 0),
        tasksTotal: phases.reduce((a, p) => a + p.tasksTotal, 0),
        deadlines, meetings,
        planSteps: steps.slice(0, 10).map(s => ({ title: s.title, phase: s.phase, status: s.status }))
      };
    }, [roadmap, doneTasks]);

    const context = () => ({
      plan: {
        program: local.program, total_steps: local.steps, done_steps: local.stepsDone,
        current: local.current, phases: local.phases, steps: local.planSteps
      },
      deadlines: local.deadlines.map(d => ({ label: d.label, date: d.date })),
      meetings: local.meetings
    });

    // ---- compose -----------------------------------------------------------
    useE(() => {
      let alive = true;
      if (!authed) { setPhase("offline"); return; }
      setPhase("gen"); setStep(1);
      (async () => {
        const api = window.CoachAPI;
        const [w, d, k, s] = await Promise.all([
          api.wellnessSummary().catch(() => null),
          api.listLibraryDocs().catch(() => null),
          api.getKnowledge().catch(() => null),
          api.listSessions().catch(() => null)
        ]);
        if (!alive) return;
        if (w) setWellness(w);
        if (d) setDocs(d.documents || []);
        if (Array.isArray(s)) setChats(s.length);
        setStep(2);

        let b = null;
        try { b = await api.insightsBrain(context(), false); }
        catch (e) { if (e && e.status === 404) b = { unavailable: true }; }
        if (!alive) return;
        setStep(3);

        // Living page: if the system has learned something since this layout was
        // composed, recompose now. This is what the refresh button used to be.
        try {
          const learned = k && k.updated_at ? Date.parse(k.updated_at) : 0;
          const made = b && b.created_at ? Date.parse(b.created_at) : 0;
          if (b && b.cached && learned && made && learned > made) {
            const fresh = await window.CoachAPI.insightsBrain(context(), true);
            if (fresh) b = fresh;
          }
        } catch (e) {}
        if (!alive) return;
        setStep(4);
        setBrain(b);
        composedAt.current = b && b.created_at ? Date.parse(b.created_at) : Date.now();
        setAgo(Math.max(0, Math.round((Date.now() - composedAt.current) / 1000)));
        setTimeout(() => { if (alive) setPhase("ready"); }, 420);
      })();
      return () => { alive = false; };
    }, [authed]);

    useE(() => {
      if (phase !== "ready" || !composedAt.current) return;
      const t = setInterval(() => setAgo(Math.round((Date.now() - composedAt.current) / 1000)), 15000);
      return () => clearInterval(t);
    }, [phase]);

    // ---- resolve the page --------------------------------------------------
    const chartBlocks = useM(() => localChartBlocks(wellness, local.phases, docs), [wellness, local.phases, docs]);
    const page = useM(() => {
      const fallbackK = localKpis(Object.assign({}, local, { docs: docs.length, words: docs.reduce((a, d) => a + (d.word_count || 0), 0) }));
      if (brain && (brain.kpis || brain.blocks)) {
        return {
          kpis: brain.kpis && brain.kpis.length ? brain.kpis : fallbackK,
          blocks: brain.blocks || [],
          headline: brain.headline || "",
          markdown: brain.markdown || "",
          considered: brain.considered || { kpis: (brain.kpis || []).length, blocks: (brain.blocks || []).length },
          stats: brain.stats || {}
        };
      }
      if (brain && brain.sections && brain.sections.length) {
        const a = adaptLegacy(brain.sections, { chartBlocks });
        // The old schema rarely produced four highlights — top the row up with
        // metrics the browser can compute itself rather than leave holes.
        const kpis = a.kpis.concat(fallbackK.filter(k => !a.kpis.some(x => x.id === k.id)));
        return {
          kpis, blocks: a.blocks, headline: "", markdown: "", legacy: true,
          considered: { kpis: kpis.length, blocks: a.blocks.length }, stats: {}
        };
      }
      const blocks = Object.keys(chartBlocks).map((k, i) => Object.assign({ id: k, score: 0.6 - i * 0.05 }, chartBlocks[k]));
      return { kpis: fallbackK, blocks, headline: "", markdown: "", local: true,
        considered: { kpis: fallbackK.length, blocks: blocks.length }, stats: {} };
    }, [brain, chartBlocks, local, docs]);

    const keptK = useM(() => page.kpis.filter(k => !banned[k.id]).slice(0, 4), [page, banned]);
    const keptB = useM(() => page.blocks.filter(b => !banned[b.id]).slice(0, 4), [page, banned]);

    // The composer sizes the first four; anything promoted off the bench needs a
    // span of its own so the grid never leaves a hole.
    const spans = useM(() => {
      let flip = true;
      return keptB.map(b => {
        if (b.span === 12) return 12;
        const s = flip ? 7 : 5; flip = !flip; return s;
      });
    }, [keptB]);

    const totalConsidered = (page.considered.kpis || 0) + (page.considered.blocks || 0);
    const setAside = Math.max(0, totalConsidered - keptK.length - keptB.length);

    const openCard = (kind, id) => setPanel({ kind, id });
    const panelList = panel ? (panel.kind === "kpi" ? page.kpis : page.blocks) : [];
    const panelCard = panel ? panelList.find(c => c.id === panel.id) : null;
    const panelRank = panelCard ? panelList.findIndex(c => c.id === panel.id) + 1 : 0;
    const panelTotal = panel && panel.kind === "kpi" ? (page.considered.kpis || page.kpis.length)
      : (page.considered.blocks || page.blocks.length);

    const swap = () => {
      if (!panel) return;
      setBanned(prev => Object.assign({}, prev, { [panel.id]: true }));
      setPanel(null);
    };
    const toggleTask = (id) => setDone(prev => {
      const next = Object.assign({}, prev);
      if (next[id]) delete next[id]; else next[id] = true;
      return next;
    });

    // ---- header ------------------------------------------------------------
    const header = (
      <div className="ix-top">
        <div className="ix-top-l">
          <div className="ix-eyebrow">{local.program || "Your PhD"}</div>
          <div className="ix-top-s">
            {local.current ? `Now: ${local.current}` : "Insights composes itself from everything the system knows."}
          </div>
        </div>
      </div>
    );

    // ---- generating --------------------------------------------------------
    if (phase === "gen") {
      return (
        <div className="page ix">
          {header}
          <div className="ix-gen solo">
            <div className="ix-gen-h">
              <span className="ix-ring" />
              <h1 className="display">Reading your canvas…</h1>
            </div>
            <p className="ix-gen-p">
              Insights rebuilds itself whenever the system has learned something new. It scores every
              metric and block it could show you, then keeps only the eight that matter this week.
            </p>
            <div className="ix-gen-steps">
              {GEN_STEPS.map((label, i) => {
                const state = step > i + 1 ? "done" : step === i + 1 ? "on" : "";
                return (
                  <div key={i} className={`ix-gen-s ${state}`}>
                    <span className="ix-gen-d"><i /></span>{label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    // ---- signed out --------------------------------------------------------
    if (phase === "offline") {
      return (
        <div className="page ix">
          {header}
          <div className="ix-note">
            <Ico name="WifiOff" size={16} />
            <div>
              <b>Sign in to compose your Insights.</b>
              <span>This page is written from everything in your account — your plan, documents,
                conversations and check-ins. None of it leaves your account.</span>
            </div>
          </div>
        </div>
      );
    }

    const empty = !keptK.length && !keptB.length;

    return (
      <div className="page ix">
        {header}

        {brain && brain.unavailable && (
          <div className="ix-note warn">
            <Ico name="AlertTriangle" size={16} />
            <div>
              <b>The deployed backend is older than this app.</b>
              <span>The composer isn't on this API yet, so the page below is built from what your
                browser already knows. Redeploy the backend and it composes itself properly.</span>
            </div>
          </div>
        )}
        {page.legacy && (
          <div className="ix-note">
            <Ico name="Info" size={16} />
            <div>
              <b>Composed by the previous version of the brain.</b>
              <span>Scores and evidence trails arrive once the backend is on the current build.</span>
            </div>
          </div>
        )}

        {empty ? (
          <div className="ix-note">
            <Ico name="Sparkles" size={16} />
            <div>
              <b>There's nothing to read yet.</b>
              <span>Add a milestone, upload a document, log a check-in or have a conversation — this
                page composes itself the moment it has something true to say.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="ix-head">
              <div>
                <div className="ix-eyebrow live">
                  <i className="ix-pulse" />
                  {`Composed ${fmtAgo(ago)}`}
                  {totalConsidered ? ` · kept ${keptK.length + keptB.length} of ${totalConsidered}` : ""}
                  {page.stats.documents ? ` · ${page.stats.documents} docs` : docs.length ? ` · ${docs.length} docs` : ""}
                  {page.stats.conversations || chats ? ` · ${page.stats.conversations || chats} chats` : ""}
                </div>
                {page.headline && <h1 className="display ix-headline">{page.headline}</h1>}
              </div>
            </div>

            {keptK.length > 0 && (
              <div className="ix-kpis" data-ptour="ins-kpis">
                {keptK.map((k, i) => (
                  <Kpi key={k.id} k={k} onOpen={() => openCard("kpi", k.id)} />
                ))}
              </div>
            )}

            {keptB.length > 0 && (
              <div className="ix-blocks" data-ptour="ins-blocks">
                {keptB.map((b, i) => (
                  <Block key={b.id} b={Object.assign({}, b, { span: spans[i] })} rank={i + 1}
                    onOpen={() => openCard("block", b.id)} done={done} onToggle={toggleTask} />
                ))}
              </div>
            )}

            {setAside > 0 && (
              <div className="ix-bench">
                <span className="ix-rule" />
                {setAside} other {setAside === 1 ? "candidate was" : "candidates were"} scored and set aside on this visit.
              </div>
            )}
          </>
        )}

        {panel && (
          <Panel card={panelCard} kind={panel.kind} rank={panelRank} total={panelTotal}
            onClose={() => setPanel(null)}
            onSwap={(page.kpis.length + page.blocks.length) > 8 ? swap : null} />
        )}
      </div>
    );
  }

  window.CoachInsights = CoachInsights;
})();


// ============================================================================
// WORKSPACE — widget dashboard with presets + palette
// ============================================================================
const WS_KEY = "phd-coach-workspace-v1";

// Suggested widgets per current milestone (BACKEND: stage-aware ranking)
const WS_SUGGEST = {
  "orientation": ["notes", "deadlines", "meeting-log", "phd-journey"],
  "topic-ideas": ["bibliography", "reading-queue", "notes", "meeting-log"],
  "committee": ["meeting-log", "deadlines", "notes", "calendar"],
  "literature": ["reading-queue", "bibliography", "highlights", "notes"],
  "proposal": ["outline", "writing", "deadlines", "reviewer-2"],
  "prelim": ["reading-queue", "kanban", "pomodoro", "deadlines"],
  "candidacy": ["deadlines", "meeting-log", "notes", "calendar"],
  "irb": ["kanban", "deadlines", "documenter", "notes"],
  "pilot": ["kanban", "documenter", "deadlines", "activity"],
  "collection": ["documenter", "kanban", "habits", "deadlines"],
  "analysis": ["kanban", "documenter", "writing", "pomodoro"],
  "writing": ["writing", "outline", "latex", "pomodoro"],
  "early-writing": ["writing", "outline", "notes", "pomodoro"],
  "first-paper": ["bibliography", "deadlines", "writing", "kanban"],
  "defense": ["pomodoro", "kanban", "deadlines", "notes"],
  "submission": ["deadlines", "kanban", "notes", "calendar"]
};
const wsSuggestFor = (roadmap) => {
  const cur = roadmap?.steps?.find(s => s.status === "current") || roadmap?.steps?.find(s => s.status === "redo");
  return (cur && WS_SUGGEST[cur.id]) || ["notes", "reading-queue", "deadlines", "pomodoro"];
};

// `embedded` renders one white "Tools" box on the Home page (its own row) that
// holds up to three widgets. Non-embedded is the full standalone Workspace page.
// Both share the WS_KEY store, so it's one workspace.
function CoachWorkspace({ roadmap, embedded }) {
  const [layout, setLayout] = useSV(() => HV.loadJSON(WS_KEY, []));
  const [paletteOpen, setPaletteOpen] = useSV(false);
  const [wsPage, setWsPage] = useSV(0);
  useEV(() => HV.saveJSON(WS_KEY, layout), [layout]);

  const EMBED_MAX = 3;
  const addWidget = (type) => setLayout(p => [...p, { id: `w-${type}-${Date.now()}`, type, size: "M" }]);
  const applyPreset = (preset) => setLayout(preset.layout.map((type, i) => ({ id: `w-${type}-${Date.now()}-${i}`, type, size: "M" })));
  const remove = (id) => setLayout(p => p.filter(w => w.id !== id));
  const cycle = (id) => setLayout(p => p.map(w => w.id === id ? { ...w, size: w.size === "S" ? "M" : w.size === "M" ? "L" : "S" } : w));

  const curStep = roadmap?.steps?.find(s => s.status === "current");
  const suggested = wsSuggestFor(roadmap);
  const palette = paletteOpen && <WidgetPalette onClose={() => setPaletteOpen(false)} onAdd={(t) => { addWidget(t); setPaletteOpen(false); }} suggested={suggested} stepTitle={curStep?.title} />;

  const widgetCard = (w) => {
    const isCustom = w.type === "custom";
    const def = isCustom
      ? { type: "custom", name: w.custom?.title || "Custom tool", icon: "Wand2" }
      : (window.WIDGET_CATALOG || []).find(d => d.type === w.type);
    if (!def) return null;
    return (
      <div key={w.id} className={`ws-widget size-${w.size} ${def.critic ? "critic" : ""}`}>
        <div className="ws-w-head">
          <span className="ws-w-ico"><IcoV name={def.icon} size={14} /></span>
          <span className="ws-w-title">{def.name}{isCustom && <span className="ws-custom-tag">custom</span>}</span>
          <button className="ws-size" onClick={() => cycle(w.id)} title="Resize: S = 3 per row, M = 2, L = full row">{w.size}</button>
          <button className="ws-w-del" onClick={() => remove(w.id)} aria-label={`Remove ${def.name}`}><IcoV name="Trash2" size={13} /></button>
        </div>
        <div className="ws-w-body">{isCustom ? (window.CustomTool ? <window.CustomTool inst={w.custom} /> : null) : <WidgetBody def={def} seed={w.seed} />}</div>
      </div>
    );
  };

  // Home: one white Tools box, three widgets per page — paginate the rest.
  if (embedded) {
    const pages = Math.max(1, Math.ceil(layout.length / EMBED_MAX));
    const curPage = Math.min(wsPage, pages - 1);
    const shown = layout.slice(curPage * EMBED_MAX, curPage * EMBED_MAX + EMBED_MAX);
    return (
      <section className="ws-embed">
        <div className="card card-pad ws-tools-box">
          <div className="ws-embed-head">
            <div className="card-h" style={{ margin: 0 }}><span className="ico"><IcoV name="Wrench" size={14} /></span> Tools{layout.length ? ` · ${layout.length}` : ""}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {pages > 1 && (
                <>
                  <button className="btn icon sm" disabled={curPage === 0} onClick={() => setWsPage(curPage - 1)} aria-label="Previous tools"><IcoV name="ChevronLeft" size={14} /></button>
                  <span className="ws-page-n">{curPage + 1}/{pages}</span>
                  <button className="btn icon sm" disabled={curPage >= pages - 1} onClick={() => setWsPage(curPage + 1)} aria-label="More tools"><IcoV name="ChevronRight" size={14} /></button>
                </>
              )}
              {layout.length > 0 && <button className="btn sm" onClick={() => { setLayout([]); setWsPage(0); }}><IcoV name="Eraser" size={14} /> Clear</button>}
              <button className="btn primary sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} color="#fff" /> Add widget</button>
            </div>
          </div>
          {shown.length === 0
            ? <button className="ws-tools-empty" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={18} /> Add tools for this step</button>
            : <div className="ws-grid">{shown.map(widgetCard)}</div>}
          {pages > 1 && (
            <div className="jn2-dots" role="tablist" aria-label="Tool pages">
              {Array.from({ length: pages }).map((_, p) => (
                <button key={p} className={`jn2-dot ${p === curPage ? "on" : ""}`} onClick={() => setWsPage(p)} aria-label={`Tools page ${p + 1}`} />
              ))}
            </div>
          )}
        </div>
        {palette}
      </section>
    );
  }

  // Standalone page: presets + unlimited widgets.
  if (layout.length === 0) {
    return (
      <div className="page">
        <div className="greeting">
          <h1 className="display" style={{ fontSize: 26 }}>Workspace</h1>
          <div className="sub">Your <strong>tools</strong> live here. The boards, trackers, and notes your <strong>Skills</strong> and My Plan produce, with the same data everywhere.</div>
        </div>
        <div className="section-label"><span className="ic"><IcoV name="LayoutGrid" size={13} /></span> Start with a preset</div>
        <div className="preset-grid">
          {(window.WORKSPACE_PRESETS || []).map(p => (
            <button key={p.id} className="preset-card" onClick={() => applyPreset(p)}>
              <span className="preset-ico"><IcoV name={p.icon} size={20} /></span>
              <span className="preset-n">{p.name}</span>
              <span className="preset-d">{p.desc}</span>
              <span className="preset-chips">
                {p.layout.slice(0, 4).map((t, i) => { const w = (window.WIDGET_CATALOG || []).find(c => c.type === t); return <span key={i} className="preset-chip">{w?.name || t}</span>; })}
                {p.layout.length > 4 && <span className="preset-chip">+{p.layout.length - 4}</span>}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, justifyContent: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>Or build your own</span>
          <button className="btn sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} /> Add a widget</button>
        </div>
        {palette}
      </div>
    );
  }
  return (
    <div className="page">
      <div className="greeting" style={{ marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 26 }}>Workspace</h1>
        <div className="sub">{layout.length} tool{layout.length === 1 ? "" : "s"} · shared with Skills and My Plan</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
        <button className="btn sm" onClick={() => setLayout([])}><IcoV name="Eraser" size={14} /> Clear</button>
        <button className="btn primary sm" onClick={() => setPaletteOpen(true)}><IcoV name="Plus" size={14} color="#fff" /> Add widget</button>
      </div>
      <div className="ws-grid">{layout.map(widgetCard)}</div>
      {palette}
    </div>
  );
}

function WidgetBody({ def, seed }) {
  if (def.stub) return <div className="ws-stub">{def.name} · coming soon</div>;
  // chat-seeded content (created by a Chat skill) takes priority
  if (seed && seed.length) {
    if (def.type === "kanban") {
      return <div><span className="ws-seed-badge">From chat skill</span><div className="ws-seed-list">{seed.map((t, i) => <div key={i} className="ws-seed-row"><span className="wsd-c" /> {t}</div>)}</div></div>;
    }
    if (def.type === "reading-queue" || def.type === "notes" || def.type === "documenter" || def.type === "writing") {
      return <div><span className="ws-seed-badge">From chat skill</span><div className="ws-seed-list">{seed.map((t, i) => <div key={i} className="ws-seed-row"><span className="wsd-c" /> {t}</div>)}</div></div>;
    }
  }
  // a few live-feeling renderers; default to description
  switch (def.type) {
    case "bibliography":
      return <div className="ws-num-row"><b>47</b><span>references · APA</span></div>;
    case "reading-queue":
      return <div className="ws-num-row"><b>8</b><span>to read · 3 done this week</span></div>;
    case "pomodoro":
      return <div style={{ textAlign: "center" }}><div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>24:50</div><div style={{ fontSize: 12, color: "var(--text-2)" }}>Session 3 · focus</div></div>;
    case "writing":
      return <div><div className="ws-num-row"><b>412</b><span>words today · 500 goal</span></div><div style={{ display: "flex", gap: 2, marginTop: 8 }}>{Array.from({ length: 20 }, (_, i) => { const v = (i * 37) % 100 / 100; return <div key={i} style={{ flex: 1, height: 20, borderRadius: 3, background: v < .25 ? "var(--surface-3)" : v < .6 ? "var(--primary-soft)" : "var(--primary)" }} />; })}</div></div>;
    case "kanban":
      return <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>{["To do", "Doing", "Done"].map((c, i) => <div key={c} style={{ background: "var(--surface-2)", borderRadius: 8, padding: 7, fontSize: 11 }}><b style={{ display: "block", marginBottom: 5 }}>{c}</b>{Array.from({ length: [3, 2, 4][i] }).map((_, j) => <div key={j} style={{ background: "var(--surface)", padding: 5, borderRadius: 5, marginBottom: 4 }}>·</div>)}</div>)}</div>;
    case "reviewer-2":
      return <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--text-2)", lineHeight: 1.5 }}>"The framing assumes predictive coding without justifying it. A skeptical reader won't be convinced…"</div>;
    case "deadlines":
      return window.DeadlinesTool ? <window.DeadlinesTool /> : null;
    case "grants":
      return window.FundingTool ? <window.FundingTool /> : null;
    default:
      return <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{def.desc}</div>;
  }
}

function WidgetPalette({ onClose, onAdd, suggested = [], stepTitle }) {
  const [browsing, setBrowsing] = useSV(false);
  const [cat, setCat] = useSV("all");
  const [q, setQ] = useSV("");
  const cats = window.WIDGET_CATEGORIES || [];
  const catalog = window.WIDGET_CATALOG || [];
  const suggestedDefs = suggested.map(t => catalog.find(w => w.type === t)).filter(Boolean);
  const list = catalog.filter(w => (cat === "all" || w.cat === cat) && (!q || `${w.name} ${w.desc}`.toLowerCase().includes(q.toLowerCase())));

  const Tile = ({ w }) => (
    <button className={`pal-tile ${w.critic ? "critic" : ""}`} onClick={() => onAdd(w.type)}>
      <span className="pal-i"><IcoV name={w.icon} size={17} /></span>
      <span style={{ flex: 1 }}><span className="pal-n">{w.name}</span><span className="pal-d">{w.desc}</span></span>
      {w.stub && <span className="pal-soon">soon</span>}
    </button>
  );

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="widget-palette-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-h">
          <div><h2 className="display" id="widget-palette-title">Add a widget</h2><p>Widgets share data with the tools in My Plan.</p></div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><IcoV name="X" size={14} /></button>
        </div>
        <div className="modal-b">
          <div className="section-label" style={{ marginTop: 0 }}><span className="ic"><IcoV name="Sparkles" size={13} /></span> Suggested for your stage{stepTitle ? ` · ${stepTitle}` : ""}</div>
          <div className="pal-grid" style={{ marginBottom: 16 }}>
            {suggestedDefs.map(w => <Tile key={w.type} w={w} />)}
          </div>

          {!browsing ? (
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setBrowsing(true)}>
              <IcoV name="ChevronDown" size={14} /> Browse all {catalog.length} widgets
            </button>
          ) : (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <div className="wrap"><span className="fi"><IcoV name="Search" size={15} /></span>
                  <input placeholder="Search widgets…" aria-label="Search widgets" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
              </div>
              <div className="pal-cats">
                {cats.map(c => <button key={c.id} className={`pal-cat ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>{c.label}</button>)}
              </div>
              <div className="pal-grid">
                {list.map(w => <Tile key={w.type} w={w} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DOCUMENTS — deliverable templates + simple editor
// ============================================================================
const DOC_KEY = "phd-coach-docs-v1";
const SECTIONS = {
  "research-paper": [["abstract", "Abstract", 250], ["intro", "Introduction", 1000], ["methods", "Methods", 800], ["results", "Results", 800], ["discussion", "Discussion", 1000], ["refs", "References", 0]],
  "meeting-prep": [["agenda", "Agenda", 80], ["progress", "Progress since last", 200], ["blockers", "Blockers", 150], ["decisions", "Decisions needed", 200], ["questions", "Questions", 150], ["followup", "Action items", 100]],
  "idp": [["goals", "Goals (1–3 years)", 200], ["skills", "Skills to develop", 200], ["milestones", "Milestones & timeline", 200], ["mentoring", "Mentoring & support plan", 150], ["career", "Career objectives", 150], ["review", "Review cadence", 80]],
  "advisor-compact": [["meeting", "Meeting cadence & communication", 150], ["advisee", "What I commit to (advisee)", 200], ["advisor", "What my advisor commits to", 200], ["feedback", "Feedback & turnaround expectations", 150], ["authorship", "Authorship & data ownership", 150], ["conflict", "How we'll handle disagreements", 120]],
  "progress-report": [["summary", "Summary", 150], ["completed", "Completed since last review", 200], ["current", "In progress now", 150], ["blockers", "Blockers & risks", 150], ["next", "Next steps", 150], ["asks", "Asks for my committee", 100]]
};
function sectionsFor(id) {
  if (SECTIONS[id]) return SECTIONS[id].map(([sid, name, target]) => ({ id: sid, name, target }));
  const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === id);
  const n = tpl?.sections || 4;
  return Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, name: `Section ${i + 1}`, target: 300 }));
}

// In-app document editing was removed for beta: PhD Navigator is where files
// are stored, analyzed, and read by the AI — writing happens in a real editor
// (Google Docs, Word, Overleaf) via the one-click handoffs in the preview bar.

// Formatted Word preview — renders the original .docx bytes as HTML via
// mammoth so the preview looks like the document, not extracted plain text.
function DocxPreview({ rawDataUrl, fallbackText }) {
  const [html, setHtml] = useSV(null);
  const [failed, setFailed] = useSV(false);
  useEV(() => {
    let alive = true;
    setHtml(null); setFailed(false);
    (async () => {
      try {
        if (!rawDataUrl || !window.mammoth) { if (alive) setFailed(true); return; }
        const buf = await (await fetch(rawDataUrl)).arrayBuffer();
        const r = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        if (alive) setHtml(r.value || "");
      } catch (e) { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, [rawDataUrl]);
  if (html) return <div className="docv-docx" dangerouslySetInnerHTML={{ __html: html }} />;
  if (!failed) return <div className="docv-empty"><IcoV name="Loader" size={14} className="spin" /> Rendering document…</div>;
  return fallbackText
    ? <>{fallbackText.split(/\n{2,}/).map((p, i) => <p key={i} className="docv-p">{p}</p>)}</>
    : <div className="docv-empty">Couldn't render this Word file — download the original below.</div>;
}

function CoachDocuments({ roadmap }) {
  // ==========================================================================
  // Documents — rebuilt around three views:
  //   "all"     → every file, from every part of the app, in one place
  //   "preview" → read-only view of one file (PDF viewer / formatted text)
  //   "edit"    → the editor (extracted text, or sectioned draft editor)
  // Local store (localStorage) keeps offline copies + PDFs; the server library
  // (/api/library) is the source the AI reads, edits sync there when signed in.
  // ==========================================================================
  const [store, setStore] = useSV(() => HV.loadJSON(DOC_KEY, { projects: {}, activeId: null }));
  useEV(() => HV.saveJSON(DOC_KEY, store), [store]);
  const projects = Object.values(store.projects || {});

  const [mode, setMode] = useSV("all");     // all | preview | edit
  const [sel, setSel] = useSV(null);        // { type: "local" | "server", id }
  const [filter, setFilter] = useSV("all"); // all | uploads | tools | drafts
  const [q, setQ] = useSV("");

  const [serverDocs, setServerDocs] = useSV([]);
  const [serverFull, setServerFull] = useSV(null);
  const [comparing, setComparing] = useSV("");
  const [busy, setBusy] = useSV("");
  const [uploadErr, setUploadErr] = useSV("");
  const fileRef = React.useRef(null);
  const authed = window.CoachAPI && window.CoachAPI.isAuthed && window.CoachAPI.isAuthed();

  // ---- server sync ---------------------------------------------------------
  const refreshServer = async () => {
    if (!authed) return;
    try { const r = await window.CoachAPI.listLibraryDocs(); setServerDocs((r && r.documents) || []); } catch (e) {}
  };
  // (The knowledge markdown lives on the Insights page — "What the system knows".)
  const refreshKnowledge = async () => {};
  useEV(() => { refreshServer(); }, []);
  useEV(() => {
    if (!serverDocs.some(d => d.analysis_status === "pending" || d.analysis_status === "analyzing")) return;
    const t = setTimeout(() => { refreshServer(); }, 5000);
    return () => clearTimeout(t);
  }, [serverDocs]);

  const serverByFile = useMV(() => { const m = {}; for (const d of serverDocs) m[d.filename] = d; return m; }, [serverDocs]);

  // ---- selection resolution ------------------------------------------------
  const localDoc = sel && sel.type === "local" ? (store.projects[sel.id] || null) : null;
  const serverMeta = sel && sel.type === "server"
    ? (serverDocs.find(d => d.id === sel.id) || null)
    : (localDoc && localDoc.uploaded ? serverByFile[localDoc.fileName] : null);

  useEV(() => {
    setServerFull(null); setComparing("");
    if (serverMeta && authed) window.CoachAPI.getLibraryDoc(serverMeta.id).then(setServerFull).catch(() => {});
  }, [sel && sel.type, sel && sel.id, serverDocs.length]);

  // Blob URL for the PDF preview — unlike a raw data: URL it honors the
  // viewer open-params (#navpanes=0) so the thumbnail rail stays hidden.
  const [pdfUrl, setPdfUrl] = useSV(null);
  useEV(() => {
    let created = null; let alive = true;
    const a = localDoc;
    if (a && a.uploaded && a.kind === "pdf" && a.dataUrl) {
      fetch(a.dataUrl).then(r => r.blob()).then(b => {
        if (!alive) return;
        created = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
        setPdfUrl(created);
      }).catch(() => { if (alive) setPdfUrl(null); });
    } else setPdfUrl(null);
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [sel && sel.id]);

  // Older PDF uploads were stored without their text layer — extract it lazily
  // on open so they become editable too.
  useEV(() => {
    const a = localDoc;
    if (!a || !a.uploaded || a.kind !== "pdf" || (a.content || "").trim() || !a.dataUrl || !window.extractTextFromFile) return;
    fetch(a.dataUrl)
      .then(r => r.blob())
      .then(b => window.extractTextFromFile(new File([b], a.fileName || "document.pdf", { type: "application/pdf" })))
      .then(r => {
        if (r && r.text) setStore(s => s.projects[a.id] ? ({ ...s, projects: { ...s.projects, [a.id]: { ...s.projects[a.id], content: r.text } } }) : s);
      })
      .catch(() => {});
  }, [sel && sel.id]);

  // ---- current-document view model ----------------------------------------
  const cur = (() => {
    if (!sel) return null;
    if (sel.type === "server") {
      const d = serverFull || serverMeta;
      if (!d) return null;
      return {
        type: "server", id: d.id, title: d.name || "", fileName: d.filename || "",
        kind: "text", source: d.source || "app", text: serverFull ? (serverFull.content || "") : "",
        loading: !serverFull, srv: serverFull || serverMeta
      };
    }
    const p = localDoc;
    if (!p) return null;
    if (!p.uploaded) {
      const tpl = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId);
      return { type: "draft", id: p.id, title: p.name || "", tpl, p, source: "draft" };
    }
    const text = p.kind === "pdf" ? (serverFull ? (serverFull.content || "") : (p.content || "")) : (p.content || "");
    return {
      type: "local", id: p.id, title: p.name || "", fileName: p.fileName || "",
      kind: p.kind, dataUrl: p.dataUrl, rawDataUrl: p.rawDataUrl, converted: p.converted, text,
      source: "documents", srv: serverFull || serverMeta
    };
  })();

  const wcOf = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;

  // ---- mutations -----------------------------------------------------------
  const updLocal = (id, patch) => setStore(s => s.projects[id] ? ({ ...s, projects: { ...s.projects, [id]: { ...s.projects[id], ...patch } } }) : s);
  const delCurrent = () => {
    if (!cur || !confirm("Delete this document?")) return;
    if (cur.type !== "server") {
      setStore(s => { const { [cur.id]: _, ...rest } = s.projects; return { ...s, activeId: null, projects: rest }; });
    }
    const srvId = cur.type === "server" ? cur.id : (cur.srv && cur.srv.id);
    if (srvId && authed) window.CoachAPI.deleteLibraryDoc(srvId).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    setSel(null); setMode("all");
  };
  const delFromCard = (card) => {
    if (!confirm("Delete this document?")) return;
    if (card.ref.type === "local") {
      const p = store.projects[card.ref.id];
      setStore(s => { const { [card.ref.id]: _, ...rest } = s.projects; return { ...s, activeId: null, projects: rest }; });
      const twin = p && p.uploaded && serverByFile[p.fileName];
      if (twin && authed) window.CoachAPI.deleteLibraryDoc(twin.id).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    } else if (authed) {
      window.CoachAPI.deleteLibraryDoc(card.ref.id).then(() => { refreshServer(); refreshKnowledge(); }).catch(() => {});
    }
  };

  const openPreview = (ref) => { setSel(ref); setMode("preview"); };
  const backToAll = () => { setSel(null); setMode("all"); };

  // ---- upload --------------------------------------------------------------
  const extOf = (n) => (n.split(".").pop() || "").toLowerCase();
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });
  const ingestFiles = async (files) => {
    setUploadErr("");
    for (const file of files) {
      const ext = extOf(file.name);
      const base = { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: file.name.replace(/\.[^.]+$/, ""), uploaded: true, fileName: file.name, mime: file.type, size: file.size, createdAt: Date.now() };
      try {
        if (ext === "pdf") {
          setBusy(file.name);
          const dataUrl = await readAs(file, "readAsDataURL");
          let text = "";
          try { const r = window.extractTextFromFile && await window.extractTextFromFile(file); text = (r && r.text) || ""; } catch (err) {}
          setBusy("");
          try { setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "pdf", dataUrl, content: text } } })); }
          catch (err) { setUploadErr("That PDF is too large to store in the browser demo."); }
        } else if (ext === "docx" || ext === "doc") {
          setBusy(file.name);
          const dataUrl = await readAs(file, "readAsDataURL");
          let text = "";
          if (ext === "docx" && window.mammoth) {
            const arrayBuffer = await readAs(file, "readAsArrayBuffer");
            try { const r = await window.mammoth.extractRawText({ arrayBuffer }); text = (r.value || "").trim(); } catch (err) { text = ""; }
          }
          setBusy("");
          setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "docx", content: text, rawDataUrl: dataUrl, converted: Boolean(text) } } }));
        } else {
          const text = await readAs(file, "readAsText");
          setStore(s => ({ ...s, projects: { ...s.projects, [base.id]: { ...base, kind: "text", content: String(text || "") } } }));
        }
      } catch (err) { setBusy(""); setUploadErr("Couldn't read that file — try a PDF, Word, or text file."); }
      // Mirror into the server library so the AI can analyze it. Best-effort.
      if (authed) window.CoachAPI.uploadLibraryDoc({ file, source: "documents" }).then(() => refreshServer()).catch(() => {});
    }
  };
  const ingestRef = React.useRef(null);
  ingestRef.current = ingestFiles;
  const onUpload = (e) => { const files = [...(e.target.files || [])]; e.target.value = ""; ingestFiles(files); };
  const triggerUpload = () => fileRef.current && fileRef.current.click();
  const HiddenUpload = () => <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.html" style={{ display: "none" }} onChange={onUpload} />;

  // Uppy dashboard modal as the upload UI. Files it collects run through the
  // same ingest pipeline; the hidden input stays as the fallback picker.
  const uppyRef = React.useRef(null);
  useEV(() => {
    if (!window.Uppy || !window.Uppy.Uppy || !window.Uppy.Dashboard) return;
    const uppy = new window.Uppy.Uppy({
      autoProceed: false,
      restrictions: {
        maxFileSize: 10 * 1024 * 1024,
        allowedFileTypes: [".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".csv", ".html"],
      },
    });
    uppy.use(window.Uppy.Dashboard, {
      inline: false,
      closeModalOnClickOutside: true,
      closeAfterFinish: false,
      hideUploadButton: true,
      proudlyDisplayPoweredByUppy: false,
      theme: "auto",
      note: "PDF, Word, or text · up to 10MB · files are added the moment you drop them",
    });
    uppy.on("file-added", (f) => {
      if (ingestRef.current && f && f.data) ingestRef.current([f.data]);
      setTimeout(() => { try { uppy.removeFile(f.id); } catch (e) {} }, 800);
    });
    uppyRef.current = uppy;
    return () => { try { (uppy.destroy || uppy.close).call(uppy); } catch (e) {} uppyRef.current = null; };
  }, []);
  const openUploader = () => {
    const u = uppyRef.current;
    if (u) { const d = u.getPlugin("Dashboard"); if (d) { d.openModal(); return; } }
    triggerUpload();
  };

  // ---- exports -------------------------------------------------------------
  const escHtml = (x) => String(x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const docBodyHtml = (name, text) =>
    `<h1>${escHtml(name)}</h1>` +
    String(text || "").split(/\n{2,}/).map(p => `<p>${escHtml(p).replace(/\n/g, "<br/>")}</p>`).join("");
  // Word-compatible HTML .doc — opens with full content in Word / Google Docs import.
  const downloadForDocs = (name, text) => {
    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escHtml(name)}</title></head><body>${docBodyHtml(name, text)}</body></html>`;
    const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(name || "document").replace(/[\\/:*?"<>|]/g, "-")}.doc`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const draftText = (p) => sectionsFor(p.templateId).map(s => `${s.name}\n\n${p.sections?.[s.id] || ""}`).join("\n\n");

  // ---- one-click handoff to a real editor ----------------------------------
  // Writing happens in Google Docs / Word / Overleaf; this library stays the
  // AI-readable home of the file. Docs/Word can't be pre-filled by URL, so we
  // copy the text and open a fresh doc; Overleaf accepts the content directly.
  const [copied, setCopied] = useSV("");   // status/hint line under the preview bar
  const [opening, setOpening] = useSV(false);
  const copyThenOpen = async (text, url, label) => {
    try { await navigator.clipboard.writeText(text || ""); setCopied(`Text copied — paste it into the new ${label} document, and re-upload here when you're done so your AI stays current.`); } catch (e) {}
    window.open(url, "_blank", "noopener");
  };
  // Real Google Docs export: push the content into Drive as an editable Doc
  // (needs the Google connection); falls back to copy + blank doc otherwise.
  const openInGoogleDocs = async (name, text) => {
    setOpening(true);
    try {
      const r = await window.CoachAPI.driveCreateDoc({ name, html: docBodyHtml(name, text) });
      window.open(r.url, "_blank", "noopener");
      setCopied("Opened in Google Docs — the doc is saved in your Drive. Re-upload here when you're done so your AI stays current.");
    } catch (e) {
      await copyThenOpen(text, "https://docs.new", "Google Docs");
      if (e && (e.status === 409 || e.status === 403)) {
        setCopied(`${e.message} Meanwhile the text is copied — just paste it into the blank doc.`);
      }
    } finally { setOpening(false); }
  };
  const openInOverleaf = (name, text) => {
    const esc = (s) => String(s || "")
      .replace(/\\/g, "\\textbackslash{}").replace(/([%$#&_{}])/g, "\\$1")
      .replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
    const snip = `\\documentclass{article}\n\\title{${esc(name)}}\n\\begin{document}\n\\maketitle\n\n${esc(text)}\n\n\\end{document}\n`;
    const form = document.createElement("form");
    form.method = "POST"; form.action = "https://www.overleaf.com/docs"; form.target = "_blank";
    const input = document.createElement("input");
    input.type = "hidden"; input.name = "snip"; input.value = snip;
    form.appendChild(input); document.body.appendChild(form); form.submit(); form.remove();
  };

  // ---- AI panel + comparison ----------------------------------------------
  const runCompare = async (srv) => {
    setComparing("busy");
    try {
      const c = await window.CoachAPI.compareLibraryDoc(srv.id);
      setComparing("");
      setServerFull(f => (f && f.id === srv.id ? { ...f, comparison: c } : f));
      refreshServer(); refreshKnowledge();
    } catch (e) { setComparing(e && e.status === 404 ? "none" : "error"); setTimeout(() => setComparing(""), 3500); }
  };
  const statusChip = (srv) => {
    if (!srv) return null;
    const st = srv.analysis_status;
    if (st === "pending" || st === "analyzing") return <span className="chip"><IcoV name="Loader" size={12} className="spin" /> AI analyzing…</span>;
    if (st === "done") return <span className="chip deliv-sat"><IcoV name="Sparkles" size={12} /> AI summary ready</span>;
    if (st === "failed") return <span className="chip"><IcoV name="AlertTriangle" size={12} /> Analysis failed</span>;
    return null;
  };
  const AiPanel = ({ srv }) => {
    if (!srv) return null;
    const a = srv.analysis;
    const cmp = srv.comparison;
    const aiBusy = srv.analysis_status === "pending" || srv.analysis_status === "analyzing";
    return (
      <div className="doc-ai-panel">
        <div className="doc-ai-head">
          <span className="doc-ai-t"><IcoV name="Sparkles" size={14} /> AI insights</span>
          {statusChip(srv)}
          {!aiBusy && authed && (
            <button className="btn sm" onClick={() => runCompare(srv)} disabled={comparing === "busy"}>
              <IcoV name={comparing === "busy" ? "Loader" : "GitCompare"} size={13} className={comparing === "busy" ? "spin" : ""} /> Compare versions
            </button>
          )}
          {!aiBusy && authed && (
            <button className="btn sm" onClick={() => window.CoachAPI.analyzeLibraryDoc(srv.id).then(refreshServer).catch(() => {})}>
              <IcoV name="RefreshCw" size={13} /> Re-analyze
            </button>
          )}
        </div>
        {comparing === "none" && <div className="doc-ai-empty" style={{ marginBottom: 8 }}>No earlier version of this document was found to compare against.</div>}
        {comparing === "error" && <div className="doc-ai-empty" style={{ marginBottom: 8 }}>Comparison failed — try again in a moment.</div>}
        {cmp && cmp.is_same_document && (
          <div className="doc-cmp">
            <div className="doc-ai-l"><IcoV name="GitCompare" size={12} /> What changed vs {cmp.against_filename}</div>
            {cmp.summary && <p className="doc-ai-summary">{cmp.summary}</p>}
            {(cmp.changes || []).length === 0 && <div className="doc-ai-empty">No substantive differences between the two versions.</div>}
            {(cmp.changes || []).map((c, i) => (
              <div key={i} className="doc-cmp-change">
                <span className="doc-cmp-area">{c.area}</span>
                <span className="doc-cmp-what">{c.change}{c.impact ? <em> — {c.impact}</em> : null}</span>
              </div>
            ))}
            <div className="doc-cmp-note"><IcoV name="MessageCircle" size={12} /> Your chat advisors know these changes — ask "what changed in my handbook?"</div>
          </div>
        )}
        {aiBusy && <div className="doc-ai-empty">Reading the document, following its links, and updating what your coach knows about you…</div>}
        {!aiBusy && !a && <div className="doc-ai-empty">No analysis yet — hit re-analyze to have the AI read this document.</div>}
        {a && (
          <>
            {a.summary && <p className="doc-ai-summary">{a.summary}</p>}
            {(a.key_points || []).length > 0 && (
              <ul className="doc-ai-points">{a.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            )}
            {(a.link_insights || []).length > 0 && (
              <div className="doc-ai-links">
                <div className="doc-ai-l">Links the AI followed</div>
                {a.link_insights.map((li, i) => (
                  <div key={i} className="doc-ai-link"><a href={li.url} target="_blank" rel="noreferrer">{li.url}</a><span>{li.takeaway}</span></div>
                ))}
              </div>
            )}
            {(a.topics || []).length > 0 && (
              <div className="meta" style={{ marginTop: 8 }}>{a.topics.map((t, i) => <span key={i} className="chip">{t}</span>)}</div>
          )}
          </>
        )}
      </div>
    );
  };

  // ---- shared header pieces ------------------------------------------------
  const kindLabel = (kind) => kind === "pdf" ? "PDF" : kind === "docx" ? "Word" : kind === "draft" ? "Draft" : "Text";
  const kindIcon = (kind) => kind === "docx" ? "FileType2" : kind === "draft" ? "PenLine" : "FileText";

  // ==========================================================================
  // PREVIEW — read-only
  // ==========================================================================
  if (cur && mode === "preview") {
    const text = cur.type === "draft" ? "" : cur.text;
    const exportText = cur.type === "draft" ? draftText(cur.p) : text;
    return (
      <div className="page">
        <HiddenUpload />
        <div className="docv-bar">
          <div className="doc-mode-tabs" style={{ margin: 0 }}>
            <button className="doc-mode-tab" onClick={backToAll}><IcoV name="LayoutGrid" size={13} /> All files</button>
            <button className="doc-mode-tab active"><IcoV name="Eye" size={13} /> Preview</button>
          </div>
          <span className="docv-bar-ico"><IcoV name={kindIcon(cur.type === "draft" ? "draft" : cur.kind)} size={15} color="#fff" /></span>
          <div className="docv-bar-t">
            <span className="docv-bar-name">{cur.title}</span>
            <span className="docv-bar-meta">
              {kindLabel(cur.type === "draft" ? "draft" : cur.kind)}
              {cur.fileName ? ` · ${cur.fileName}` : ""}
              {cur.type === "server" ? ` · from ${cur.source}` : ""}
              {cur.type === "draft" && cur.tpl ? ` · ${cur.tpl.name}` : ""}
              {` · ${wcOf(exportText)} words`}
              {cur.srv && cur.srv.comparison && cur.srv.comparison.is_same_document ? " · ↻ newer version" : ""}
            </span>
          </div>
          <div className="docv-bar-acts">
            {exportText.trim() && (
              <>
                <span className="docv-open-l">Open in</span>
                <button className="btn sm" disabled={opening} onClick={() => openInGoogleDocs(cur.title, exportText)} title="Creates this document in your Google Drive and opens it for editing"><IcoV name={opening ? "Loader" : "FileType2"} size={14} className={opening ? "spin" : ""} /> Google Docs</button>
                <button className="btn sm" onClick={() => { downloadForDocs(cur.title, exportText); setCopied("Downloaded a .doc with the full document — open it in Word (or drop it in OneDrive) to edit."); }} title="Downloads a .doc with the full content — opens straight into Word"><IcoV name="FileType2" size={14} /> Word</button>
                <button className="btn sm" onClick={() => openInOverleaf(cur.title, exportText)} title="Opens this document as a new Overleaf project, content included"><IcoV name="FileCode2" size={14} /> Overleaf</button>
              </>
            )}
            {cur.dataUrl && <a className="btn sm" href={cur.dataUrl} download={cur.fileName}><IcoV name="Download" size={14} /> Original</a>}
            <button className="btn icon sm" onClick={delCurrent} style={{ color: "var(--rose)" }}><IcoV name="Trash2" size={14} /></button>
          </div>
        </div>
        {copied && <div className="doc-cmp-note" style={{ margin: "8px 0 0" }}><IcoV name="Check" size={12} /> {copied}</div>}

        <div className={`docv-split ${cur.srv ? "" : "solo"}`}>
          <div className="docv-main">
            {cur.kind === "pdf" && cur.dataUrl ? (
              <div className="doc-pdf-viewer docv-tall"><iframe title={cur.title} src={`${pdfUrl || cur.dataUrl}#navpanes=0&view=FitH`} /></div>
            ) : cur.kind === "docx" && cur.rawDataUrl ? (
              <div className="docv-page"><DocxPreview rawDataUrl={cur.rawDataUrl} fallbackText={cur.text} /></div>
            ) : cur.type === "draft" ? (
              <div className="docv-page">
                {sectionsFor(cur.p.templateId).map(s => (
                  <section key={s.id} className="docv-sec">
                    <h2>{s.name}</h2>
                    <div className="docv-text">{(cur.p.sections?.[s.id] || "").trim() || <span className="docv-empty">Not written yet.</span>}</div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="docv-page">
                {cur.loading ? (
                  <div className="docv-empty"><IcoV name="Loader" size={14} className="spin" /> Loading document…</div>
                ) : text.trim() ? (
                  text.split(/\n{2,}/).map((p, i) => <p key={i} className="docv-p">{p}</p>)
                ) : (
                  <div className="docv-empty">No text could be read from this document — open it in Google Docs, Word, or Overleaf to work on it.</div>
                )}
              </div>
            )}
          </div>
          {cur.srv && (
            <aside className="docv-aside">
              <div className="docv-info">
                <div className="docv-info-t"><IcoV name="Info" size={13} /> File details</div>
                <div className="docv-info-row"><span>Type</span><strong>{kindLabel(cur.type === "draft" ? "draft" : cur.kind)}</strong></div>
                {cur.fileName && <div className="docv-info-row"><span>File</span><strong>{cur.fileName}</strong></div>}
                <div className="docv-info-row"><span>Source</span><strong>{cur.srv.source || cur.source}</strong></div>
                <div className="docv-info-row"><span>Words</span><strong>{wcOf(exportText)}</strong></div>
                {cur.srv.updated_at && <div className="docv-info-row"><span>Updated</span><strong>{new Date(cur.srv.updated_at).toLocaleDateString()}</strong></div>}
              </div>
              <AiPanel srv={cur.srv && cur.srv.analysis !== undefined ? cur.srv : (serverFull || cur.srv)} />
            </aside>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // ALL FILES
  // ==========================================================================
  const localUploads = projects.filter(p => p.uploaded);
  const localFileNames = new Set(localUploads.map(p => p.fileName));
  const cards = [];
  for (const p of localUploads) {
    const srv = serverByFile[p.fileName];
    cards.push({
      ref: { type: "local", id: p.id }, title: p.name, sub: p.fileName, kind: p.kind,
      source: "Uploaded here", group: "uploads", words: p.kind === "pdf" ? wcOf(p.content) : wcOf(p.content), srv,
      when: p.createdAt || 0
    });
  }
  for (const d of serverDocs.filter(d => !localFileNames.has(d.filename))) {
    cards.push({
      ref: { type: "server", id: d.id }, title: d.name, sub: d.filename, kind: "text",
      source: `From ${d.source}`, group: "tools", words: d.word_count, srv: d,
      when: Date.parse(d.updated_at || "") || 0
    });
  }
  for (const p of projects.filter(p => !p.uploaded)) {
    const t = (window.DOC_TEMPLATES || []).find(t => t.id === p.templateId);
    cards.push({
      ref: { type: "local", id: p.id }, title: p.name, sub: t ? t.name : "Draft", kind: "draft",
      source: "Draft", group: "drafts", icon: t?.icon,
      words: Object.values(p.sections || {}).reduce((a, x) => a + wcOf(x), 0),
      when: p.createdAt || 0
    });
  }
  cards.sort((a, b) => b.when - a.when);
  const qn = q.trim().toLowerCase();
  const visible = cards
    .filter(c => filter === "all" || c.group === filter)
    .filter(c => !qn || `${c.title} ${c.sub} ${c.source}`.toLowerCase().includes(qn));
  const counts = { all: cards.length, uploads: cards.filter(c => c.group === "uploads").length, tools: cards.filter(c => c.group === "tools").length, drafts: cards.filter(c => c.group === "drafts").length };

  return (
    <div className="page">
      <HiddenUpload />
      <div className="docs-head" data-ptour="doc-dropzone">
        <h1 className="display docs-head-h">Documents</h1>
        {cards.length > 0 && <span className="docs-head-sub">{cards.length} file{cards.length === 1 ? "" : "s"}</span>}
        {cards.length > 0 && (
          <div className="docs-filters">
            {[["all", "All"], ["uploads", "Uploads"], ["tools", "From chat & tools"], ["drafts", "Drafts"]]
              .filter(([id]) => id !== "drafts" || counts.drafts > 0) // drafts are legacy-only now
              .map(([id, label]) => (
              <button key={id} className={`docs-filter ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>{label} <span className="cnt">{counts[id]}</span></button>
            ))}
          </div>
        )}
        <div className="field docs-search"><div className="wrap"><span className="fi"><IcoV name="Search" size={14} /></span>
          <input placeholder="Search files…" aria-label="Search files" value={q} onChange={e => setQ(e.target.value)} /></div></div>
        <button className="btn primary sm" data-ptour="doc-upload" onClick={openUploader}><IcoV name="Upload" size={14} color="#fff" /> Upload</button>
      </div>

      {busy && <div className="search-state" style={{ marginBottom: 14 }}><IcoV name="Loader" size={16} className="spin" /> Reading &amp; converting <strong>&nbsp;{busy}&nbsp;</strong>…</div>}
      {uploadErr && <div className="doc-upload-err"><IcoV name="AlertTriangle" size={15} /> {uploadErr}</div>}

      {cards.length === 0 && (
        <button className="doc-dropzone" onClick={openUploader}>
          <span className="doc-dz-ico"><IcoV name="UploadCloud" size={22} /></span>
          <span className="doc-dz-t">Upload a document</span>
          <span className="doc-dz-d">PDF, Word (.docx), or text — every file becomes previewable, AI-analyzed, and one click away from Google Docs, Word, or Overleaf.</span>
        </button>
      )}

      {visible.length > 0 && (
        <div className="doc-grid" style={{ marginBottom: 8 }}>
          {visible.map(c => {
            let aiNote = "";
            if (c.srv && (c.srv.analysis_status === "pending" || c.srv.analysis_status === "analyzing")) aiNote = "AI analyzing…";
            else if (c.srv && c.srv.analysis_status === "done") aiNote = "✦ AI summary";
            const newer = c.srv && c.srv.comparison && c.srv.comparison.is_same_document;
            return (
              <div key={`${c.ref.type}-${c.ref.id}`} className="doc-card" onClick={() => openPreview(c.ref)}>
                <span className="doc-card-i"><IcoV name={c.icon || kindIcon(c.kind)} size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="doc-card-n">{c.title}</div>
                  <div className="doc-card-d">{c.sub}</div>
                  <div className="doc-card-meta">{kindLabel(c.kind)} · {c.source}{c.words ? ` · ${c.words} words` : ""}{aiNote ? ` · ${aiNote}` : ""}{newer ? " · ↻ newer version" : ""}</div>
                </div>
                <div className="doc-card-acts">
                  <button className="doc-card-act" title="Preview" onClick={e => { e.stopPropagation(); openPreview(c.ref); }}><IcoV name="Eye" size={13} /></button>
                  <button className="doc-card-del" title="Delete" onClick={e => { e.stopPropagation(); delFromCard(c); }}><IcoV name="Trash2" size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {cards.length > 0 && visible.length === 0 && <div className="docv-empty" style={{ margin: "18px 0" }}>Nothing matches "{q}".</div>}

    </div>
  );
}

window.CoachWorkspace = CoachWorkspace;
window.CoachDocuments = CoachDocuments;
