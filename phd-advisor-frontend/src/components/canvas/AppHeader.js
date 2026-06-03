import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { useTheme } from '../../contexts/ThemeContext';
import { ADVISORS } from '../../data/canvasData';

/**
 * Global top bar shared across Chat / Canvas / Settings.
 * `view` is one of: "chat" | "canvas" | "settings".
 * onNav(next, opts) — next "chat" | "canvas" | "settings"; opts.canvasTab
 * selects the Canvas sub-tab.
 */
const AppHeader = ({
  view,
  onNav,
  activeAdvisorIds,
  onOpenAdvisors,
  user,
  canvasTab = 'insights',
  onSignOut
}) => {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const advisorsCount = activeAdvisorIds.size;
  const activeAdvisors = ADVISORS.filter((a) => activeAdvisorIds.has(a.id));
  const onCanvas = view === 'canvas';

  return (
    <header className="app-header">
      <div className="ah-left">
        <div className="ah-brand">
          <div className="mark"><Icon name="GraduationCap" size={18} color="#fff" /></div>
          <div>
            <div className="t1">PhD Advisory Panel</div>
            <div className="t2">AI-Powered Academic Guidance</div>
          </div>
        </div>

        <div className="app-tabs" role="tablist">
          <button
            role="tab"
            className={`app-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => onNav('chat')}
          >
            <Icon name="MessageSquare" size={14} /> Chat
          </button>
          <button
            role="tab"
            className={`app-tab ${onCanvas && canvasTab === 'insights' ? 'active' : ''}`}
            onClick={() => onNav('canvas', { canvasTab: 'insights' })}
          >
            <Icon name="Sparkles" size={14} /> Insights
          </button>
          <button
            role="tab"
            className={`app-tab ${onCanvas && canvasTab === 'workspace' ? 'active' : ''}`}
            onClick={() => onNav('canvas', { canvasTab: 'workspace' })}
          >
            <Icon name="LayoutDashboard" size={14} /> Workspace
          </button>
          <button
            role="tab"
            className={`app-tab ${onCanvas && canvasTab === 'documents' ? 'active' : ''}`}
            onClick={() => onNav('canvas', { canvasTab: 'documents' })}
          >
            <Icon name="FileText" size={14} /> Documents
          </button>
        </div>
      </div>

      <div className="ah-right">
        <button className="advisor-count-pill" onClick={onOpenAdvisors} title="Manage advisors">
          <span className="dot" />
          <span>{advisorsCount} advisor{advisorsCount === 1 ? '' : 's'}</span>
          <span className="avatars" aria-hidden="true">
            {activeAdvisors.slice(0, 4).map((a) => (
              <span key={a.id} style={{ background: a.color }}>
                <Icon name={a.icon} size={8} color="#fff" />
              </span>
            ))}
          </span>
          <Icon name="ChevronDown" size={10} />
        </button>

        <button className="btn icon-only" onClick={toggleTheme} title="Toggle theme">
          <Icon name={theme === 'light' ? 'Moon' : 'Sun'} size={15} />
        </button>

        <button
          className="btn icon-only"
          title="Help"
          onClick={() => window.dispatchEvent(new CustomEvent('open-user-guide'))}
        >
          <Icon name="HelpCircle" size={15} />
        </button>

        <div className="avatar-menu" ref={menuRef}>
          <button className="avatar-button" onClick={() => setMenuOpen((o) => !o)} title="Account">
            {user.initials}
          </button>
          {menuOpen && (
            <div className="menu-pop" role="menu">
              <div className="menu-header">
                <div className="av">{user.initials}</div>
                <div>
                  <div className="name">{user.name}</div>
                  <div className="email">{user.email}</div>
                </div>
              </div>
              <button onClick={() => { setMenuOpen(false); onOpenAdvisors(); }}>
                <Icon name="Users" size={14} /> Manage advisors
              </button>
              <button onClick={() => { setMenuOpen(false); onNav('canvas', { canvasTab: 'documents' }); }}>
                <Icon name="FolderOpen" size={14} /> My documents
              </button>
              <button onClick={() => { setMenuOpen(false); onNav('settings'); }}>
                <Icon name="Settings" size={14} /> Settings
              </button>
              <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('open-user-guide')); }}>
                <Icon name="LifeBuoy" size={14} /> Help &amp; support
              </button>
              <div className="divider" />
              <button className="danger" onClick={() => { setMenuOpen(false); onSignOut ? onSignOut() : onNav('home'); }}>
                <Icon name="LogOut" size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
