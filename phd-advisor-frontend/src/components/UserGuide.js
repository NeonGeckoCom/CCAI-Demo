import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as LucideIcons from 'lucide-react';
import { X, Search, ChevronRight, BookOpen } from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { userGuideTopics } from '../data/userGuide';
import '../styles/UserGuide.css';

const UserGuide = () => {
  const { config } = useAppConfig();
  const [isOpen, setIsOpen] = useState(false);
  const [activeId, setActiveId] = useState(userGuideTopics[0].id);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('open-user-guide', open);
    return () => window.removeEventListener('open-user-guide', open);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => e.key === 'Escape' && setIsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const appName = config?.app?.title || 'the app';
  const q = search.toLowerCase().trim();
  const filteredTopics = q
    ? userGuideTopics.filter(t =>
        t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q))
    : userGuideTopics;
  const activeTopic = userGuideTopics.find(t => t.id === activeId) || userGuideTopics[0];

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="ug-overlay" onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
      <div className="ug-modal" role="dialog" aria-label="User Guide">
        {/* Header */}
        <div className="ug-header">
          <div className="ug-title">
            <span className="ug-title-icon">
              <BookOpen size={18} />
            </span>
            <span>User Guide</span>
          </div>
          <button className="ug-close" onClick={() => setIsOpen(false)} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="ug-body">
          {/* Sidebar / TOC */}
          <aside className="ug-sidebar">
            <div className="ug-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search the guide…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <nav className="ug-toc">
              {filteredTopics.length === 0 && (
                <div className="ug-empty">No matches</div>
              )}
              {filteredTopics.map((t) => {
                const TopicIcon = LucideIcons[t.icon] || BookOpen;
                return (
                  <button
                    key={t.id}
                    className={`ug-toc-item ${t.id === activeId ? 'active' : ''}`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <TopicIcon size={16} />
                    <span>{t.title}</span>
                    <ChevronRight size={14} className="ug-toc-arrow" />
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <main className="ug-content" key={activeTopic.id}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {activeTopic.content.replace(/\{\{appName\}\}/g, appName)}
            </ReactMarkdown>
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UserGuide;
