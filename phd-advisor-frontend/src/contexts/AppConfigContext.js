import React, { createContext, useContext, useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';

const AppConfigContext = createContext(null);

/**
 * Resolve a Lucide icon name string (e.g. "BookOpen") to the actual React
 * component.  Falls back to HelpCircle if the name isn't found.
 */
const resolveIcon = (iconName) => {
  if (!iconName) return LucideIcons.HelpCircle;
  return LucideIcons[iconName] || LucideIcons.HelpCircle;
};

/**
 * Build the advisors lookup object (keyed by persona id) from the config
 * personas array, mirroring the shape that components already expect.
 */
const buildAdvisors = (personaItems) => {
  if (!personaItems || !Array.isArray(personaItems)) return {};
  const advisors = {};
  for (const p of personaItems) {
    advisors[p.id] = {
      name: p.name,
      role: p.role || '',
      description: p.summary || '',
      color: p.color || '#6B7280',
      bgColor: p.bg_color || '#F3F4F6',
      darkColor: p.dark_color || '#9CA3AF',
      darkBgColor: p.dark_bg_color || '#374151',
      icon: resolveIcon(p.icon),
    };
  }
  return advisors;
};

/**
 * Derive theme-appropriate colors for a given advisor, identical to the
 * previous `getAdvisorColors` helper.
 */
const buildGetAdvisorColors = (advisors) => (advisorId, isDark = false) => {
  const advisor = advisors[advisorId];
  if (!advisor) return { color: '#6B7280', bgColor: '#F3F4F6' };
  return {
    color: isDark ? advisor.darkColor : advisor.color,
    bgColor: isDark ? advisor.darkBgColor : advisor.bgColor,
    textColor: isDark ? '#F9FAFB' : advisor.color,
  };
};

export const useAppConfig = () => {
  const ctx = useContext(AppConfigContext);
  if (!ctx) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return ctx;
};

export const AppConfigProvider = ({ children }) => {
  const [config, setConfig] = useState(null);
  const [advisors, setAdvisors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/config`
        );
        if (!response.ok) throw new Error(`Config fetch failed: ${response.status}`);
        const data = await response.json();
        setConfig(data);
        const builtAdvisors = buildAdvisors(data.personas?.items);
        setAdvisors(builtAdvisors);
      } catch (err) {
        console.error('Failed to load app config:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  // Inject the primary colour as a CSS custom property on <html> so it is
  // available everywhere without prop-drilling.
  useEffect(() => {
    if (config?.app?.primary_color) {
      document.documentElement.style.setProperty(
        '--accent-primary',
        config.app.primary_color
      );
    }
    // Also update the <title> tag dynamically
    if (config?.app?.title) {
      document.title = config.app.title;
    }
  }, [config]);

  const getAdvisorColors = buildGetAdvisorColors(advisors);

  const value = {
    config,          // raw config object from /api/config
    advisors,        // { methodologist: { name, role, icon, color, ... }, ... }
    getAdvisorColors,
    resolveIcon,
    loading,
    error,
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#6B7280',
      }}>
        Loading configuration…
      </div>
    );
  }

  if (error && !config) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#EF4444',
        gap: '8px',
      }}>
        <p>Failed to load application configuration.</p>
        <p style={{ fontSize: '14px', color: '#6B7280' }}>{error}</p>
      </div>
    );
  }

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
};

export default AppConfigContext;
