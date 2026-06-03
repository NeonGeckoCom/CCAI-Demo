import React, { useState } from 'react';
import AppHeader from '../components/canvas/AppHeader';
import CanvasSidebar from '../components/canvas/CanvasSidebar';
import SubTabs from '../components/canvas/SubTabs';
import InsightsView from '../components/canvas/InsightsView';
import WorkspaceView from '../components/canvas/WorkspaceView';
import DocumentsView from '../components/canvas/DocumentsView';
import WidgetPalette from '../components/canvas/WidgetPalette';
import Icon from '../components/canvas/Icon';
import Toast from '../components/canvas/Toast';
import { DEMO_PROJECT } from '../data/canvasData';

/**
 * PhD Canvas — the redesigned workspace. Three sub-views (Insights /
 * Workspace / Documents) sit under a shared project header. The global
 * AppHeader and the canvas sidebar wrap everything.
 */
const CanvasPageV2 = ({
  user,
  activeAdvisorIds,
  onOpenAdvisors,
  onNav,
  canvasTab = 'insights',
  onSetCanvasTab,
  onSignOut
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const switchTab = (id) => (onSetCanvasTab ? onSetCanvasTab(id) : null);

  return (
    <div className="app-frame">
      <AppHeader
        view="canvas"
        onNav={onNav}
        activeAdvisorIds={activeAdvisorIds}
        onOpenAdvisors={onOpenAdvisors}
        user={user}
        canvasTab={canvasTab}
        onSignOut={onSignOut}
      />
      <div className={`app-shell ${collapsed ? 'collapsed' : ''}`} style={{ minHeight: 0 }}>
        <CanvasSidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          activeView="canvas"
          onNav={onNav}
        />
        <main className="page">
          <div className="project-header">
            <div className="ph-top">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 8px',
                    background: 'var(--feature-bg)', color: 'var(--accent-primary)',
                    borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.06em'
                  }}>Active project</span>
                </div>
                <h1>{DEMO_PROJECT.title}</h1>
                <div className="ph-meta">{DEMO_PROJECT.meta}</div>
              </div>
              <div className="ph-actions">
                <button className="btn ghost" onClick={() => setToast('Switch project — wire to /api/projects')}>
                  <Icon name="ChevronsUpDown" size={14} /> <span>Switch project</span>
                </button>
                <button className="btn primary" onClick={() => onNav('chat')}>
                  <Icon name="MessageCircle" size={14} color="#fff" /> <span>Continue chat</span>
                </button>
              </div>
            </div>
          </div>

          <SubTabs value={canvasTab} onChange={switchTab} />

          {canvasTab === 'insights' && <InsightsView onRefresh={() => setToast('Refreshing insights — wire to /api/phd-canvas/refresh')} />}
          {canvasTab === 'workspace' && <WorkspaceView onOpenPalette={() => setPaletteOpen(true)} />}
          {canvasTab === 'documents' && <DocumentsView />}

          <footer style={{ marginTop: 40, padding: '20px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, borderTop: '1px solid var(--border-tertiary)' }}>
            © 2025 University of Colorado Boulder · Built on the Advisory Panel platform · Prototype v0.2 — dev handoff
          </footer>
        </main>
      </div>

      <WidgetPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAdd={(type) => window.dispatchEvent(new CustomEvent('workspace:add-widget', { detail: { type } }))}
      />

      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  );
};

export default CanvasPageV2;
