import React, { useEffect, useRef } from 'react';
import { useAppConfig } from '../contexts/AppConfigContext';

/**
 * LemonSlice animated avatar widget. When `active` is true and LemonSlice
 * is configured, renders the LemonSlice web component. Falls back to the
 * children (static avatar) when inactive or not configured.
 */
const LemonSliceAvatar = ({ agentId, active, size = 40, children }) => {
  const { config } = useAppConfig();
  const scriptLoaded = useRef(false);
  const lsConfig = config?.lemonslice;
  const enabled = lsConfig?.enabled && (agentId || lsConfig?.default_agent_id);

  useEffect(() => {
    if (!enabled || scriptLoaded.current) return;
    const widgetUrl = lsConfig?.widget_url;
    if (!widgetUrl) return;

    const existing = document.querySelector(`script[src="${widgetUrl}"]`);
    if (!existing) {
      const script = document.createElement('script');
      script.src = widgetUrl;
      script.type = 'module';
      script.async = true;
      document.head.appendChild(script);
    }
    scriptLoaded.current = true;
  }, [enabled, lsConfig?.widget_url]);

  if (!enabled || !active) {
    return <>{children}</>;
  }

  const resolvedAgentId = agentId || lsConfig?.default_agent_id;

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* The lemon-slice-widget is a web component registered by the script */}
      <lemon-slice-widget
        agent-id={resolvedAgentId}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default LemonSliceAvatar;
