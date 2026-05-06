// TODO(@frontend-dev): This file has unresolved merge conflicts.
// HEAD = disable-specific-personas + brainforge + message-persistence features
// INCOMING = hybrid model selection feature (AdvisorConfigPanel, LLM config draft state)
// Both sides need to be merged: keep HEAD's full multi-tab modal (Profile, Password,
// Advisors toggles, Delete Account) and add incoming's AdvisorConfigPanel + LLM config
// into the Advisors tab.

<<<<<<< HEAD
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, User as UserIcon, Lock, Trash2, AlertTriangle, Users } from 'lucide-react';
import Toggle from './Toggle';
import { useAppConfig } from '../contexts/AppConfigContext';
=======
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Layers } from 'lucide-react';
import AdvisorConfigPanel from './AdvisorConfigPanel';

// Settings modal. On feat/UI-for-User-Account-updates this file also has
// Profile / Password / Delete Account tabs. When that branch merges, fold
// those tabs into the tabRow + body sections below — the "advisors" tab
// shipped on this branch is the only one not present there.
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modal = {
  background: 'var(--bg-primary)', borderRadius: 16, padding: 0, width: 640,
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

const SettingsModal = ({
  user,
  advisors,
  availableBackends,
  llmConfig,
  isSaving,
  onSubmitConfig,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState('advisors');

<<<<<<< HEAD
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

const miniBtn = {
  background: 'transparent',
  border: '1px solid var(--border-primary)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '5px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const SettingsModal = ({ user, authToken, onUserUpdate, onSignOut, onClose }) => {
  const [activeTab, setActiveTab] = useState('profile');
  const {
    advisors,
    isAdvisorEnabled,
    setAdvisorEnabled,
    setAllAdvisorsEnabled,
    hydrateAdvisorPreferences,
  } = useAppConfig();

  // Reconcile with the backend whenever the user opens Settings (covers fresh
  // logins and changes made on another device).
  useEffect(() => {
    hydrateAdvisorPreferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
=======
  const personaIds = useMemo(() => Object.keys(advisors || {}), [advisors]);
  const [draft, setDraft] = useState(() => {
    const fallback = llmConfig?.default_backend || availableBackends?.[0] || 'gemini';
    const seed = llmConfig?.persona_backends || {};
    const personas = {};
    for (const id of personaIds) {
      personas[id] = seed[id] || fallback;
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)
    }
    return {
      default_backend: fallback,
      orchestrator_backend: llmConfig?.orchestrator_backend || fallback,
      persona_backends: personas,
    };
  });

<<<<<<< HEAD
  const advisorEntries = Object.entries(advisors || {});
  const enabledCount = advisorEntries.filter(([id]) => isAdvisorEnabled(id)).length;
  const setAll = (enabled) => setAllAdvisorsEnabled(enabled);

  // pendingDisable: { type: 'all' } | { type: 'single', id } — set when the
  // user is about to leave zero advisors enabled. Confirming runs the action;
  // "Go back" leaves state untouched.
  const [pendingDisable, setPendingDisable] = useState(null);

  const handleDisableAllClick = () => {
    if (enabledCount === 0) return;
    setPendingDisable({ type: 'all' });
  };

  const handleAdvisorToggle = (id, next) => {
    if (!next && enabledCount === 1 && isAdvisorEnabled(id)) {
      setPendingDisable({ type: 'single', id });
      return;
    }
    setAdvisorEnabled(id, next);
  };

  const confirmPendingDisable = () => {
    if (pendingDisable?.type === 'all') {
      setAll(false);
    } else if (pendingDisable?.type === 'single') {
      setAdvisorEnabled(pendingDisable.id, false);
    }
    setPendingDisable(null);
=======
  const handleSave = () => {
    onSubmitConfig(draft);
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)
  };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={header}>
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 18 }}>Settings</h3>
<<<<<<< HEAD
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }} aria-label="Close settings">
=======
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)
            <X size={20} />
          </button>
        </div>

        <div style={tabRow}>
<<<<<<< HEAD
          <button style={tabBtn(activeTab === 'profile')} onClick={() => { setActiveTab('profile'); setMessage(null); }}>
            <UserIcon size={15} /> Profile
          </button>
          <button style={tabBtn(activeTab === 'password')} onClick={() => { setActiveTab('password'); setMessage(null); }}>
            <Lock size={15} /> Password
          </button>
          <button style={tabBtn(activeTab === 'advisors')} onClick={() => { setActiveTab('advisors'); setMessage(null); }}>
            <Users size={15} /> Advisors
          </button>
          <button style={tabBtn(activeTab === 'danger')} onClick={() => { setActiveTab('danger'); setMessage(null); }}>
            <Trash2 size={15} /> Delete Account
=======
          <button style={tabBtn(activeTab === 'advisors')} onClick={() => setActiveTab('advisors')}>
            <Layers size={15} /> Advisor Config
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)
          </button>
        </div>

        <div style={body}>
          {activeTab === 'advisors' && (
            <>
              <AdvisorConfigPanel
                advisors={advisors}
                availableBackends={availableBackends || []}
                value={draft}
                onChange={setDraft}
                description="Pick a backend for the orchestrator and each advisor. The default backend is used as a fallback."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-primary)',
                    background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13.5,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none',
                    background: 'var(--accent-primary)', color: '#fff',
                    cursor: isSaving ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 600,
                  }}
                >
                  {isSaving ? 'Saving…' : 'Save configuration'}
                </button>
              </div>
<<<<<<< HEAD
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

          {activeTab === 'advisors' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Active advisors
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {enabledCount} of {advisorEntries.length} active · turn an advisor off to keep them out of your conversations
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setAll(true)} style={miniBtn}>Enable all</button>
                  <button onClick={handleDisableAllClick} style={miniBtn}>Disable all</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {advisorEntries.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                    No advisors configured.
                  </div>
                )}
                {advisorEntries.map(([id, advisor]) => {
                  const IconComponent = advisor.icon;
                  const enabled = isAdvisorEnabled(id);
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 4px',
                        borderTop: '1px solid var(--border-primary)',
                        opacity: enabled ? 1 : 0.55,
                        transition: 'opacity .15s ease',
                      }}
                    >
                      <div
                        style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: advisor.bgColor, color: advisor.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, overflow: 'hidden',
                        }}
                      >
                        {advisor.avatarUrl
                          ? <img src={advisor.avatarUrl} alt={advisor.name} style={{ width: 36, height: 36, objectFit: 'cover' }}/>
                          : <IconComponent size={18}/>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {advisor.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {advisor.description || advisor.role || ''}
                        </div>
                      </div>
                      <Toggle
                        checked={enabled}
                        onChange={(next) => handleAdvisorToggle(id, next)}
                        label={`Toggle ${advisor.name}`}
                      />
                    </div>
                  );
                })}
              </div>
            </>
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
=======
            </>
>>>>>>> 8b7dfb4 (Pending changes to build backend the menus will be moved to the welcome screens and settigns pages once merges are completed.)
          )}
        </div>

        {pendingDisable && (
          <div
            style={{ ...overlay, zIndex: 1100 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setPendingDisable(null); }}
          >
            <div style={{ ...modal, width: 420 }}>
              <div style={header}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AlertTriangle size={18} style={{ color: '#dc2626' }} />
                  <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 16 }}>Disable all advisors?</h3>
                </div>
                <button onClick={() => setPendingDisable(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }} aria-label="Close">
                  <X size={20} />
                </button>
              </div>
              <div style={body}>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  Disabling all advisors makes it so chat won't work. You'll need to re-enable at least one advisor before you can have a conversation.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                  <button onClick={() => setPendingDisable(null)} style={miniBtn}>Go back</button>
                  <button onClick={confirmPendingDisable} style={dangerBtn}>Continue</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
