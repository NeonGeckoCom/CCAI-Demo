import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppConfig } from '../contexts/AppConfigContext';
import Sidebar from '../components/Sidebar';
import AppHeader from '../components/AppHeader';
import Icon from '../components/canvas/CanvasIcon';
import {
  INSIGHTS, WIDGET_CATALOG, DEFAULT_LAYOUT, EMPTY_STATE, WORKSPACE_PRESETS,
} from '../components/canvas/canvasData';
import {
  BibliographyWidget, KanbanWidget, PomodoroWidget, WritingWidget,
  DeadlinesWidget, BudgetWidget, ReadingQueueWidget, NotesWidget,
  HabitsWidget, GoalsWidget, MeetingsWidget,
  OutlineWidget, HighlightsWidget, LatexWidget,
  CalendarWidget, DocumenterWidget, ActivityWidget,
  PhdJourneyWidget, PhdResourcesWidget,
  StubWidget,
} from '../components/canvas/CanvasWidgets';
import {
  Reviewer2Widget, DevilsAdvocateWidget, ScopeRealismWidget,
  ReviewerModal, DevilsModal, ScopeModal,
} from '../components/canvas/CanvasCriticWidgets';
import {
  AddCitationModal, AddTaskModal, AddDeadlineModal, LogWordsModal,
  ConfirmRemoveModal, ReadingPaperModal, BudgetItemModal,
  NoteModal, HabitModal, GoalModal, MeetingModal,
  PaletteModal, CommandPaletteModal, GlobalSearchModal,
} from '../components/canvas/CanvasModals';
import CanvasWelcomeTour from '../components/canvas/CanvasWelcomeTour';
import DeliverablesView, { TEMPLATES as DELIVERABLE_TEMPLATES } from '../components/canvas/CanvasDeliverables';
import { MOD } from '../components/canvas/platform';
import '../styles/CanvasPage.css';

const LAYOUT_KEY = 'canvas-layout-v2';
const STATES_KEY = 'canvas-states-v2';
const VIEW_KEY = 'canvas-view-v2';

function renderWidget(type, state, setState, openModal, allStates) {
  const props = { state, setState, openModal, allStates };
  switch (type) {
    case 'bibliography': return <BibliographyWidget {...props}/>;
    case 'kanban': return <KanbanWidget {...props}/>;
    case 'pomodoro': return <PomodoroWidget {...props}/>;
    case 'writing': return <WritingWidget {...props}/>;
    case 'deadlines': return <DeadlinesWidget {...props}/>;
    case 'budget': return <BudgetWidget {...props}/>;
    case 'reading-queue': return <ReadingQueueWidget {...props}/>;
    case 'notes': return <NotesWidget {...props}/>;
    case 'habits': return <HabitsWidget {...props}/>;
    case 'goals': return <GoalsWidget {...props}/>;
    case 'meeting-log': return <MeetingsWidget {...props}/>;
    case 'reviewer-2': return <Reviewer2Widget {...props}/>;
    case 'devils-advocate': return <DevilsAdvocateWidget {...props}/>;
    case 'scope-realism': return <ScopeRealismWidget {...props}/>;
    case 'outline': return <OutlineWidget {...props}/>;
    case 'highlights': return <HighlightsWidget {...props}/>;
    case 'latex': return <LatexWidget {...props}/>;
    case 'calendar': return <CalendarWidget {...props}/>;
    case 'documenter': return <DocumenterWidget {...props}/>;
    case 'activity': return <ActivityWidget {...props}/>;
    case 'phd-journey': return <PhdJourneyWidget {...props}/>;
    case 'phd-resources': return <PhdResourcesWidget {...props}/>;
    default: {
      const meta = WIDGET_CATALOG.find(w => w.type === type);
      return <StubWidget meta={meta}/>;
    }
  }
}

function CanvasWidget({ widget, isDragging, isDragOver, onDragStart, onDragOver, onDragEnd, onDrop, state, setState, onRemove, onResize, openModal, allStates }) {
  const meta = WIDGET_CATALOG.find(w => w.type === widget.type);
  if (!meta) return null;
  const sizes = ['S', 'M', 'L'];
  const cycleSize = () => onResize(widget.id, sizes[(sizes.indexOf(widget.size) + 1) % sizes.length]);

  return (
    <div
      className={`widget size-${widget.size} ${meta.critic ? 'critic' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      onDragOver={(e) => { e.preventDefault(); onDragOver(widget.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(widget.id); }}
    >
      <div
        className="widget-head"
        draggable
        onDragStart={(e) => { onDragStart(widget.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={onDragEnd}
      >
        <span className="drag-grip"><Icon name="grip" size={14}/></span>
        <div className="widget-icon"><Icon name={meta.icon} size={14}/></div>
        <div className="widget-title">{meta.name}</div>
        {meta.critic && <span className="widget-tag">wedge</span>}
        <span className="size-pill" onClick={cycleSize} title="Cycle size S → M → L">{widget.size}</span>
        <div className="widget-actions">
          <button className="icon-btn" onClick={() => onRemove(widget.id, meta.name)} title="Remove"><Icon name="trash" size={13}/></button>
        </div>
      </div>
      <div className="widget-body">
        {renderWidget(widget.type, state, setState, openModal, allStates)}
      </div>
    </div>
  );
}

// ============================================================================
// Insights view — AI-synthesized highlights with stats bar, filters, and
// click-to-expand source quotes.
// ============================================================================
const INSIGHT_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'abandoned', label: 'Abandoned' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'high', label: 'High confidence' },
  { id: 'progress', label: 'Progress' },
  { id: 'theory', label: 'Theory' },
  { id: 'literature', label: 'Literature' },
  { id: 'action', label: 'Actions' },
  { id: 'risk', label: 'Risks' },
];
const CATEGORY_TINT = {
  progress: 'rgba(16, 185, 129, 0.12)',
  theory: 'rgba(99, 102, 241, 0.12)',
  literature: 'rgba(245, 158, 11, 0.12)',
  action: 'rgba(59, 130, 246, 0.12)',
  risk: 'rgba(220, 38, 38, 0.12)',
};
const CATEGORY_FG = {
  progress: '#10B981',
  theory: '#818CF8',
  literature: '#F59E0B',
  action: '#3B82F6',
  risk: '#DC2626',
};
const confidenceTier = (c) => c >= 75 ? 'high' : c >= 60 ? 'med' : 'low';

// Task statuses live on each individual bullet within an insight, not on the
// whole card — Daniel's feedback: "each card is a discrete task, not a set of tasks".
const TASK_STATUSES = [
  { id: 'open', label: 'Open', color: 'var(--canvas-text-3)', icon: 'sparkles' },
  { id: 'in-progress', label: 'In progress', color: '#3B82F6', icon: 'graph' },
  { id: 'completed', label: 'Completed', color: '#10B981', icon: 'check' },
  { id: 'abandoned', label: 'Abandoned', color: 'var(--canvas-text-4)', icon: 'x' },
];
const TASK_STATUS_KEY = 'canvas-task-status-v1';
const taskKey = (insId, idx) => `${insId}::${idx}`;

function InsightsView({ widgetStates, setWidgetStates, onNavigateToChat }) {
  const [pinned, setPinned] = useState(() => new Set(INSIGHTS.filter(i => i.pinned).map(i => i.id)));
  const [taskStatuses, setTaskStatuses] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TASK_STATUS_KEY) || '{}'); } catch { return {}; }
  });
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('confidence');
  const [expanded, setExpanded] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [openStatusMenu, setOpenStatusMenu] = useState(null);
  // 'cards' = current cards-of-tasks layout, 'tasks' = flat task list per Daniel's
  // "Sections in sidebar, Tasks in the main view" suggestion.
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('canvas-insights-view') || 'cards');
  useEffect(() => { localStorage.setItem('canvas-insights-view', viewMode); }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(TASK_STATUS_KEY, JSON.stringify(taskStatuses));
  }, [taskStatuses]);

  const taskStatusOf = (insId, idx) => taskStatuses[taskKey(insId, idx)] || 'open';
  const setTaskStatus = (insId, idx, status) => {
    setTaskStatuses(prev => ({ ...prev, [taskKey(insId, idx)]: status }));
    const lbl = TASK_STATUSES.find(s => s.id === status)?.label || status;
    window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: `Task marked ${lbl}`, kind: 'success' } }));
  };

  // Roll up to a card-level status: completed if all tasks done, abandoned if all abandoned,
  // in-progress if any are in-progress, otherwise open.
  const insightRollup = (ins) => {
    const states = ins.bullets.map((_, idx) => taskStatusOf(ins.id, idx));
    const total = states.length;
    if (total === 0) return { state: 'open', done: 0, total: 0, pct: 0 };
    const done = states.filter(s => s === 'completed').length;
    const inProg = states.filter(s => s === 'in-progress').length;
    const abandoned = states.filter(s => s === 'abandoned').length;
    let state = 'open';
    if (done === total) state = 'completed';
    else if (abandoned === total) state = 'abandoned';
    else if (inProg > 0 || done > 0) state = 'in-progress';
    return { state, done, total, inProg, abandoned, pct: Math.round((done / total) * 100) };
  };

  const togglePin = (id) => {
    setPinned(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleExpand = (id) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const insightToTaskTitle = (ins) => {
    const plain = (ins.bullets[0] || ins.summary || ins.title).replace(/<[^>]+>/g, '');
    return plain.length > 80 ? plain.slice(0, 77) + '…' : plain;
  };

  const sendToKanban = (ins) => {
    if (!setWidgetStates) return;
    const kanban = widgetStates.kanban || EMPTY_STATE.kanban;
    const card = {
      id: 'k' + Date.now(),
      col: 'todo',
      title: insightToTaskTitle(ins),
      priority: 'med',
      meta: `from Insights · ${ins.title}`,
    };
    setWidgetStates(s => ({ ...s, kanban: { ...kanban, cards: [...kanban.cards, card] } }));
    window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: 'Sent to Kanban (To Do)', kind: 'success' } }));
  };

  // TODO(LLM): real refresh hits the orchestrator and re-synthesizes insights.
  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 900);
    window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: 'Refreshing insights… (stub)', kind: 'success' } }));
  };

  // "Ask follow-up": stash a draft prompt + insight context that the chat page
  // can pick up on next navigation. Backend hookup TODO: include source-conversation IDs.
  const askFollowUp = (ins) => {
    const plain = (ins.bullets[0] || ins.summary || '').replace(/<[^>]+>/g, '');
    const prompt = `Follow up on the insight "${ins.title}": ${plain}`;
    try {
      localStorage.setItem('canvas-chat-handoff', JSON.stringify({
        at: Date.now(),
        prompt,
        insightId: ins.id,
        insightTitle: ins.title,
      }));
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('canvas-toast', {
      detail: { msg: `Follow-up drafted: "${ins.title}" — opening chat`, kind: 'success' },
    }));
    // Use the existing navigation prop if present; falls back to the global event.
    if (onNavigateToChat) onNavigateToChat();
  };

  const filtered = useMemo(() => {
    let r = INSIGHTS;
    if (filter === 'pinned') r = r.filter(i => pinned.has(i.id));
    else if (filter === 'high') r = r.filter(i => i.confidence >= 75);
    else if (['open', 'in-progress', 'completed', 'abandoned'].includes(filter)) r = r.filter(i => insightRollup(i).state === filter);
    else if (filter !== 'all') r = r.filter(i => i.category === filter);
    if (sortBy === 'confidence') r = [...r].sort((a, b) => b.confidence - a.confidence);
    if (sortBy === 'recent') r = [...r].sort((a, b) => (a.updatedMinutesAgo || 0) - (b.updatedMinutesAgo || 0));
    if (sortBy === 'progress') r = [...r].sort((a, b) => insightRollup(b).pct - insightRollup(a).pct);
    return r;
  }, [filter, sortBy, pinned, taskStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aggregate stats over individual TASKS, not insights (Daniel's framing)
  const stats = useMemo(() => {
    const allTasks = INSIGHTS.flatMap(i => i.bullets.map((_, idx) => taskStatusOf(i.id, idx)));
    const taskTotal = allTasks.length;
    const completed = allTasks.filter(s => s === 'completed').length;
    const inProgress = allTasks.filter(s => s === 'in-progress').length;
    const abandoned = allTasks.filter(s => s === 'abandoned').length;
    const open = taskTotal - completed - inProgress - abandoned;
    const totalSources = INSIGHTS.reduce((s, i) => s + (i.sources || 0), 0);
    const avgConf = Math.round(INSIGHTS.reduce((s, i) => s + i.confidence, 0) / INSIGHTS.length);
    return {
      sections: INSIGHTS.length, taskTotal, completed, inProgress, abandoned, open,
      totalSources, avgConf, pinnedCount: pinned.size,
    };
  }, [pinned, taskStatuses]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUpdated = Math.min(...INSIGHTS.map(i => i.updatedMinutesAgo || 0));

  // Empty state — defensive (current data is hardcoded but a real backend could send [])
  if (INSIGHTS.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">Insights</h1>
            <div className="page-sub">AI-synthesized from your research conversations.</div>
          </div>
        </div>
        <div className="empty-cell">
          <Icon name="sparkles" size={32} style={{ color: 'var(--canvas-text-4)' }}/>
          <div style={{ fontSize: 14, color: 'var(--canvas-text-2)', fontWeight: 500 }}>No insights yet</div>
          <div>Have a conversation with your advisors and insights will appear here.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Insights</h1>
          <div className="page-sub">AI-synthesized from your research conversations.</div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="insights-stats">
        <div className="insights-stat">
          <span className="insights-stat-value">{stats.completed}/{stats.taskTotal}</span>
          <span className="insights-stat-label">tasks done</span>
        </div>
        <div className="insights-stat insights-stat-progress">
          <div className="insights-progress-bar">
            <i className="ip-completed" style={{ width: `${(stats.completed / Math.max(1, stats.taskTotal)) * 100}%` }}/>
            <i className="ip-inprogress" style={{ width: `${(stats.inProgress / Math.max(1, stats.taskTotal)) * 100}%` }}/>
            <i className="ip-abandoned" style={{ width: `${(stats.abandoned / Math.max(1, stats.taskTotal)) * 100}%` }}/>
          </div>
          <span className="insights-stat-label">
            {stats.completed} done · {stats.inProgress} in progress · {stats.open} open
            {stats.abandoned > 0 && ` · ${stats.abandoned} abandoned`}
          </span>
        </div>
        <div className="insights-stat">
          <span className="insights-stat-value">{stats.sections}</span>
          <span className="insights-stat-label">sections</span>
        </div>
        <div className="insights-stat">
          <span className="insights-stat-value">{stats.avgConf}%</span>
          <span className="insights-stat-label">avg confidence</span>
        </div>
        <span style={{ flex: 1 }}/>
        <span className="insights-stat-update">
          <span className="dot"/>
          updated {lastUpdated} min ago
        </span>
        <button className="btn btn-ghost" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <div className="spinner"/> : <Icon name="refresh" size={13}/>}
          Refresh
        </button>
      </div>

      {/* View toggle: Cards (sections with their tasks) vs Tasks (flat list) */}
      <div className="insights-view-toggle">
        <button className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}>
          <Icon name="layout" size={12}/>Cards
        </button>
        <button className={viewMode === 'tasks' ? 'active' : ''} onClick={() => setViewMode('tasks')}>
          <Icon name="task" size={12}/>Tasks
        </button>
      </div>

      {/* Filter + sort */}
      <div className="insights-filters">
        <div className="palette-cats" style={{ marginBottom: 0 }}>
          {INSIGHT_CATEGORIES.map(c => {
            const count =
              c.id === 'all' ? INSIGHTS.length :
              c.id === 'pinned' ? pinned.size :
              c.id === 'high' ? INSIGHTS.filter(i => i.confidence >= 75).length :
              ['open', 'in-progress', 'completed', 'abandoned'].includes(c.id) ? INSIGHTS.filter(i => insightRollup(i).state === c.id).length :
              INSIGHTS.filter(i => i.category === c.id).length;
            if (count === 0 && c.id !== 'all') return null;
            return (
              <button key={c.id}
                className={`palette-cat ${filter === c.id ? 'active' : ''}`}
                onClick={() => setFilter(c.id)}>
                {c.label}<span style={{ marginLeft: 6, opacity: 0.6 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 11, fontFamily: 'var(--canvas-mono)' }}
          value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="confidence">↓ confidence</option>
          <option value="recent">↓ recent</option>
          <option value="progress">↓ progress</option>
        </select>
      </div>

      {/* Pinned strip — only when there are pins and we're not already filtering by pinned */}
      {pinned.size > 0 && filter !== 'pinned' && (
        <div className="insights-pinned-strip">
          <span style={{ fontSize: 11, color: 'var(--canvas-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Pinned
          </span>
          {INSIGHTS.filter(i => pinned.has(i.id)).map(ins => (
            <button key={ins.id} className="insights-pinned-pill" onClick={() => {
              const el = document.getElementById(`insight-${ins.id}`);
              if (el) {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                el.style.boxShadow = '0 0 0 2px var(--canvas-accent), 0 0 24px var(--canvas-accent-glow)';
                setTimeout(() => { el.style.boxShadow = ''; }, 1400);
              }
            }}>
              <Icon name={ins.icon} size={11}/>{ins.title}
            </button>
          ))}
        </div>
      )}

      {/* TASKS view — flat list of every bullet across insights */}
      {viewMode === 'tasks' && (() => {
        const allTasks = filtered.flatMap(ins => ins.bullets.map((b, idx) => ({
          ins, idx, text: b, status: taskStatusOf(ins.id, idx),
        })));
        const statusOrder = { open: 0, 'in-progress': 1, completed: 2, abandoned: 3 };
        const sorted = [...allTasks].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
        if (sorted.length === 0) {
          return (
            <div className="empty-cell">
              <Icon name="task" size={28} style={{ color: 'var(--canvas-text-4)' }}/>
              <div style={{ fontSize: 14, color: 'var(--canvas-text-2)', fontWeight: 500 }}>No tasks match this filter</div>
              <button className="btn btn-ghost" onClick={() => setFilter('all')}>Show all</button>
            </div>
          );
        }
        return (
          <div className="insights-tasks-list">
            {sorted.map(({ ins, idx, text, status }) => {
              const meta = TASK_STATUSES.find(s => s.id === status);
              const menuKey = `tv::${ins.id}::${idx}`;
              const menuOpen = openStatusMenu === menuKey;
              return (
                <div key={menuKey} className={`insights-task-row task-${status}`}>
                  <button
                    className="insight-task-check"
                    style={{ color: meta.color, borderColor: meta.color + '60' }}
                    onClick={() => setOpenStatusMenu(menuOpen ? null : menuKey)}
                    title={`Status: ${meta.label}`}
                  >
                    {status === 'completed' && <Icon name="check" size={11}/>}
                    {status === 'in-progress' && <span className="task-check-dot"/>}
                    {status === 'abandoned' && <Icon name="x" size={10}/>}
                  </button>
                  <div className="insights-task-body">
                    <button
                      className="insights-task-section"
                      onClick={() => {
                        setViewMode('cards');
                        setTimeout(() => {
                          const el = document.getElementById(`insight-${ins.id}`);
                          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }, 60);
                      }}
                      title="Jump to this section"
                    >
                      <Icon name={ins.icon} size={10}/>{ins.title}
                    </button>
                    <span className="insights-task-text" dangerouslySetInnerHTML={{ __html: text }}/>
                  </div>
                  <button className="chip" onClick={() => sendToKanban(ins)} title="Send this section's open tasks to Kanban">
                    <Icon name="task" size={11}/>Kanban
                  </button>
                  {menuOpen && (
                    <div className="insight-status-menu" onMouseLeave={() => setOpenStatusMenu(null)}>
                      {TASK_STATUSES.map(s => (
                        <button key={s.id}
                          className={status === s.id ? 'active' : ''}
                          onClick={() => { setTaskStatus(ins.id, idx, s.id); setOpenStatusMenu(null); }}>
                          <Icon name={s.icon} size={11} style={{ color: s.color }}/>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* CARDS view (default) */}
      {viewMode === 'cards' && (filtered.length === 0 ? (
        <div className="empty-cell">
          <Icon name="search" size={28} style={{ color: 'var(--canvas-text-4)' }}/>
          <div style={{ fontSize: 14, color: 'var(--canvas-text-2)', fontWeight: 500 }}>No insights match this filter</div>
          <button className="btn btn-ghost" onClick={() => setFilter('all')}>Show all</button>
        </div>
      ) : (
        <div className="insight-grid">
          {filtered.map(ins => {
            const isExpanded = expanded.has(ins.id);
            const isPinned = pinned.has(ins.id);
            const tier = confidenceTier(ins.confidence);
            const tint = CATEGORY_TINT[ins.category] || 'var(--canvas-surface-2)';
            const fg = CATEGORY_FG[ins.category] || 'var(--canvas-accent)';
            const rollup = insightRollup(ins);
            return (
              <div
                key={ins.id}
                id={`insight-${ins.id}`}
                className={`insight ${isPinned ? 'is-pinned' : ''} tier-${tier} status-${rollup.state}`}
              >
                <div className="insight-head">
                  <div className="insight-icon" style={{ background: tint, color: fg }}>
                    <Icon name={ins.icon} size={16}/>
                  </div>
                  <div className="insight-title">{ins.title}</div>
                  <ConfidenceRing value={ins.confidence}/>
                </div>

                {/* Per-card progress (rolls up the bullet tasks) */}
                {rollup.total > 0 && (
                  <div className="insight-progress">
                    <div className="insight-progress-meta">
                      <span className="insight-progress-count">{rollup.done}/{rollup.total} tasks</span>
                      {rollup.state === 'completed' && <span className="insight-progress-badge done">✓ Resolved</span>}
                      {rollup.state === 'abandoned' && <span className="insight-progress-badge abandoned">Abandoned</span>}
                      {rollup.state === 'in-progress' && <span className="insight-progress-badge inprog">In progress</span>}
                    </div>
                    <div className="insight-progress-bar">
                      <i className="ip-completed" style={{ width: `${(rollup.done / rollup.total) * 100}%` }}/>
                      {rollup.inProg > 0 && <i className="ip-inprogress" style={{ width: `${(rollup.inProg / rollup.total) * 100}%` }}/>}
                      {rollup.abandoned > 0 && <i className="ip-abandoned" style={{ width: `${(rollup.abandoned / rollup.total) * 100}%` }}/>}
                    </div>
                  </div>
                )}

                <div className="insight-body">
                  <div>{ins.summary}</div>
                  <ul className="insight-tasks">
                    {ins.bullets.map((b, idx) => {
                      const status = taskStatusOf(ins.id, idx);
                      const meta = TASK_STATUSES.find(s => s.id === status);
                      const menuOpen = openStatusMenu === `${ins.id}::${idx}`;
                      return (
                        <li key={idx} className={`insight-task task-${status}`}>
                          <button
                            className="insight-task-check"
                            style={{ color: meta.color, borderColor: meta.color + '60' }}
                            onClick={() => setOpenStatusMenu(menuOpen ? null : `${ins.id}::${idx}`)}
                            title={`Status: ${meta.label}`}
                          >
                            {status === 'completed' && <Icon name="check" size={10}/>}
                            {status === 'in-progress' && <span className="task-check-dot"/>}
                            {status === 'abandoned' && <Icon name="x" size={9}/>}
                          </button>
                          <span className="insight-task-text" dangerouslySetInnerHTML={{ __html: b }}/>
                          {menuOpen && (
                            <div className="insight-status-menu" onMouseLeave={() => setOpenStatusMenu(null)}>
                              {TASK_STATUSES.map(s => (
                                <button key={s.id}
                                  className={status === s.id ? 'active' : ''}
                                  onClick={() => { setTaskStatus(ins.id, idx, s.id); setOpenStatusMenu(null); }}>
                                  <Icon name={s.icon} size={11} style={{ color: s.color }}/>
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Detail panel — quotes from sources, only when expanded */}
                {isExpanded && ins.quotes && (
                  <div className="insight-detail">
                    <div className="insight-detail-head">Source quotes · {ins.sources} {ins.sources === 1 ? 'source' : 'sources'}</div>
                    {ins.quotes.map((q, i) => (
                      <div key={i} className="insight-quote">{q}</div>
                    ))}
                  </div>
                )}

                <div className="insight-foot">
                  <span className="insight-foot-meta">
                    <Icon name="message" size={10}/> {ins.sources}
                    <span className="insight-dot"/>
                    updated {ins.updatedMinutesAgo}m ago
                  </span>
                </div>

                <div className="insight-actions">
                  <button className="chip" onClick={() => askFollowUp(ins)} title="Open this insight in a new chat session">
                    <Icon name="message" size={11}/>Ask follow-up
                  </button>
                  <button className="chip" onClick={() => sendToKanban(ins)} title="Add all open tasks from this insight to your Kanban (To Do)">
                    <Icon name="task" size={11}/>Add to Kanban
                  </button>
                  <button className="chip" onClick={() => toggleExpand(ins.id)}>
                    <Icon name="expand" size={11}/>{isExpanded ? 'Collapse' : 'Source quotes'}
                  </button>
                  <button className={`chip ${isPinned ? 'pinned' : ''}`} onClick={() => togglePin(ins.id)}>
                    <Icon name="pin" size={11}/>{isPinned ? 'Pinned' : 'Pin'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// Small SVG ring used for the confidence indicator
function ConfidenceRing({ value }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - value / 100);
  const tier = confidenceTier(value);
  const color = tier === 'high' ? '#10B981' : tier === 'med' ? '#F59E0B' : '#DC2626';
  return (
    <div className={`confidence-ring tier-${tier}`} title={`${value}% confidence (${tier})`}>
      <svg width="32" height="32" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--canvas-surface-3)" strokeWidth="3"/>
        <circle cx="16" cy="16" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={dash} strokeLinecap="round"
          transform="rotate(-90 16 16)"/>
      </svg>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function PresetPicker({ onPick }) {
  return (
    <div className="canvas-presets">
      <div className="canvas-presets-head">
        <div className="canvas-presets-title">Start from a preset</div>
        <div className="canvas-presets-sub">Or skip and add widgets one at a time.</div>
      </div>
      <div className="canvas-presets-grid">
        {WORKSPACE_PRESETS.map(p => (
          <button key={p.id} className="canvas-preset-card" onClick={() => onPick(p)}>
            <div className="canvas-preset-icon"><Icon name={p.icon} size={18}/></div>
            <div className="canvas-preset-content">
              <div className="canvas-preset-name">{p.name}</div>
              <div className="canvas-preset-desc">{p.desc}</div>
              <div className="canvas-preset-meta">{p.layout.length} widgets</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceView({ openModal, layout, setLayout, widgetStates, setWidgetStates }) {
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const onDragStart = (id) => setDragId(id);
  const onDragOver = (id) => { if (id !== dragId) setDragOverId(id); };
  const onDragEnd = () => { setDragId(null); setDragOverId(null); };
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { onDragEnd(); return; }
    const next = [...layout];
    const fromIdx = next.findIndex(w => w.id === dragId);
    const toIdx = next.findIndex(w => w.id === targetId);
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLayout(next);
    onDragEnd();
  };

  const setWState = (type) => (updater) => {
    setWidgetStates(s => ({
      ...s,
      [type]: typeof updater === 'function' ? updater(s[type]) : updater,
    }));
  };

  const removeWidget = (id, label) => {
    openModal('confirm-remove', {
      label,
      onConfirm: () => {
        setLayout(l => l.filter(w => w.id !== id));
        window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: label + ' removed', kind: 'success' } }));
      },
    });
  };

  const resizeWidget = (id, size) => setLayout(l => l.map(w => w.id === id ? { ...w, size } : w));

  // Each widget starts from scratch — fresh empty state, no demo content.
  const addWidget = (meta) => {
    const id = 'w-' + Date.now();
    setLayout(l => [...l, { id, type: meta.type, size: meta.defaultSize, critic: meta.critic }]);
    if (EMPTY_STATE[meta.type]) {
      setWidgetStates(s => ({ ...s, [meta.type]: JSON.parse(JSON.stringify(EMPTY_STATE[meta.type])) }));
    }
  };

  const applyPreset = (preset) => {
    setLayout(preset.layout.map(w => ({ ...w })));
    // Seed empty state for any widget types not already present
    const seeds = {};
    preset.layout.forEach(w => {
      if (!widgetStates[w.type] && EMPTY_STATE[w.type]) {
        seeds[w.type] = JSON.parse(JSON.stringify(EMPTY_STATE[w.type]));
      }
    });
    if (Object.keys(seeds).length) setWidgetStates(s => ({ ...s, ...seeds }));
    window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: `${preset.name} preset loaded`, kind: 'success' } }));
  };

  const reset = () => {
    if (!window.confirm('Reset workspace? All widgets and content will be cleared.')) return;
    setLayout([]);
    setWidgetStates({});
    localStorage.removeItem(LAYOUT_KEY);
    localStorage.removeItem(STATES_KEY);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workspace</h1>
          <div className="page-sub">{layout.length} widgets · {layout.filter(w => w.critic).length} anti-yes-man · drag headers to reorder, click size pill to resize</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={reset} title="Reset layout"><Icon name="reset" size={13}/>Reset</button>
          <button className="btn btn-primary" onClick={() => openModal('palette', {
            layout, onAdd: addWidget,
          })}><Icon name="plus" size={13}/>Add widget</button>
        </div>
      </div>
      {layout.length === 0 && (
        <PresetPicker onPick={applyPreset}/>
      )}
      <div className="workspace">
        {layout.length === 0 && (
          <div className="empty-cell">
            <Icon name="layout" size={28} style={{ color: 'var(--canvas-text-4)' }}/>
            <div style={{ fontSize: 14, color: 'var(--canvas-text-2)', fontWeight: 500 }}>Or build from scratch</div>
            <button className="btn btn-primary" onClick={() => openModal('palette', { layout, onAdd: addWidget })} style={{ marginTop: 6 }}>
              <Icon name="plus" size={13}/>Add your first widget
            </button>
          </div>
        )}
        {layout.map((w) => (
          <CanvasWidget
            key={w.id}
            widget={w}
            isDragging={dragId === w.id}
            isDragOver={dragOverId === w.id}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            state={widgetStates[w.type] ?? (EMPTY_STATE[w.type] ?? {})}
            setState={setWState(w.type)}
            onRemove={removeWidget}
            onResize={resizeWidget}
            openModal={openModal}
            allStates={widgetStates}
          />
        ))}
      </div>
    </>
  );
}

function ModalRouter({ modal, onClose }) {
  if (!modal) return null;
  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) onClose(); };
  let content = null;
  switch (modal.kind) {
    case 'palette':         content = <PaletteModal data={modal.data} onClose={onClose}/>; break;
    case 'add-citation':    content = <AddCitationModal data={modal.data} onClose={onClose}/>; break;
    case 'add-task':        content = <AddTaskModal data={modal.data} onClose={onClose}/>; break;
    case 'add-deadline':    content = <AddDeadlineModal data={modal.data} onClose={onClose}/>; break;
    case 'log-words':       content = <LogWordsModal data={modal.data} onClose={onClose}/>; break;
    case 'confirm-remove':  content = <ConfirmRemoveModal data={modal.data} onClose={onClose}/>; break;
    case 'reviewer-2':      content = <ReviewerModal data={modal.data} onClose={onClose}/>; break;
    case 'devils-advocate': content = <DevilsModal data={modal.data} onClose={onClose}/>; break;
    case 'scope-realism':   content = <ScopeModal data={modal.data} onClose={onClose}/>; break;
    case 'reading-paper':   content = <ReadingPaperModal data={modal.data} onClose={onClose}/>; break;
    case 'budget-item':     content = <BudgetItemModal data={modal.data} onClose={onClose}/>; break;
    case 'note':            content = <NoteModal data={modal.data} onClose={onClose}/>; break;
    case 'habit':           content = <HabitModal data={modal.data} onClose={onClose}/>; break;
    case 'goal':            content = <GoalModal data={modal.data} onClose={onClose}/>; break;
    case 'meeting':         content = <MeetingModal data={modal.data} onClose={onClose}/>; break;
    case 'command':         content = <CommandPaletteModal data={modal.data} onClose={onClose}/>; break;
    case 'global-search':   content = <GlobalSearchModal data={modal.data} onClose={onClose}/>; break;
    default: return null;
  }
  return <div className="canvas-modal-backdrop" onClick={handleBackdropClick}>{content}</div>;
}

function ToastStack() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const handler = (e) => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, ...e.detail }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
    };
    window.addEventListener('canvas-toast', handler);
    return () => window.removeEventListener('canvas-toast', handler);
  }, []);
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind || 'success'}`}>
          <Icon name={t.kind === 'critic' ? 'gavel' : t.kind === 'danger' ? 'alert' : 'check'} size={14}/>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}


const CanvasPage = ({ user, authToken, onNavigateToHome, onNavigateToChat, onSignOut }) => {
  const { theme, toggleTheme } = useTheme();
  useAppConfig();
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'workspace');
  const [modal, setModal] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [tourForceShow, setTourForceShow] = useState(0);

  const [layout, setLayout] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUT;
    } catch { return DEFAULT_LAYOUT; }
  });
  const [widgetStates, setWidgetStates] = useState(() => {
    try {
      const saved = localStorage.getItem(STATES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);
  useEffect(() => { localStorage.setItem(STATES_KEY, JSON.stringify(widgetStates)); }, [widgetStates]);
  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  // Apply canvas theme attribute on body for scoped styling
  useEffect(() => {
    document.body.dataset.canvasTheme = theme;
    return () => { delete document.body.dataset.canvasTheme; };
  }, [theme]);

  const openModal = useCallback((kind, data = {}) => setModal({ kind, data }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const exportWorkspace = useCallback(() => {
    const data = { layout, states: widgetStates };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'canvas-workspace.json';
    a.click();
    window.dispatchEvent(new CustomEvent('canvas-toast', { detail: { msg: 'Workspace exported as JSON', kind: 'success' } }));
  }, [layout, widgetStates]);

  const openCommandPalette = useCallback(() => {
    openModal('command', {
      layout,
      onSetView: (v) => setView(v),
      onAddWidget: (meta) => {
        const id = 'w-' + Date.now();
        setLayout(l => [...l, { id, type: meta.type, size: meta.defaultSize, critic: meta.critic }]);
        if (EMPTY_STATE[meta.type]) {
          setWidgetStates(s => ({ ...s, [meta.type]: JSON.parse(JSON.stringify(EMPTY_STATE[meta.type])) }));
        }
      },
      onToggleTheme: toggleTheme,
      onExport: exportWorkspace,
    });
  }, [openModal, layout, toggleTheme, exportWorkspace]);

  const openGlobalSearch = useCallback(() => {
    openModal('global-search', { states: widgetStates });
  }, [openModal, widgetStates]);

  // Critic widgets dispatch `canvas-open-in-chat` when the user wants real LLM history.
  useEffect(() => {
    const handler = () => onNavigateToChat && onNavigateToChat();
    window.addEventListener('canvas-open-in-chat', handler);
    return () => window.removeEventListener('canvas-open-in-chat', handler);
  }, [onNavigateToChat]);

  // Esc closes modal, ⌘K opens command palette, ⌘/ opens global content search,
  // ? opens the welcome tour for help (matches the icon in the topbar).
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') closeModal();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        openGlobalSearch();
      }
      // ? key (Shift+/) — only when the user isn't typing in an input
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        setTourForceShow(n => n + 1);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [closeModal, openCommandPalette, openGlobalSearch]);

  // Highlight a widget when picked from the sidebar
  const flashScrollTo = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.style.boxShadow = '0 0 0 2px var(--canvas-accent), 0 0 24px var(--canvas-accent-glow)';
    setTimeout(() => { el.style.boxShadow = ''; }, 1400);
  };

  // Workspace: group widgets by category for the new sidebar
  const widgetGroups = useMemo(() => {
    const groups = {};
    layout.forEach(w => {
      const meta = WIDGET_CATALOG.find(m => m.type === w.type);
      if (!meta) return;
      const cat = meta.cat;
      (groups[cat] ||= { id: cat, label: cat, items: [] }).items.push({
        id: w.id,
        label: meta.name,
        icon: meta.icon,
        critic: meta.critic,
        onClick: () => flashScrollTo(`[data-widget-id="${w.id}"]`),
      });
    });
    // Order: critic last
    const order = ['research', 'writing', 'project', 'wellness', 'career', 'data', 'practical', 'critic'];
    return order.map(c => groups[c]).filter(Boolean);
  }, [layout]);

  // Insights: list of sections — Daniel's feedback said sidebar should show sections here
  const insightSections = useMemo(() => {
    let taskMap = {};
    try { taskMap = JSON.parse(localStorage.getItem(TASK_STATUS_KEY) || '{}'); } catch { /* ignore */ }
    return INSIGHTS.map(ins => {
      const states = ins.bullets.map((_, idx) => taskMap[taskKey(ins.id, idx)] || 'open');
      const done = states.filter(s => s === 'completed').length;
      return {
        id: ins.id,
        name: ins.title,
        icon: ins.icon,
        category: ins.category,
        confidence: ins.confidence,
        taskCount: ins.bullets.length,
        doneCount: done,
        onClick: () => flashScrollTo(`#insight-${ins.id}`),
      };
    });
  }, [view, layout, widgetStates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deliverables: list of projects with sections + history actions
  const deliverableProjects = useMemo(() => {
    try {
      const dStore = JSON.parse(localStorage.getItem('canvas-deliverables-v2') || '{}');
      const projects = Object.values(dStore.projects || {});
      return projects.map(p => {
        const t = DELIVERABLE_TEMPLATES.find(x => x.id === p.templateId);
        return {
          id: p.id,
          name: p.name,
          icon: t?.icon || 'book',
          versions: p.versions?.length || 0,
          isActive: p.id === dStore.activeProjectId,
          sections: (t?.sections || []).map(s => ({
            id: s.id,
            name: s.name,
            wc: ((p.sections || {})[s.id] || '').trim().split(/\s+/).filter(Boolean).length,
            onClick: () => {
              if (p.id !== dStore.activeProjectId) {
                // Open this project first; section scroll happens after a tick.
                const next = { ...dStore, activeProjectId: p.id };
                localStorage.setItem('canvas-deliverables-v2', JSON.stringify(next));
                window.dispatchEvent(new Event('storage'));
              }
              setTimeout(() => flashScrollTo(`#notion-section-${s.id}`), 80);
            },
          })),
          onOpen: () => {
            const next = { ...dStore, activeProjectId: p.id };
            localStorage.setItem('canvas-deliverables-v2', JSON.stringify(next));
            window.dispatchEvent(new Event('storage'));
          },
        };
      });
    } catch { return []; }
    // re-derive when view or layout changes (layout proxy for "user did something")
  }, [view, layout, widgetStates]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="canvas-page-with-sidebar" data-canvas-theme={theme}>
      <Sidebar
        user={user}
        authToken={authToken}
        onSignOut={onSignOut}
        onSidebarToggle={setIsSidebarCollapsed}
        isMobileOpen={isMobileMenuOpen}
        onMobileToggle={setIsMobileMenuOpen}
        onNavigateToCanvas={() => {}}
        onSelectSession={(id) => onNavigateToChat && onNavigateToChat(id)}
        onNewChat={() => onNavigateToChat && onNavigateToChat()}
        pageContext="canvas"
        canvasSubview={view}
        widgetGroups={widgetGroups}
        deliverableProjects={deliverableProjects}
        insightSections={insightSections}
      />
      <div className={`canvas-main-area ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="canvas-app-shell">
          <AppHeader
            currentPage={`canvas-${view}`}
            onNavigateToHome={onNavigateToHome}
            onNavigateToChat={onNavigateToChat}
            onNavigateToCanvas={(v) => setView(v || 'workspace')}
            onMobileMenu={() => setIsMobileMenuOpen(true)}
          >
            <button className="icon-btn" onClick={() => setTourForceShow(n => n + 1)} title="Show tour">
              <HelpCircle size={18}/>
            </button>
            <button className="icon-btn" onClick={openGlobalSearch} title={`Search canvas content (${MOD}+/)`}>
              <Icon name="search" size={16}/>
            </button>
            <button className="icon-btn" onClick={openCommandPalette} title={`Commands (${MOD}+K)`}>
              <Icon name="zap" size={16}/>
            </button>
          </AppHeader>
          <div className="canvas-content">
            {view === 'insights' && <InsightsView widgetStates={widgetStates} setWidgetStates={setWidgetStates} onNavigateToChat={onNavigateToChat}/>}
            {view === 'workspace' && <WorkspaceView openModal={openModal} layout={layout} setLayout={setLayout} widgetStates={widgetStates} setWidgetStates={setWidgetStates}/>}
            {view === 'deliverables' && <DeliverablesView allStates={widgetStates}/>}
          </div>
        </div>
      </div>
      <ModalRouter modal={modal} onClose={closeModal}/>
      <ToastStack/>
      <CanvasWelcomeTour key={tourForceShow} forceShow={tourForceShow > 0}/>
      <ShortcutHint/>
    </div>
  );
};

// Subtle floating hint bar showing the most-used keyboard shortcuts.
// Auto-hides on small screens and after the first 12s, until the user hovers.
function ShortcutHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 12000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className={`canvas-shortcut-hint ${visible ? 'visible' : ''}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span><kbd>{MOD}</kbd><kbd>K</kbd> commands</span>
      <span><kbd>{MOD}</kbd><kbd>/</kbd> search</span>
      <span><kbd>?</kbd> help</span>
    </div>
  );
}

export default CanvasPage;
