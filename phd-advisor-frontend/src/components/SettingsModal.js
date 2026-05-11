import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, User as UserIcon, Lock, Trash2, AlertTriangle } from 'lucide-react';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 0, width: 560,
  maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden',
  boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column',
};

const header = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '20px 24px', borderBottom: '1px solid var(--border-primary)',
};

const tabRow = {
  display: 'flex', gap: 4, padding: '12px 16px 0',
  borderBottom: '1px solid var(--border-primary)',
};

const tabBtn = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px', background: 'transparent',
  border: 'none', borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 13.5, fontWeight: 500,
  marginBottom: -1,
});

const body = { padding: 24, overflowY: 'auto', flex: 1 };

const label = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 };

const input = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)',
  color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
};

const primaryBtn = {
  padding: '10px 16px', background: 'var(--accent-primary)',
  color: '#fff', border: 'none', borderRadius: 8,
  cursor: 'pointer', fontSize: 14, fontWeight: 500,
};

const dangerBtn = {
  padding: '10px 16px', background: '#dc2626',
  color: '#fff', border: 'none', borderRadius: 8,
  cursor: 'pointer', fontSize: 14, fontWeight: 500,
};

const SettingsModal = ({ user, authToken, onUserUpdate, onSignOut, onClose }) => {
  const [activeTab, setActiveTab] = useState('profile');

  // Track where the mouse went DOWN so we don't close the modal when a user
  // drags to select text inside an input and the mouseup happens outside the modal.
  // (React's onClick fires on the common ancestor of down+up, which can be the
  // overlay itself — causing accidental close on text selection.)
  const mouseDownOnOverlay = useRef(false);
  const handleOverlayMouseDown = (e) => {
    mouseDownOnOverlay.current = e.target === e.currentTarget;
  };
  const handleOverlayMouseUp = (e) => {
    if (mouseDownOnOverlay.current && e.target === e.currentTarget) onClose();
    mouseDownOnOverlay.current = false;
  };

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [message, setMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const apiUrl = process.env.REACT_APP_API_URL;

  const extractError = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail) && data.detail[0]?.msg) return data.detail[0].msg;
    return fallback;
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!firstName.trim() && !lastName.trim()) {
      setMessage({ type: 'error', text: 'Enter a first or last name.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ type: 'error', text: extractError(data, 'Could not update profile.') });
        return;
      }
      onUserUpdate?.(data);
      setFirstName(data.firstName || '');
      setLastName(data.lastName || '');
      setMessage({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/auth/me/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ type: 'error', text: extractError(data, 'Could not change password.') });
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({ type: 'success', text: 'Password changed.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (deleteConfirmText !== 'DELETE') {
      setMessage({ type: 'error', text: 'Type DELETE to confirm.' });
      return;
    }
    if (!deleteConfirmPassword) {
      setMessage({ type: 'error', text: 'Password required to delete account.' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password: deleteConfirmPassword }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ type: 'error', text: extractError(data, 'Could not delete account.') });
        return;
      }
      onClose?.();
      onSignOut?.();
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const messageStyle = (type) => ({
    padding: '10px 12px', borderRadius: 8, marginBottom: 16, fontSize: 13,
    background: type === 'error'
      ? 'rgba(220,38,38,0.1)'
      : type === 'success'
        ? 'rgba(22,163,74,0.1)'
        : 'var(--bg-secondary)',
    color: type === 'error'
      ? '#dc2626'
      : type === 'success'
        ? '#16a34a'
        : 'var(--text-secondary)',
    border: `1px solid ${
      type === 'error'
        ? 'rgba(220,38,38,0.3)'
        : type === 'success'
          ? 'rgba(22,163,74,0.3)'
          : 'var(--border-primary)'
    }`,
  });

  return ReactDOM.createPortal(
    <div style={overlay} onMouseDown={handleOverlayMouseDown} onMouseUp={handleOverlayMouseUp}>
      <div style={modal}>
        <div style={header}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 18 }}>Account Settings</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={tabRow}>
          <button style={tabBtn(activeTab === 'profile')} onClick={() => { setActiveTab('profile'); setMessage(null); }}>
            <UserIcon size={15} /> Profile
          </button>
          <button style={tabBtn(activeTab === 'password')} onClick={() => { setActiveTab('password'); setMessage(null); }}>
            <Lock size={15} /> Password
          </button>
          <button style={tabBtn(activeTab === 'danger')} onClick={() => { setActiveTab('danger'); setMessage(null); }}>
            <Trash2 size={15} /> Delete Account
          </button>
        </div>

        <div style={body}>
          {message && <div style={messageStyle(message.type)}>{message.text}</div>}

          {activeTab === 'profile' && (
            <form onSubmit={handleProfileSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Email</label>
                <input style={{ ...input, opacity: 0.6, cursor: 'not-allowed' }} value={user?.email || ''} disabled />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={label}>First Name</label>
                  <input style={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label style={label}>Last Name</label>
                  <input style={input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <button type="submit" style={primaryBtn} disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handlePasswordSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Current Password</label>
                <input type="password" style={input} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>New Password</label>
                <input type="password" style={input} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Confirm New Password</label>
                <input type="password" style={input} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <button type="submit" style={primaryBtn} disabled={isSubmitting}>
                {isSubmitting ? 'Changing…' : 'Change Password'}
              </button>
            </form>
          )}

          {activeTab === 'danger' && (
            <form onSubmit={handleDeleteAccount}>
              <div style={{
                display: 'flex', gap: 10, padding: 12, borderRadius: 8,
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
                marginBottom: 16,
              }}>
                <AlertTriangle size={18} style={{ color: '#dc2626', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  Deleting your account is permanent. All chat history and personal data will be removed.
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Confirm Password</label>
                <input type="password" style={input} value={deleteConfirmPassword} onChange={(e) => setDeleteConfirmPassword(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Type <strong>DELETE</strong> to confirm</label>
                <input style={input} value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" required />
              </div>
              <button type="submit" style={dangerBtn} disabled={isSubmitting}>
                {isSubmitting ? 'Deleting…' : 'Permanently Delete Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
