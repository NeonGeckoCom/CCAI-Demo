import React, { useState } from 'react';
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

const noteBox = {
  padding: 12, borderRadius: 8, background: 'var(--bg-secondary)',
  border: '1px dashed var(--border-primary)',
  color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 12,
};

const SettingsModal = ({ user, onClose }) => {
  const [activeTab, setActiveTab] = useState('profile');

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [message, setMessage] = useState(null);

  const handleProfileSubmit = (e) => {
    e.preventDefault();
    // TODO(backend): PATCH /api/users/me with { firstName, lastName }
    // Requires neon-users-service endpoint for profile updates.
    // On success, update localStorage user + parent App state.
    setMessage({ type: 'info', text: 'Profile update requires backend endpoint (not yet wired).' });
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    // TODO(backend): POST /api/users/me/password with { currentPassword, newPassword }
    // Sensitive action — server must re-verify currentPassword before applying.
    setMessage({ type: 'info', text: 'Password change requires backend endpoint (not yet wired).' });
  };

  const handleDeleteAccount = (e) => {
    e.preventDefault();
    if (deleteConfirmText !== 'DELETE') {
      setMessage({ type: 'error', text: 'Type DELETE to confirm.' });
      return;
    }
    if (!deleteConfirmPassword) {
      setMessage({ type: 'error', text: 'Password required to delete account.' });
      return;
    }
    // TODO(backend): DELETE /api/users/me with body { password: deleteConfirmPassword }
    // Sensitive action — server must re-verify password.
    // On success: clear localStorage, sign out, navigate to home.
    setMessage({ type: 'info', text: 'Account deletion requires backend endpoint (not yet wired).' });
  };

  const messageStyle = (type) => ({
    padding: '10px 12px', borderRadius: 8, marginBottom: 16, fontSize: 13,
    background: type === 'error' ? 'rgba(220,38,38,0.1)' : 'var(--bg-secondary)',
    color: type === 'error' ? '#dc2626' : 'var(--text-secondary)',
    border: `1px solid ${type === 'error' ? 'rgba(220,38,38,0.3)' : 'var(--border-primary)'}`,
  });

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
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
              <button type="submit" style={primaryBtn}>Save Changes</button>
              <div style={noteBox}>
                Backend endpoint not yet wired. See <code>handleProfileSubmit</code> for the expected request shape.
              </div>
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
              <button type="submit" style={primaryBtn}>Change Password</button>
              <div style={noteBox}>
                Backend endpoint not yet wired. Server must re-verify the current password before applying the change.
              </div>
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
              <button type="submit" style={dangerBtn}>Permanently Delete Account</button>
              <div style={noteBox}>
                Backend endpoint not yet wired. Server must re-verify the password before deletion.
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
