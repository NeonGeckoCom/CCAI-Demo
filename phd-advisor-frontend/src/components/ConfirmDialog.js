import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import '../styles/ConfirmDialog.css';

const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  tone = 'default',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => e.key === 'Escape' && onCancel?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isDanger = tone === 'danger';

  return ReactDOM.createPortal(
    <div
      className="confirm-overlay"
      onClick={(e) => e.target === e.currentTarget && onCancel?.()}
    >
      <div className="confirm-dialog" role="dialog" aria-label={title}>
        <div className={`confirm-icon ${isDanger ? 'danger' : ''}`}>
          <AlertTriangle size={22} />
        </div>
        <h2 className="confirm-title">{title}</h2>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-btn confirm-btn-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-btn ${isDanger ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmDialog;
