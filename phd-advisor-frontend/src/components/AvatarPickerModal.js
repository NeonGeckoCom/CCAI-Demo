import React from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';

const API = process.env.REACT_APP_API_URL || '';

const BUNDLED = [
  'advisor1.png','advisor2.png','advisor3.png','advisor4.png',
  'advisor5.png','advisor6.png','advisor7.png',
];

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 24, width: 480,
  maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: 'var(--shadow-xl)',
};

const AvatarPickerModal = ({ advisorId, advisorName, onClose }) => {
  const { setAdvisorAvatar } = useAppConfig();

  const select = (url) => {
    setAdvisorAvatar(advisorId, url || '');
    onClose();
  };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()} onMouseDown={(e) => e.stopPropagation()}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 18 }}>
            Choose Avatar — {advisorName}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>Pre-made Avatars</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 20 }}>
          {BUNDLED.map((file) => (
            <img
              key={file}
              src={`${API}/api/avatars/bundled/${file}`}
              alt={file}
              onClick={() => select(`${API}/api/avatars/bundled/${file}`)}
              style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', border: '2px solid transparent', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.target.style.borderColor = 'var(--accent-primary)'}
              onMouseLeave={e => e.target.style.borderColor = 'transparent'}
            />
          ))}
        </div>

        <button
          onClick={() => select(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13.5 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
          Use default icon
        </button>
      </div>
    </div>,
    document.body
  );
};

export default AvatarPickerModal;
