import React, { useState, useEffect } from 'react';
import Icon from './CanvasIcon';
import { MOD } from './platform';

const TOUR_KEY = 'canvas-tour-seen-v1';

const STEPS = [
  {
    title: 'Welcome to your Canvas',
    icon: 'sparkles',
    body: 'This is your research workspace. Two views — Insights (AI-summarized highlights from your chats) and Workspace (a customizable dashboard of widgets). It starts empty so you can build it the way you want.',
  },
  {
    title: 'Add widgets from the palette',
    icon: 'plus',
    body: `Click "Add widget" on the Workspace view, or hit ${MOD}+K and search. There are 30+ widgets — bibliography, kanban, pomodoro, writing tracker, plus three "anti-yes-man" widgets that push back on your thinking.`,
  },
  {
    title: 'Make it yours',
    icon: 'layout',
    body: 'Drag widget headers to reorder. Click the size pill (S/M/L) to resize. Hover and click trash to remove. Layout and content auto-save to your browser.',
  },
  {
    title: 'Try the anti-yes-man widgets',
    icon: 'gavel',
    body: 'Reviewer 2, Devil\'s Advocate, and Scope Realism are tuned to push back, not validate. They\'re where the real work gets sharpened. Add them last — when you\'re ready for honest feedback.',
  },
];

const CanvasWelcomeTour = ({ forceShow = false, onClose }) => {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_KEY);
    if (forceShow || !seen) setVisible(true);
  }, [forceShow]);

  const dismiss = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setVisible(false);
    if (onClose) onClose();
  };

  if (!visible) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="canvas-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="canvas-modal canvas-tour" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-icon"><Icon name={s.icon} size={18}/></div>
          <div style={{ flex: 1 }}>
            <div className="modal-title">{s.title}</div>
            <div className="modal-sub">Step {step + 1} of {STEPS.length}</div>
          </div>
          <button className="icon-btn" onClick={dismiss} title="Skip"><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body" style={{ minHeight: 80 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--canvas-text-2)' }}>{s.body}</p>
        </div>
        <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((_, i) => (
              <span key={i}
                onClick={() => setStep(i)}
                style={{
                  width: 8, height: 8, borderRadius: '50%', cursor: 'pointer',
                  background: i === step ? 'var(--canvas-accent)' : 'var(--canvas-surface-3)',
                  transition: 'background .15s',
                }}/>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>Back</button>
            )}
            {!isLast && (
              <button className="btn btn-ghost" onClick={dismiss}>Skip</button>
            )}
            <button className="btn btn-primary" onClick={() => isLast ? dismiss() : setStep(s => s + 1)}>
              {isLast ? <><Icon name="check" size={13}/>Get started</> : <>Next<Icon name="arrow" size={13}/></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CanvasWelcomeTour;
