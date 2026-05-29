import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { TOUR_STEPS } from '../../data/canvasData';

/** 4-step modal shown on first Canvas visit (and replayable from Settings). */
const WelcomeTour = ({ open, onClose }) => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const steps = TOUR_STEPS;
  const s = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tour-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Step {step + 1} of {steps.length}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><Icon name="X" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="tour-step-icon"><Icon name={s.icon} size={24} color="#fff" /></div>
          <h2>{s.title}</h2>
          <p className="step-body">{s.body}</p>
        </div>
        <div className="modal-foot">
          <div className="tour-dots">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`tour-dot ${i === step ? 'active' : ''}`}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && <button className="btn ghost" onClick={() => setStep((v) => v - 1)}>Back</button>}
            {!isLast && <button className="btn ghost" onClick={onClose}>Skip</button>}
            <button className="btn primary" onClick={() => (isLast ? onClose() : setStep((v) => v + 1))}>
              {isLast ? (
                <><Icon name="Check" size={13} color="#fff" /> <span>Get started</span></>
              ) : (
                <><span>Next</span> <Icon name="ArrowRight" size={13} color="#fff" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeTour;
