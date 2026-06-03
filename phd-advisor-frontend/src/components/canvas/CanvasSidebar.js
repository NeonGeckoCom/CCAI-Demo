import React, { useState } from 'react';
import Icon from './Icon';
import { MOCK_CHATS } from '../../data/canvasData';

/**
 * Canvas sidebar (separate from the Chat page's own Sidebar). Uses the
 * `.cv-sidebar` class so its styles never collide with the chat sidebar.
 */
const CanvasSidebar = ({ collapsed, onToggleCollapsed, activeView, onNav }) => {
  const nav = (id) => onNav && onNav(id);
  const [query, setQuery] = useState('');
  const chats = (MOCK_CHATS || []).filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside className="cv-sidebar">
      <div className="sb-top-row">
        {!collapsed ? (
          <button className="sb-newchat sm" onClick={() => nav('chat')}>
            <Icon name="SquarePen" size={14} color="#fff" />
            <span>New chat</span>
          </button>
        ) : (
          <button className="sb-newchat sm icon-only" onClick={() => nav('chat')} title="New chat">
            <Icon name="SquarePen" size={14} color="#fff" />
          </button>
        )}
        <button className="sb-collapse" onClick={onToggleCollapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name={collapsed ? 'ChevronsRight' : 'ChevronsLeft'} size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="sb-search">
          <Icon name="Search" size={14} />
          <input
            type="text"
            placeholder="Search chats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="sb-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="X" size={12} />
            </button>
          )}
        </div>
      )}

      {!collapsed && <div className="sb-section-label">Workspace</div>}
      <nav className="sb-nav">
        <button className={`sb-item ${activeView === 'chat' ? 'active' : ''}`} onClick={() => nav('chat')}>
          <Icon name="MessageSquare" size={16} />
          {!collapsed && <span>Advisors Chat</span>}
        </button>
        <button className={`sb-item ${activeView === 'canvas' ? 'active' : ''}`} onClick={() => nav('canvas')}>
          <Icon name="LayoutDashboard" size={16} />
          {!collapsed && <span>PhD Canvas</span>}
          {!collapsed && <span className="sb-item-meta">New</span>}
        </button>
        <button className="sb-item" onClick={() => nav('home')}>
          <Icon name="Home" size={16} />
          {!collapsed && <span>Home</span>}
        </button>
      </nav>

      {!collapsed && (
        <>
          <div className="sb-section-label">
            {query ? `Results (${chats.length})` : 'Recent Chats'}
          </div>
          <div className="sb-chats">
            {chats.length === 0 ? (
              <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                No chats match "<strong>{query}</strong>".
              </div>
            ) : (
              chats.map((c) => (
                <button key={c.id} className="sb-item" title={c.title}>
                  <Icon name="MessageSquare" size={14} />
                  <span className="truncate">{c.title}</span>
                  <span className="sb-item-meta">{c.when}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
};

export default CanvasSidebar;
