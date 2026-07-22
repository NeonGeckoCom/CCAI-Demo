import React, { useState, useEffect } from 'react';
import Icon from './CanvasIcon';

const TOUR_KEY = 'canvas-tour-seen-v1';

const STEPS = [
  {
    title: 'Welcome to your Canvas',
    icon: 'sparkles',
    body: 'AI-summarized highlights from your research conversations live here. Each insight is a discrete task you can mark open, in-progress, completed, or abandoned.',
  },
  {
    title: 'Filter, sort, pin',
    icon: 'layout',
    body: 'Use the filter chips to narrow by status, category, or confidence. Pin the most important sections to keep them at the top. The Tasks view flattens everything into a single to-do list.',
  },
  {
    title: 'Ask follow-up',
    icon: 'message',
    body: 'Each insight has an "Ask follow-up" action that opens a fresh chat with the relevant context preloaded — useful when a synthesis raises a new question worth digging into.',
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
