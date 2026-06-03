import React, { createContext, useContext, useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { ADVISORS } from '../data/canvasData';

const AppConfigContext = createContext(null);

const ADVISOR_PREFS_URL = `${process.env.REACT_APP_API_URL}/api/me/advisor-preferences`;

// The frontend tracks disabled advisors as an object keyed by id
// ({ critic: true }) for fast lookups; the backend speaks a flat string[].
// These two helpers translate between the shapes. A null/undefined array
// from the backend means "no preferences set" → nothing disabled.
const disabledObjToArray = (obj) =>
  Object.keys(obj || {}).filter((id) => obj[id]);
const disabledArrayToObj = (arr) =>
  Array.isArray(arr)
    ? arr.reduce((acc, id) => { acc[id] = true; return acc; }, {})
    : {};

const getAuthToken = () => {
  try { return localStorage.getItem('authToken'); } catch { return null; }
};

// Built-in fallback used when the backend `/api/config` endpoint is unreachable
// (e.g. running the front end on mock data with no backend). Lets the whole app
// — including the PhD Canvas — render instead of hard-failing on a blank screen.
const FALLBACK_PERSONAS = ADVISORS.map((a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  summary: a.summary,
  color: a.color,
  bg_color: a.bg,
  image: `icon://${a.icon}`,
}));

// Mirrors the public-facing shape of phd_config.yaml (what /api/config serves).
const FALLBACK_CONFIG = {
  app: {
    title: 'PhD Advisory Panel',
    subtitle: 'AI-Powered Academic Guidance',
    primary_color: '#6366F1',
    footer_text: '© 2025 University of Colorado Boulder. All rights reserved.',
  },
  app_settings: { app_name: 'PhD Advisory Panel' },
  homepage: {
    headline_prefix: 'Get Guidance from',
    headline_highlight: 'Advisor Personas',
    description:
      'Receive diverse perspectives on your PhD journey from our specialized AI advisors, each bringing unique insights to help you succeed.',
    features_title: 'Why Choose Our Advisory Panel?',
    features: [
      { title: 'Multiple Perspectives', description: 'Get varied viewpoints from different advisory styles', icon: 'Users' },
      { title: 'AI-Powered Insights', description: 'Leverage advanced AI for comprehensive guidance', icon: 'Brain' },
      { title: 'Focused Advice', description: 'Receive targeted recommendations for your specific needs', icon: 'Target' },
    ],
  },
  login: {
    subtitle: 'Sign in to continue your PhD research journey',
    signup_subtitle: 'Create your account to get personalized PhD guidance from expert advisors',
    academic_stages: [
      { value: '', label: 'Select your stage' },
      { value: 'prospective', label: 'Prospective PhD Student' },
      { value: 'first-year', label: 'First Year PhD' },
      { value: 'coursework', label: 'Coursework Phase' },
      { value: 'qualifying', label: 'Qualifying Exams' },
      { value: 'dissertation', label: 'Dissertation Phase' },
      { value: 'writing', label: 'Writing & Defense' },
      { value: 'postdoc', label: 'Postdoc' },
      { value: 'faculty', label: 'Faculty/Researcher' },
    ],
  },
  chat_page: {
    placeholder: 'Ask your advisors anything about your PhD journey...',
    examples: [
      { title: 'Orientation & Guidance', icon: 'BookOpen', color: '#3B82F6', bg_color: '#EFF6FF', suggestions: ['How do I choose a research topic that\'s interesting and doable?', 'Meeting and Presentation Prep', 'What should I be doing my first semester?'] },
      { title: 'Research Design & Academic Skills', icon: 'FlaskConical', color: '#8B5CF6', bg_color: '#F3E8FF', suggestions: ['Should I use qualitative, quantitative, or mixed methods for my research?', 'Is my research question too broad?', 'How do I defend a non-traditional methodology to my committee?'] },
      { title: 'Writing & Communication', icon: 'PenTool', color: '#10B981', bg_color: '#ECFDF5', suggestions: ['What\'s the right tone for an introduction? Persuasive, cautious, or bold?', 'How should I respond when reviewers give conflicting feedback?', 'Should I prioritize journal articles or dissertation chapters when I write?'] },
      { title: 'Mental Health & Hidden Curriculum', icon: 'Heart', color: '#F59E0B', bg_color: '#FFFBEB', suggestions: ['How do I cope when I feel behind compared to others in my cohort?', 'Should I speak up about unclear expectations or just try to figure it out quietly?', 'What are the unspoken expectations no one tells you about?'] },
    ],
  },
  onboarding: {
    features: [
      { title: 'Get advice from specialized AI advisors', icon: 'GraduationCap' },
      { title: 'Save and revisit every conversation', icon: 'MessageCircle' },
      { title: 'Upload PDFs for context-aware answers', icon: 'Paperclip' },
      { title: 'Track your PhD progress on a structured canvas', icon: 'BarChart3' },
    ],
    tour_title: 'PhD Progress Canvas',
    tour_body: 'A dashboard view of your PhD journey — research progress, methodology, next steps, all in one place.',
  },
  personas: { items: FALLBACK_PERSONAS },
};

/**
 * Resolve a Lucide icon name string (e.g. "BookOpen") to the actual React
 * component.  Falls back to HelpCircle if the name isn't found.
 */
const resolveIcon = (iconName) => {
  if (!iconName) return LucideIcons.User;
  return LucideIcons[iconName] || LucideIcons.User;
};

/**
 * Build the advisors lookup object (keyed by persona id) from the config
 * personas array, mirroring the shape that components already expect.
 */
const buildAdvisors = (personaItems, overrides = {}) => {
  if (!personaItems || !Array.isArray(personaItems)) return {};
  const advisors = {};
  for (const p of personaItems) {
    const image = p.image || '';
    const isIcon = image.startsWith('icon://');
    const rawImageUrl = isIcon ? null : image || null;
    const configImageUrl = rawImageUrl && rawImageUrl.startsWith('/')
      ? `${process.env.REACT_APP_API_URL}${rawImageUrl}`
      : rawImageUrl;

    // Override takes precedence if the advisor has one set.
    // Override = truthy URL → use it. Override = '' → force default icon.
    // No override key → fall back to config image.
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, p.id);
    const overrideValue = overrides[p.id];
    const avatarUrl = hasOverride ? (overrideValue || null) : configImageUrl;

    advisors[p.id] = {
      name: p.name,
      role: p.role || '',
      description: p.summary || '',
      color: p.color || '#6B7280',
      bgColor: p.bg_color || '#F3F4F6',
      darkColor: p.dark_color || '#9CA3AF',
      darkBgColor: p.dark_bg_color || '#374151',
      icon: resolveIcon(isIcon ? image.replace('icon://', '') : null),
      avatarUrl,
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
  if (!advisor) {
    return isDark
      ? { color: '#9CA3AF', bgColor: '#374151', textColor: '#F9FAFB' }
      : { color: '#6B7280', bgColor: '#F3F4F6', textColor: '#111827' };
  }
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
  const [personaItems, setPersonaItems] = useState([]);
  const [advisors, setAdvisors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [avatarOverrides, setAvatarOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('advisorAvatarOverrides') || '{}'); }
    catch { return {}; }
  });
  const [myCustomAvatars, setMyCustomAvatars] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myCustomAvatars') || '[]'); }
    catch { return []; }
  });
  // Per-user enable/disable for each advisor. Missing key = enabled by default
  // so new advisors light up automatically when added on the backend.
  const [disabledAdvisors, setDisabledAdvisors] = useState(() => {
    try { return JSON.parse(localStorage.getItem('disabledAdvisors') || '{}'); }
    catch { return {}; }
  });
  // Advisor ids the backend considers selectable (system-level allow list).
  const [availableAdvisors, setAvailableAdvisors] = useState([]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/config`);
        if (!response.ok) throw new Error(`Config fetch failed: ${response.status}`);
        const data = await response.json();
        setConfig(data);
        setPersonaItems(data.personas?.items || []);
      } catch (err) {
        // No backend (or it returned non-JSON like an index.html fallback).
        // Degrade gracefully to built-in defaults so the app still renders.
        console.warn('App config fetch failed; using built-in defaults (no backend?).', err);
        setConfig(FALLBACK_CONFIG);
        setPersonaItems(FALLBACK_CONFIG.personas.items);
        setError(null);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    setAdvisors(buildAdvisors(personaItems, avatarOverrides));
  }, [personaItems, avatarOverrides]);

  const setAdvisorAvatar = (advisorId, url) => {
    const next = { ...avatarOverrides, [advisorId]: url };
    setAvatarOverrides(next);
    localStorage.setItem('advisorAvatarOverrides', JSON.stringify(next));
  };

  const addMyAvatar = (url) => {
    if (myCustomAvatars.includes(url)) return;
    const next = [url, ...myCustomAvatars];
    setMyCustomAvatars(next);
    localStorage.setItem('myCustomAvatars', JSON.stringify(next));
  };

  // Advisor enable/disable. Disabled advisors are filtered out of orchestrator
  // calls (server-side, per user) and visually dimmed in the UI.
  const isAdvisorEnabled = (id) => !disabledAdvisors[id];

  // Apply a disabled map locally + cache it. localStorage keeps the last known
  // state so the UI is correct instantly on reload before the backend answers.
  const applyDisabled = (obj) => {
    setDisabledAdvisors(obj);
    try { localStorage.setItem('disabledAdvisors', JSON.stringify(obj)); }
    catch { /* storage full / unavailable — non-fatal */ }
  };

  // Reconcile local state with whatever the backend returns (it is the source
  // of truth; it also distinguishes "no prefs / null" from an explicit list).
  const applyServerResponse = (data) => {
    applyDisabled(disabledArrayToObj(data?.disabled_advisors));
    if (Array.isArray(data?.available_advisors)) {
      setAvailableAdvisors(data.available_advisors);
    }
  };

  // Pull the authenticated user's preferences from the backend.
  const hydrateAdvisorPreferences = async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(ADVISOR_PREFS_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('Failed to load advisor preferences:', res.status);
        return;
      }
      applyServerResponse(await res.json());
    } catch (err) {
      // Offline / network error — keep the cached localStorage state.
      console.error('Failed to load advisor preferences:', err);
    }
  };

  // Persist the full disabled set to the backend. We send the whole array
  // (not a delta) so the PUT is idempotent and the server stays authoritative.
  const persistAdvisorPreferences = async (obj) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(ADVISOR_PREFS_URL, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ disabled_advisors: disabledObjToArray(obj) }),
      });
      if (!res.ok) {
        console.error('Failed to save advisor preferences:', res.status);
        return;
      }
      applyServerResponse(await res.json());
    } catch (err) {
      // Optimistic local state is already applied; surface the failure only.
      console.error('Failed to save advisor preferences:', err);
    }
  };

  const setAdvisorEnabled = (id, enabled) => {
    const next = { ...disabledAdvisors };
    if (enabled) delete next[id];
    else next[id] = true;
    applyDisabled(next);            // optimistic
    persistAdvisorPreferences(next); // sync (reconciles on response)
  };

  // Bulk enable/disable in one shot — a single state update and one PUT,
  // instead of N racing requests when toggling every advisor.
  const setAllAdvisorsEnabled = (enabled) => {
    const next = enabled
      ? {}
      : Object.keys(advisors || {}).reduce(
          (acc, id) => { acc[id] = true; return acc; }, {});
    applyDisabled(next);
    persistAdvisorPreferences(next);
  };

  // Load preferences once on mount when a session token is already present
  // (returning user). Fresh logins reconcile when the Settings modal opens.
  useEffect(() => {
    hydrateAdvisorPreferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const allPersonas = advisors;
  const getAllPersonaColors = getAdvisorColors;

  const value = {
    config,
    advisors,
    allPersonas,
    getAdvisorColors,
    getAllPersonaColors,
    resolveIcon,
    loading,
    error,
    setAdvisorAvatar,
    addMyAvatar,
    myCustomAvatars,
    disabledAdvisors,
    availableAdvisors,
    isAdvisorEnabled,
    setAdvisorEnabled,
    setAllAdvisorsEnabled,
    hydrateAdvisorPreferences,
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
