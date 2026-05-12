import React from 'react';

/**
 * Clean iOS-style toggle switch. Single reusable component so toggles
 * across the app (advisor on/off, settings preferences) look identical.
 *
 * Props:
 *   checked    — boolean
 *   onChange   — (next: boolean) => void
 *   size       — 'sm' (32×18) | 'md' (38×22, default)
 *   disabled   — boolean
 *   label      — optional aria-label for screen readers
 */
const Toggle = ({ checked, onChange, size = 'md', disabled = false, label }) => {
  const dims = size === 'sm'
    ? { w: 32, h: 18, knob: 14, off: 2, on: 16 }
    : { w: 38, h: 22, knob: 18, off: 2, on: 18 };

  const handleClick = (e) => {
    e.stopPropagation();
    if (!disabled) onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      style={{
        width: dims.w,
        height: dims.h,
        padding: 0,
        border: 'none',
        borderRadius: dims.h,
        background: checked
          ? 'var(--accent-primary, #6366f1)'
          : 'var(--border-secondary, #d1d5db)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        position: 'relative',
        transition: 'background-color 0.2s ease',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: dims.off,
          left: checked ? dims.on : dims.off,
          width: dims.knob,
          height: dims.knob,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </button>
  );
};

export default Toggle;
