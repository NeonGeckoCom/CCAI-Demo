import React, { useState } from 'react';
import Icon from './Icon';
import { CHAT_INSIGHTS } from '../../data/canvasData';

// Inline **bold** markdown for insight bullets.
function bold(s) {
  if (!s) return '';
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function timeAgo(min) {
  if (min == null) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const InsightCard = ({ insight, pinned, onTogglePin }) => (
  <article className={`insight-card ${pinned ? 'pinned' : ''}`}>
    <header className="insight-head">
      <div className="ih-l">
        <div className="ih-icon"><Icon name={insight.icon || 'Sparkles'} size={16} /></div>
        <div>
          <h3>{insight.title}</h3>
          <div className="ih-meta">
            {insight.sources} source{insight.sources === 1 ? '' : 's'} · {timeAgo(insight.updatedMinutesAgo)}
          </div>
        </div>
      </div>
      <button className="ih-pin" onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin'}>
        <Icon name={pinned ? 'Pin' : 'PinOff'} size={14} />
      </button>
    </header>

    <div className="insight-confidence">
      <span>Confidence</span>
      <div className="bar"><span style={{ width: `${insight.confidence}%` }} /></div>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{insight.confidence}%</span>
    </div>

    <p className="insight-summary">{insight.summary}</p>

    <ul className="insight-bullets">
      {insight.bullets.map((b, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={i} dangerouslySetInnerHTML={{ __html: bold(b) }} />
      ))}
    </ul>

    <footer className="insight-foot">
      <span>{insight.sources} sources</span>
      <div className="if-actions">
        <button><Icon name="MessageCircle" size={11} /> Chat about this</button>
        <button><Icon name="Quote" size={11} /> Quotes</button>
      </div>
    </footer>
  </article>
);

const InsightsView = ({ onRefresh }) => {
  const [pinnedSet, setPinnedSet] = useState(
    () => new Set(CHAT_INSIGHTS.filter((i) => i.pinned).map((i) => i.id))
  );

  const togglePin = (id) => {
    setPinnedSet((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const sorted = [...CHAT_INSIGHTS].sort((a, b) => {
    const ap = pinnedSet.has(a.id) ? 1 : 0;
    const bp = pinnedSet.has(b.id) ? 1 : 0;
    return bp - ap;
  });

  return (
    <>
      <div className="workspace-toolbar">
        <div className="wt-l">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{CHAT_INSIGHTS.length}</strong> insights · synthesized from 28 chat sessions
          </div>
        </div>
        <div className="wt-r">
          <button className="btn ghost"><Icon name="Filter" size={14} /> <span>Filter</span></button>
          <button className="btn" onClick={onRefresh}><Icon name="RefreshCw" size={14} /> <span>Refresh</span></button>
        </div>
      </div>

      <div className="insights-grid">
        {sorted.map((ins) => (
          <InsightCard
            key={ins.id}
            insight={ins}
            pinned={pinnedSet.has(ins.id)}
            onTogglePin={() => togglePin(ins.id)}
          />
        ))}
      </div>
    </>
  );
};

export default InsightsView;
