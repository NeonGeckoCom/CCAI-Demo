import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Plus, Check } from 'lucide-react';
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
  const { setAdvisorAvatar, addMyAvatar, myCustomAvatars } = useAppConfig();
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [preview, setPreview] = useState(null);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const activePointerId = useRef(null);

  const select = (url) => {
    setAdvisorAvatar(advisorId, url || '');
    onClose();
  };

  const handlePreview = () => {
    if (!urlInput.trim()) return;
    setPreview(urlInput.trim());
    setCropOffset({ x: 0, y: 0 });
  };

  const handleSave = () => {
    if (!preview) return;
    addMyAvatar(preview);
    select(preview);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y };
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    setCropOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const onPointerUp = (e) => {
    if (activePointerId.current !== null && e.currentTarget.hasPointerCapture(activePointerId.current)) {
      e.currentTarget.releasePointerCapture(activePointerId.current);
    }
    activePointerId.current = null;
    setDragging(false);
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

        {/* Pre-made */}
        <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>Pre-made Avatars</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 24 }}>
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

        {/* My Avatars */}
        <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>My Avatars</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24, minHeight: 48 }}>
          {/* Default / reset option */}
          <div
            onClick={() => select(null)}
            title="Use default icon"
            style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid var(--border-primary)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-primary)'}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          {myCustomAvatars.map((url) => (
            <img
              key={url}
              src={url}
              alt="custom"
              onClick={() => select(url)}
              style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', border: '2px solid transparent' }}
              onMouseEnter={e => e.target.style.borderColor = 'var(--accent-primary)'}
              onMouseLeave={e => e.target.style.borderColor = 'transparent'}
            />
          ))}
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            style={{ width: 48, height: 48, borderRadius: '50%', border: '2px dashed var(--border-primary)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
          >
            <Plus size={20} />
          </button>
        </div>

        {/* URL Input */}
        {showUrlInput && (
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: preview ? 16 : 0 }}>
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePreview()}
                placeholder="Paste image URL…"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 14 }}
              />
              <button
                onClick={handlePreview}
                style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
              >
                Preview
              </button>
            </div>

            {preview && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>Drag to reposition</p>
                <div
                  style={{ width: 120, height: 120, borderRadius: '50%', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', border: '3px solid var(--accent-primary)', position: 'relative' }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <img
                    src={preview}
                    alt="preview"
                    draggable={false}
                    style={{ position: 'absolute', width: 160, height: 160, top: cropOffset.y - 20, left: cropOffset.x - 20, objectFit: 'cover', userSelect: 'none' }}
                  />
                </div>
                <button
                  onClick={handleSave}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 8, background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
                >
                  <Check size={16} /> Save
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default AvatarPickerModal;
