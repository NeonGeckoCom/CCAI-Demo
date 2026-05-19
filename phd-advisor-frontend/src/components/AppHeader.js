import React from 'react';
import { Home, Menu, Users } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { useAppConfig } from '../contexts/AppConfigContext';

/**
 * Shared floating header used on every page so the app feels like one surface.
 *
 * Props:
 *   currentPage: 'home' | 'chat' | 'canvas'
 *   onNavigateToHome, onNavigateToChat, onNavigateToCanvas: navigation callbacks
 *     (onNavigateToCanvas may receive 'insights' | 'workspace' to deep-link a view)
 *   onMobileMenu?: () => void  — when present, shows the mobile menu button
 *   children?: ReactNode        — extra controls slotted between the tabs and the theme toggle
 */
const AppHeader = ({
  currentPage = 'home',
  onNavigateToHome,
  onNavigateToChat,
  onNavigateToCanvas,
  onMobileMenu,
  children,
}) => {
  const { config, resolveIcon } = useAppConfig();
  const BrandIcon = resolveIcon ? resolveIcon('Users') : Users;

  const goToCanvas = (view) => {
    if (onNavigateToCanvas) onNavigateToCanvas(view);
  };

  // Accept either 'canvas' (all canvas tabs highlight equally) or a more specific
  // 'canvas-<subview>' from CanvasPage so only the active one highlights.
  const isOnHome = currentPage === 'home';
  const isOnChat = currentPage === 'chat';
  const isOnCanvas = currentPage === 'canvas' || currentPage.startsWith('canvas-');
  const canvasSub = currentPage.startsWith('canvas-') ? currentPage.slice(7) : null;
  const tabActive = (sub) => isOnCanvas && (canvasSub === null ? false : canvasSub === sub);

  return (
    <header className="floating-header app-header">
      <div className="header-left">
        {onMobileMenu && (
          <button className="mobile-menu-button" onClick={onMobileMenu}>
            <Menu size={20} />
          </button>
        )}
        <button
          className="modern-home-btn"
          onClick={onNavigateToHome}
          title="Home"
          disabled={isOnHome}
          aria-disabled={isOnHome}
        >
          <Home size={20} />
        </button>
        <div className="header-brand">
          <div className="brand-icon">
            <BrandIcon size={24} />
          </div>
          <div className="brand-text">
            <h1>{config?.app?.title || 'Advisory'}</h1>
            <p>{config?.app?.subtitle || 'AI-Powered Guidance'}</p>
          </div>
        </div>
      </div>

      {/* Hide the view pill bar on the home page — home is a landing page,
          not part of the chat ↔ canvas surface. */}
      {!isOnHome && (
        <div className="canvas-tabs chat-view-tabs">
          <button className={`tab ${isOnChat ? 'active' : ''}`} onClick={onNavigateToChat}>Chat</button>
          <button className={`tab ${tabActive('insights') ? 'active' : ''}`} onClick={() => goToCanvas('insights')}>Insights</button>
          <button className={`tab ${tabActive('workspace') ? 'active' : ''}`} onClick={() => goToCanvas('workspace')}>Workspace</button>
          <button className={`tab ${tabActive('deliverables') ? 'active' : ''}`} onClick={() => goToCanvas('deliverables')}>Documents</button>
        </div>
      )}

      {/* Compact mobile dropdown — appears in place of the pill bar at narrow widths */}
      {!isOnHome && (
        <select
          className="canvas-tabs-mobile"
          value={isOnChat ? 'chat' : (canvasSub || 'workspace')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'chat') onNavigateToChat();
            else goToCanvas(v);
          }}
        >
          <option value="chat">Chat</option>
          <option value="insights">Insights</option>
          <option value="workspace">Workspace</option>
          <option value="deliverables">Documents</option>
        </select>
      )}

      <div className="header-right">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
};

export default AppHeader;
