import React from 'react';
import Icon from './Icon';

/** Distinct stub body per widget type — enough to convey what each widget is. */
const WidgetBody = ({ def }) => {
  if (def.stub) {
    return <div className="widget-body stub">{def.name} · coming soon</div>;
  }
  switch (def.type) {
    case 'bibliography':
      return (
        <div className="widget-body">
          <div className="widget-stat-row">
            <span className="num">47</span>
            <span className="lbl">references · APA format</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li style={{ fontSize: 12, color: 'var(--text-secondary)' }}>@rao1999 — Rao &amp; Ballard, <em>Nat Neurosci</em>, 1999</li>
            <li style={{ fontSize: 12, color: 'var(--text-secondary)' }}>@bastos2012 — Bastos et al., <em>Neuron</em>, 2012</li>
            <li style={{ fontSize: 12, color: 'var(--text-secondary)' }}>@keller2018 — Keller &amp; Mrsic-Flogel, <em>Neuron</em>, 2018</li>
            <li style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>+44 more</li>
          </ul>
        </div>
      );
    case 'reading-queue':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <strong style={{ color: 'var(--text-primary)' }}>8</strong> to read · <strong style={{ color: 'var(--status-done)' }}>3</strong> read this week
          </div>
          {['Heeger 2017 — Theory of cortical function', 'Aitchison & Lengyel 2017 — With or without you', 'Pakan 2018 — Behavioral-state modulation in V1'].map((t) => (
            <div key={t} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--border-tertiary)' }}>{t}</div>
          ))}
        </div>
      );
    case 'notes':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>3 notes · last edited 22 min ago</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-accent)' }}>
            <strong>M3 drift</strong> — fixation drift suspected during the last hour of session. Re-review w/ Reineke before counting recordings.
          </div>
        </div>
      );
    case 'highlights':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-accent)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: 10, marginBottom: 8 }}>
            "The hierarchical predictive coding framework explains both response selectivity and adaptation in V1." (@bastos2012)
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>+12 more highlights</div>
        </div>
      );
    case 'writing':
      return (
        <div className="widget-body">
          <div className="widget-stat-row"><span className="num">412</span><span className="lbl">words today · 500 target</span></div>
          <div style={{ display: 'flex', gap: 2, marginTop: 10 }}>
            {Array.from({ length: 28 }, (_, i) => {
              const v = ((i * 37) % 100) / 100;
              return (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  style={{ flex: 1, height: 24, borderRadius: 3, background: v < 0.2 ? 'var(--bg-tertiary)' : v < 0.5 ? 'rgba(99,102,241,0.35)' : 'var(--accent-primary)' }}
                />
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>28-day heatmap · 18-day streak</div>
        </div>
      );
    case 'outline':
      return (
        <div className="widget-body">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>Introduction
              <ul style={{ paddingLeft: 18, color: 'var(--text-secondary)' }}>
                <li>Predictive-coding origins</li>
                <li>Gap: oddball at single-neuron resolution</li>
              </ul>
            </li>
            <li>Methods</li>
            <li>Results</li>
            <li>Discussion</li>
          </ul>
        </div>
      );
    case 'latex':
      return (
        <div className="widget-body">
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: 'var(--bg-secondary)', padding: 10, borderRadius: 8, color: 'var(--text-accent)' }}>
            {'$$\\hat{x}_{l+1} = f(W_l\\hat{x}_l + \\epsilon_l)$$'}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
            x̂<sub>l+1</sub> = f(W<sub>l</sub> x̂<sub>l</sub> + ε<sub>l</sub>)
          </div>
        </div>
      );
    case 'kanban':
      return (
        <div className="widget-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {['To Do', 'Doing', 'Stuck', 'Done'].map((col, i) => (
              <div key={col} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 8, fontSize: 11 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>{col}</div>
                {Array.from({ length: [3, 2, 1, 5][i] }).map((_, j) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={j} style={{ background: 'var(--bg-primary)', padding: 6, borderRadius: 5, marginBottom: 4, color: 'var(--text-secondary)', border: '1px solid var(--border-tertiary)' }}>Task {j + 1}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    case 'deadlines':
      return (
        <div className="widget-body">
          {[{ d: 'Aim 2 draft', in: '8d' }, { d: 'Quals proposal', in: '32d' }, { d: 'SfN abstract', in: '67d' }].map((item) => (
            <div key={item.d} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-tertiary)', fontSize: 12.5 }}>
              <span>{item.d}</span>
              <strong style={{ color: 'var(--accent-primary)' }}>in {item.in}</strong>
            </div>
          ))}
        </div>
      );
    case 'pomodoro':
      return (
        <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>24:50</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Session 3 of 4 · focus</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="btn primary" style={{ padding: '6px 14px', fontSize: 12 }}><Icon name="Pause" size={12} color="#fff" /> <span>Pause</span></button>
            <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 12 }}>Skip</button>
          </div>
        </div>
      );
    case 'calendar':
      return (
        <div className="widget-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 11, textAlign: 'center' }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} style={{ color: 'var(--text-tertiary)', padding: 4 }}>{d}</div>
            ))}
            {Array.from({ length: 28 }, (_, i) => {
              const isToday = i === 12;
              const hasEvent = [4, 8, 15, 22, 25].includes(i);
              return (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  style={{
                    padding: 4,
                    background: isToday ? 'var(--accent-gradient)' : hasEvent ? 'var(--feature-bg)' : 'transparent',
                    color: isToday ? '#fff' : hasEvent ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    borderRadius: 4,
                    fontWeight: isToday ? 700 : 400
                  }}
                >{i + 1}</div>
              );
            })}
          </div>
        </div>
      );
    case 'activity':
      return (
        <div className="widget-body">
          {[
            { t: 'edited', w: 'Writing Tracker', ago: '3m' },
            { t: 'added', w: 'Reading Queue · Heeger 2017', ago: '22m' },
            { t: 'moved', w: 'Kanban · M3 review → Stuck', ago: '1h' }
          ].map((e, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--border-tertiary)' }}>
              <span><strong style={{ color: 'var(--text-primary)' }}>{e.t}</strong> {e.w}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>{e.ago}</span>
            </div>
          ))}
        </div>
      );
    case 'documenter':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>Today · May 12</div>
          <div style={{ fontSize: 13, color: 'var(--text-accent)', lineHeight: 1.55 }}>Spike-sort M4 finished. GLM converged with history kernel of 200ms. Need to compare λ between conditions tomorrow.</div>
        </div>
      );
    case 'phd-journey':
      return (
        <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { name: 'Coursework', status: 'done' },
            { name: 'Handbook Audit', status: 'done' },
            { name: 'Pick Committee', status: 'active' },
            { name: 'Pick Topic', status: 'active' },
            { name: 'Prelim Exam', status: 'next' },
            { name: '+10 more…', status: 'locked' }
          ].map((p, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: p.status === 'done' ? 'var(--status-done)'
                  : p.status === 'active' ? 'var(--accent-primary)'
                    : p.status === 'next' ? 'var(--status-pending)'
                      : 'var(--status-locked)'
              }} />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      );
    case 'meeting-log':
      return (
        <div className="widget-body">
          {[
            { who: 'Dr. Reineke', last: 'yesterday', note: 'Aim 2 deadline May 22' },
            { who: 'Methodologist', last: '2d ago', note: 'Pick PC formulation' }
          ].map((m, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ padding: '8px 0', fontSize: 12, borderBottom: '1px solid var(--border-tertiary)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.who}<span style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontWeight: 400 }}>· {m.last}</span></div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{m.note}</div>
            </div>
          ))}
        </div>
      );
    case 'goals':
      return (
        <div className="widget-body">
          {[
            { name: 'Finish Aim 2 analysis', pct: 65 },
            { name: 'Submit SfN abstract', pct: 30 }
          ].map((g, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span>{g.name}</span>
                <strong style={{ color: 'var(--accent-primary)' }}>{g.pct}%</strong>
              </div>
              <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 999 }}>
                <div style={{ width: `${g.pct}%`, height: '100%', background: 'var(--accent-gradient)', borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'habits':
      return (
        <div className="widget-body">
          {[
            { name: 'Read 30 min', streak: 18 },
            { name: 'Lab notebook entry', streak: 5 },
            { name: '30-min writing', streak: 12 }
          ].map((h) => (
            <div key={h.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-tertiary)' }}>
              <span style={{ fontSize: 12.5 }}>{h.name}</span>
              <span style={{ fontSize: 11, color: 'var(--status-pending)', fontWeight: 700 }}><Icon name="Flame" size={11} /> {h.streak}</span>
            </div>
          ))}
        </div>
      );
    case 'reviewer-2':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Reviewer 2 says:</div>
          <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-accent)', lineHeight: 1.55 }}>
            "The analysis is reasonable but the framing assumes predictive coding without justifying it. A non-PC reader would not be convinced you've ruled out simpler adaptation accounts."
          </div>
        </div>
      );
    case 'devils-advocate':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What if you're wrong?</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-accent)', lineHeight: 1.55 }}>
            <li>Adaptation explains the same data without PC machinery</li>
            <li>L2/3 oddball responses may be inherited from LGN</li>
          </ul>
        </div>
      );
    case 'scope-realism':
      return (
        <div className="widget-body">
          <div style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Realism check</div>
          <div className="widget-stat-row">
            <span className="num" style={{ color: 'var(--status-danger)' }}>3.2y</span>
            <span className="lbl">est. time to defense at current pace</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>Target 2.5y → cut Q3 or move it to a paper</div>
        </div>
      );
    default:
      return (
        <div className="widget-body" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {def.desc}
        </div>
      );
  }
};

const Widget = ({ widget, def, onRemove, onCycleSize }) => (
  <div className={`widget size-${widget.size} ${def.critic ? 'critic' : ''}`}>
    <div className="widget-head">
      <div className="wh-icon"><Icon name={def.icon} size={14} /></div>
      <h4>{def.name}</h4>
      <div className="wh-actions">
        <button className="size-pill" onClick={onCycleSize} title="Cycle size S → M → L">{widget.size}</button>
        <button className="wh-action" title="Settings"><Icon name="MoreHorizontal" size={14} /></button>
        <button className="wh-action danger" onClick={onRemove} title="Remove"><Icon name="Trash2" size={14} /></button>
      </div>
    </div>
    <WidgetBody def={def} />
  </div>
);

export default Widget;
