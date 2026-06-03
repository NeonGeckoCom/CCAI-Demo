import React, { useState } from 'react';
import AppHeader from '../components/canvas/AppHeader';
import CanvasSidebar from '../components/canvas/CanvasSidebar';
import Icon from '../components/canvas/Icon';
import { useTheme } from '../contexts/ThemeContext';
import { ADVISORS, ACADEMIC_STAGES, REQUIRED_DELIVERABLES, TOUR_KEY, WORKSPACE_KEY } from '../data/canvasData';

const NAV = [
  { id: 'profile', label: 'Profile', icon: 'User' },
  { id: 'appearance', label: 'Appearance', icon: 'Palette' },
  { id: 'advisors', label: 'Advisors', icon: 'Users' },
  { id: 'documents', label: 'Documents', icon: 'FolderOpen' },
  { id: 'notifications', label: 'Notifications', icon: 'Bell' },
  { id: 'data', label: 'Data & privacy', icon: 'Shield' },
  { id: 'account', label: 'Account', icon: 'KeyRound' }
];

const SettingsContent = ({ user, activeAdvisorIds, onOpenAdvisors, onNav }) => {
  const { theme, toggleTheme } = useTheme();
  const [section, setSection] = useState('profile');
  const [profile, setProfile] = useState({
    firstName: (user.name || '').split(' ')[0] || '',
    lastName: (user.name || '').split(' ').slice(1).join(' '),
    email: user.email || '',
    institution: 'University of Colorado Boulder',
    program: 'PhD, Information Science',
    stage: 'coursework'
  });

  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <div className="project-header">
        <div className="ph-top">
          <div>
            <h1>Settings</h1>
            <div className="ph-meta">Manage your profile, advisors, and app preferences.</div>
          </div>
        </div>
      </div>

      <div className="settings-wrap">
        <aside className="settings-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`settings-nav-item ${section === n.id ? 'active' : ''}`}
              onClick={() => setSection(n.id)}
            >
              <Icon name={n.icon} size={14} /> <span>{n.label}</span>
            </button>
          ))}
        </aside>

        <div>
          {section === 'profile' && (
            <div className="settings-section">
              <h2>Profile</h2>
              <p className="ss-sub">Used to tune the advisor panel to your program.</p>
              <div className="settings-row">
                <div className="sr-l">First name</div>
                <div className="sr-c"><input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Last name</div>
                <div className="sr-c"><input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Email <div className="sr-hint">Used for sign-in only</div></div>
                <div className="sr-c"><input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Institution</div>
                <div className="sr-c"><input value={profile.institution} onChange={(e) => setProfile({ ...profile, institution: e.target.value })} /></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Program</div>
                <div className="sr-c"><input value={profile.program} onChange={(e) => setProfile({ ...profile, program: e.target.value })} /></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Academic stage</div>
                <div className="sr-c">
                  <select value={profile.stage} onChange={(e) => setProfile({ ...profile, stage: e.target.value })}>
                    {ACADEMIC_STAGES.filter((s) => s.value).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn primary"><Icon name="Check" size={14} color="#fff" /> <span>Save changes</span></button>
              </div>
            </div>
          )}

          {section === 'appearance' && (
            <div className="settings-section">
              <h2>Appearance</h2>
              <p className="ss-sub">Theme and density preferences.</p>
              <div className="settings-row">
                <div className="sr-l">Theme <div className="sr-hint">Light or dark — persists across reloads</div></div>
                <div className="sr-c" />
                <div className="sr-r">
                  <button className={`btn ${theme === 'light' ? 'primary' : 'ghost'}`} onClick={() => theme !== 'light' && toggleTheme()}><Icon name="Sun" size={14} color={theme === 'light' ? '#fff' : undefined} /> <span>Light</span></button>
                  <button className={`btn ${theme === 'dark' ? 'primary' : 'ghost'}`} onClick={() => theme !== 'dark' && toggleTheme()}><Icon name="Moon" size={14} color={theme === 'dark' ? '#fff' : undefined} /> <span>Dark</span></button>
                </div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Replay welcome tour <div className="sr-hint">Re-show the 4-step canvas tour</div></div>
                <div className="sr-c" />
                <div className="sr-r">
                  <button className="btn" onClick={() => { try { localStorage.removeItem(TOUR_KEY); } catch (e) { /* ignore */ } window.dispatchEvent(new CustomEvent('tour:replay')); }}>
                    <Icon name="Rocket" size={14} /> <span>Replay tour</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === 'advisors' && (
            <div className="settings-section">
              <h2>Advisors</h2>
              <p className="ss-sub">{activeAdvisorIds.size} of {ADVISORS.length} advisors active. Click an advisor to toggle.</p>
              <div className="advisor-toggle-grid" style={{ gridTemplateColumns: '1fr' }}>
                {ADVISORS.map((a) => {
                  const on = activeAdvisorIds.has(a.id);
                  return (
                    <div
                      key={a.id}
                      className={`advisor-toggle ${on ? 'active' : ''}`}
                      onClick={onOpenAdvisors}
                    >
                      <div className="at-icon" style={{ background: a.color }}>
                        <Icon name={a.icon} size={20} color="#fff" />
                      </div>
                      <div>
                        <div className="at-name">{a.name}</div>
                        <div className="at-role" style={{ color: a.color }}>{a.role}</div>
                      </div>
                      <div className="switch" />
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn primary" onClick={onOpenAdvisors}>
                  <Icon name="SlidersHorizontal" size={14} color="#fff" /> <span>Open full picker</span>
                </button>
              </div>
            </div>
          )}

          {section === 'documents' && (
            <div className="settings-section">
              <h2>Documents</h2>
              <p className="ss-sub">Required uploads that ground every advisor response.</p>
              {REQUIRED_DELIVERABLES.map((d) => (
                <div key={d.id} className="settings-row">
                  <div className="sr-l">
                    {d.title}
                    <div className="sr-hint">{d.sub}</div>
                  </div>
                  <div className="sr-c" style={{ fontSize: 12.5, color: d.uploaded ? 'var(--status-done)' : 'var(--status-pending)' }}>
                    {d.uploaded ? <><Icon name="FileCheck2" size={12} /> {d.filename}</> : 'Not yet uploaded'}
                  </div>
                  <div className="sr-r">
                    <button className="btn">{d.uploaded ? 'Replace' : 'Upload'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === 'notifications' && (
            <div className="settings-section">
              <h2>Notifications</h2>
              <p className="ss-sub">Email and in-app alerts.</p>
              {[
                { name: 'Weekly canvas summary', on: true },
                { name: 'Deadline reminders (3 days out)', on: true },
                { name: 'New advisor insight available', on: false },
                { name: 'Document approaching word target', on: false }
              ].map((n) => (
                <div key={n.name} className="settings-row">
                  <div className="sr-l">{n.name}</div>
                  <div className="sr-c" />
                  <div className="sr-r">
                    <div className={`advisor-toggle ${n.on ? 'active' : ''}`} style={{ display: 'inline-grid', padding: 6, gridTemplateColumns: 'auto' }}>
                      <div className="switch" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === 'data' && (
            <div className="settings-section">
              <h2>Data &amp; privacy</h2>
              <p className="ss-sub">Your uploaded documents, chats, and canvas data stay in your account.</p>
              <div className="settings-row">
                <div className="sr-l">Export all data <div className="sr-hint">Download a JSON archive of your account</div></div>
                <div className="sr-c" />
                <div className="sr-r"><button className="btn"><Icon name="Download" size={14} /> <span>Export</span></button></div>
              </div>
              <div className="settings-row">
                <div className="sr-l">Reset canvas workspace <div className="sr-hint">Clear all widgets — keep your chat history</div></div>
                <div className="sr-c" />
                <div className="sr-r"><button className="btn" onClick={() => { try { localStorage.removeItem(WORKSPACE_KEY); } catch (e) { /* ignore */ } window.location.reload(); }}>Reset</button></div>
              </div>
            </div>
          )}

          {section === 'account' && (
            <>
              <div className="settings-section">
                <h2>Account</h2>
                <p className="ss-sub">Password and sign-out.</p>
                <div className="settings-row">
                  <div className="sr-l">Change password</div>
                  <div className="sr-c" />
                  <div className="sr-r"><button className="btn">Change</button></div>
                </div>
                <div className="settings-row">
                  <div className="sr-l">Sign out everywhere</div>
                  <div className="sr-c" />
                  <div className="sr-r"><button className="btn" onClick={() => onNav('home')}><Icon name="LogOut" size={14} /> <span>Sign out</span></button></div>
                </div>
              </div>
              <div className="settings-section danger">
                <h2>Danger zone</h2>
                <p className="ss-sub">Permanent actions. There's no recovery.</p>
                <div className="settings-row">
                  <div className="sr-l">Delete account <div className="sr-hint">Permanently removes your account + all data</div></div>
                  <div className="sr-c" />
                  <div className="sr-r"><button className="btn danger"><Icon name="Trash2" size={14} /> <span>Delete account</span></button></div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingsPage = ({ user, activeAdvisorIds, onOpenAdvisors, onNav, onSignOut }) => (
  <div className="app-frame">
    <AppHeader
      view="settings"
      onNav={onNav}
      activeAdvisorIds={activeAdvisorIds}
      onOpenAdvisors={onOpenAdvisors}
      user={user}
      canvasTab="insights"
      onSignOut={onSignOut}
    />
    <div className="app-shell" style={{ minHeight: 0, gridTemplateColumns: '260px 1fr' }}>
      <CanvasSidebar collapsed={false} onToggleCollapsed={() => {}} activeView="" onNav={onNav} />
      <main style={{ overflow: 'auto', padding: '24px 32px 48px' }}>
        <SettingsContent user={user} activeAdvisorIds={activeAdvisorIds} onOpenAdvisors={onOpenAdvisors} onNav={onNav} />
      </main>
    </div>
  </div>
);

export default SettingsPage;
