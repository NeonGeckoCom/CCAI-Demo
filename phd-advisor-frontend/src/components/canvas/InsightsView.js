import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

const API_URL = process.env.REACT_APP_API_URL || '';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 36;

const SECTION_ICONS = {
  research_progress: 'TrendingUp',
  methodology: 'FlaskConical',
  theoretical_framework: 'Brain',
  challenges_obstacles: 'AlertTriangle',
  next_steps: 'ArrowRight',
  writing_communication: 'PenTool',
  career_development: 'BriefcaseBusiness',
  literature_review: 'BookOpen',
  data_analysis: 'BarChart3',
  motivation_mindset: 'Heart',
  general_notes: 'StickyNote',
};

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function confidencePercent(score) {
  if (score == null || Number.isNaN(Number(score))) return 0;
  const value = Number(score);
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function averageConfidence(insights) {
  if (!insights.length) return 0;
  const total = insights.reduce((sum, insight) => sum + confidencePercent(insight.confidence_score), 0);
  return Math.round(total / insights.length);
}

function timeAgoFromDate(value) {
  if (!value) return 'not synced yet';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'not synced yet';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function renderBoldText(text) {
  const parts = String(text || '').split(/(\*\*.+?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function sourceKey(insight, index) {
  return insight.source_chat_session && insight.source_message_id
    ? `${insight.source_chat_session}:${insight.source_message_id}`
    : `${insight.source_persona || 'source'}:${index}`;
}

function normalizeSections(canvas) {
  return Object.entries(canvas?.sections || {})
    .map(([key, section]) => {
      const rawInsights = Array.isArray(section?.insights)
        ? section.insights
        : Object.values(section?.insights || {});
      const insights = rawInsights.filter(Boolean).sort((a, b) => (
        confidencePercent(b.confidence_score) - confidencePercent(a.confidence_score)
        || new Date(b.extracted_at || 0) - new Date(a.extracted_at || 0)
      ));
      return {
        key,
        title: section?.title || key.replace(/_/g, ' '),
        description: section?.description || 'Extracted guidance from advisor conversations.',
        priority: section?.priority || 5,
        updatedAt: section?.updated_at,
        insights,
        confidence: averageConfidence(insights),
        sourceCount: new Set(insights.map(sourceKey)).size,
        personas: [...new Set(insights.map((insight) => insight.source_persona).filter(Boolean))],
        icon: SECTION_ICONS[key] || 'Sparkles',
      };
    })
    .filter((section) => section.insights.length > 0);
}

const InsightSectionCard = ({ section, pinned, onTogglePin }) => {
  const visibleInsights = section.insights.slice(0, 5);
  const hiddenCount = Math.max(0, section.insights.length - visibleInsights.length);
  const personaLabel = section.personas.length
    ? section.personas.slice(0, 3).join(', ')
    : 'Advisor sources';

  return (
    <article className={`insight-card ${pinned ? 'pinned' : ''}`}>
      <header className="insight-head">
        <div className="ih-l">
          <div className="ih-icon"><Icon name={section.icon} size={16} /></div>
          <div>
            <h3>{section.title}</h3>
            <div className="ih-meta">
              {plural(section.insights.length, 'insight')} - updated {timeAgoFromDate(section.updatedAt)}
            </div>
          </div>
        </div>
        <button className="ih-pin" onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin'}>
          <Icon name={pinned ? 'Pin' : 'PinOff'} size={14} />
        </button>
      </header>

      <div className="insight-confidence">
        <span>Confidence</span>
        <div className="bar"><span style={{ width: `${section.confidence}%` }} /></div>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{section.confidence}%</span>
      </div>

      <p className="insight-summary">{section.description}</p>

      <ul className="insight-bullets">
        {visibleInsights.map((insight, index) => (
          <li key={sourceKey(insight, index)}>{renderBoldText(insight.content)}</li>
        ))}
        {hiddenCount > 0 && <li>{hiddenCount} more saved in this section.</li>}
      </ul>

      <footer className="insight-foot">
        <span>{plural(section.sourceCount, 'source')}</span>
        <div className="if-actions">
          <button title={personaLabel}>
            <Icon name="Users" size={11} /> {personaLabel}
          </button>
        </div>
      </footer>
    </article>
  );
};

const InsightsView = ({ authToken, onStatus }) => {
  const token = authToken || localStorage.getItem('authToken');
  const [canvas, setCanvas] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pinnedSet, setPinnedSet] = useState(() => new Set());
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const setMessage = useCallback((message) => {
    setStatus(message || '');
    if (message && onStatus) onStatus(message);
  }, [onStatus]);

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchCanvas = useCallback(async ({ silent = false } = {}) => {
    if (!API_URL) throw new Error('REACT_APP_API_URL is not configured.');
    if (!token) throw new Error('Sign in to load your PhD Canvas.');

    if (!silent) setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/phd-canvas`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Could not load PhD Canvas (${response.status}).`);
      }

      const data = await response.json();
      if (mountedRef.current) {
        setCanvas(data);
        setError('');
      }
      return data;
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, [token]);

  const startPolling = useCallback((message) => {
    clearPolling();
    setIsUpdating(true);
    setMessage(message || 'Canvas update started.');

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        await fetchCanvas({ silent: true });
      } catch (err) {
        if (mountedRef.current) setError(err.message);
        clearPolling();
        if (mountedRef.current) setIsUpdating(false);
        return;
      }

      if (attempts >= MAX_POLL_ATTEMPTS) {
        clearPolling();
        if (mountedRef.current) {
          setIsUpdating(false);
          setMessage('Canvas sync finished.');
        }
      }
    }, POLL_INTERVAL_MS);
  }, [clearPolling, fetchCanvas, setMessage]);

  const triggerAutoUpdate = useCallback(async () => {
    if (!API_URL || !token) return;

    const response = await fetch(`${API_URL}/api/phd-canvas/auto-update`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Could not check for canvas updates (${response.status}).`);
    }

    const result = await response.json();
    if (result.status === 'processing' || result.status === 'updating') {
      startPolling(result.message);
    } else {
      setMessage(result.message || 'Canvas is up to date.');
    }
  }, [startPolling, setMessage, token]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        await fetchCanvas();
        if (!cancelled) await triggerAutoUpdate();
      } catch (err) {
        if (!cancelled && mountedRef.current) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [fetchCanvas, triggerAutoUpdate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPolling();
    };
  }, [clearPolling]);

  const handleRefresh = async () => {
    if (isLoading || isUpdating) return;
    if (!API_URL) {
      setError('REACT_APP_API_URL is not configured.');
      return;
    }
    if (!token) {
      setError('Sign in to refresh your PhD Canvas.');
      return;
    }

    setError('');
    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/api/phd-canvas/refresh`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Could not refresh PhD Canvas (${response.status}).`);
      }

      const result = await response.json();
      startPolling(result.message || 'Full canvas refresh started.');
    } catch (err) {
      setError(err.message);
      setIsUpdating(false);
    }
  };

  const handleReload = async () => {
    try {
      await fetchCanvas();
      setMessage('Canvas reloaded.');
    } catch (err) {
      setError(err.message);
    }
  };

  const sections = useMemo(() => normalizeSections(canvas), [canvas]);
  const sortedSections = useMemo(() => [...sections].sort((a, b) => {
    const ap = pinnedSet.has(a.key) ? 1 : 0;
    const bp = pinnedSet.has(b.key) ? 1 : 0;
    return bp - ap
      || a.priority - b.priority
      || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  }), [pinnedSet, sections]);

  const togglePin = (key) => {
    setPinnedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading && !canvas) {
    return (
      <div className="skills-empty large">
        <span><Icon name="RefreshCw" size={16} className="spin" /> Loading canvas insights...</span>
      </div>
    );
  }

  return (
    <>
      <div className="workspace-toolbar">
        <div className="wt-l">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{canvas?.total_insights || 0}</strong>
            {' '}insights across{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{sections.length}</strong>
            {' '}sections
            {canvas?.last_updated && <> - synced {timeAgoFromDate(canvas.last_updated)}</>}
          </div>
        </div>
        <div className="wt-r">
          <button className="btn ghost" onClick={handleReload} disabled={isLoading || isUpdating}>
            <Icon name="RotateCcw" size={14} /> <span>Reload</span>
          </button>
          <button className="btn" onClick={handleRefresh} disabled={isLoading || isUpdating}>
            <Icon name="RefreshCw" size={14} className={isUpdating ? 'spin' : ''} />
            <span>{isUpdating ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {(error || status) && (
        <div className={`skills-message ${error ? 'error' : ''}`} style={{ marginBottom: 14 }}>
          {error || status}
        </div>
      )}

      {sortedSections.length === 0 ? (
        <div className="skills-empty large">
          <div style={{ textAlign: 'center' }}>
            <Icon name="Sparkles" size={22} />
            <div style={{ marginTop: 8, color: 'var(--text-primary)', fontWeight: 700 }}>No canvas insights yet.</div>
            <div style={{ marginTop: 6 }}>Start or continue advisor chats, then refresh the canvas to synthesize guidance.</div>
            <button className="btn primary" onClick={handleRefresh} disabled={isUpdating} style={{ marginTop: 14 }}>
              <Icon name="RefreshCw" size={14} color="#fff" /> <span>Build canvas</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="insights-grid">
          {sortedSections.map((section) => (
            <InsightSectionCard
              key={section.key}
              section={section}
              pinned={pinnedSet.has(section.key)}
              onTogglePin={() => togglePin(section.key)}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default InsightsView;
