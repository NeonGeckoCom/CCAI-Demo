import React, { useEffect, useMemo } from 'react';
import { TourProvider, useTour } from '@reactour/tour';
import { Hand, GraduationCap, Plus, MessageCircle, Paperclip, BarChart3 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppConfig } from '../contexts/AppConfigContext';
import { TESTING_ONBOARDING } from '../App';
import '../styles/OnboardingTour.css';

const STORAGE_KEY = 'hasSeenOnboardingTour';

// Fallbacks used when config.onboarding.* fields aren't provided by the backend.
const DEFAULT_FEATURES = [
  { Icon: GraduationCap, label: 'Get advice from specialized AI advisors' },
  { Icon: MessageCircle, label: 'Save and revisit every conversation' },
  { Icon: Paperclip, label: 'Upload PDFs and documents for context-aware answers' },
  { Icon: BarChart3, label: 'Track your progress on a structured canvas' },
];
const DEFAULT_CANVAS_STEP = {
  title: 'PhD Progress Canvas',
  body: 'A dashboard view of your PhD journey — research progress, methodology, next steps, all in one place.',
};

const buildAdvisorBody = (advisors) => {
  const names = Object.values(advisors || {}).map((a) => a.name).filter(Boolean);
  if (names.length === 0) {
    return "AI personas are ready to help. Click here anytime to see who's available.";
  }
  const firstThree = names.slice(0, 3).join(', ');
  return `${names.length} AI personas are ready to help — ${firstThree}, and more. Click here anytime to see who's available.`;
};

const buildFeatures = (config, resolveIcon) => {
  const fromConfig = config?.onboarding?.features;
  if (!Array.isArray(fromConfig) || fromConfig.length === 0) return DEFAULT_FEATURES;
  return fromConfig.map((f) => ({
    Icon: f.icon ? resolveIcon(f.icon) : GraduationCap,
    label: f.label || f.description || f.title || '',
  }));
};

// Theme-resolved colors that match the rest of the app exactly
const palette = (isDark) => ({
  bg: isDark ? '#1F2937' : '#FFFFFF',
  bgSubtle: isDark ? '#111827' : '#F9FAFB',
  text: isDark ? '#F9FAFB' : '#111827',
  textMuted: isDark ? '#D1D5DB' : '#6B7280',
  textDim: isDark ? '#9CA3AF' : '#9CA3AF',
  border: isDark ? '#374151' : '#E5E7EB',
  accent: '#2663EB',
  accentGrad: '#2663EB',
  accentShadow: 'rgba(38, 99, 235, 0.45)',
});

// --- Step content -------------------------------------------------------
const titleStyle = (c) => ({
  margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.2,
  color: c.text, WebkitTextFillColor: c.text, letterSpacing: '-0.02em',
});
const bodyStyle = (c) => ({
  margin: 0, fontSize: 15.5, lineHeight: 1.55,
  color: c.textMuted, WebkitTextFillColor: c.textMuted,
});

const StepBody = ({ title, body, Icon, c }) => (
  <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: c.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        boxShadow: `0 6px 16px -4px ${c.accentShadow}`,
      }}>
        <Icon size={24} color="#fff" strokeWidth={2.2} />
      </div>
      <div style={titleStyle(c)}>{title}</div>
    </div>
    <div style={bodyStyle(c)}>{body}</div>
  </div>
);

const WelcomeBody = ({ c, title, subtitle, features }) => {
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', textAlign: 'center', padding: '4px 8px' }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
        background: c.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 12px 32px -8px ${c.accentShadow}`,
      }}>
        <Hand size={36} color="#fff" strokeWidth={2.2} />
      </div>
      <div style={{
        margin: '0 0 12px', fontSize: 30, fontWeight: 800, lineHeight: 1.15,
        color: c.text, WebkitTextFillColor: c.text, letterSpacing: '-0.025em',
      }}>
        Welcome to your<br />{title}
      </div>
      <div style={{
        margin: '0 0 22px', fontSize: 16, lineHeight: 1.55,
        color: c.textMuted, WebkitTextFillColor: c.textMuted,
      }}>
        {subtitle}
      </div>
      <div style={{
        display: 'grid', gap: 14, textAlign: 'left',
        background: c.bgSubtle,
        border: `1px solid ${c.border}`,
        borderRadius: 14, padding: '18px 20px',
      }}>
        {features.map(({ Icon, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: c.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon size={18} color="#fff" strokeWidth={2.2} />
            </div>
            <span style={{ fontSize: 15, color: c.text, lineHeight: 1.4 }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const buildSteps = (c, data) => [
  {
    selector: 'body',
    position: 'center',
    content: <WelcomeBody c={c} title={data.title} subtitle={data.subtitle} features={data.features} />,
    styles: {
      maskArea: (base) => ({ ...base, x: -10000, y: -10000, width: 0, height: 0 }),
      popover: (base) => ({
        ...base,
        maxWidth: 540,
        minWidth: 460,
        padding: '32px 30px 24px',
        borderRadius: 22,
        background: c.bg,
        backgroundColor: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        boxShadow: '0 30px 80px -10px rgba(0,0,0,0.5)',
      }),
    },
  },
  {
    selector: '.advisor-status-button',
    content: <StepBody c={c} Icon={GraduationCap} title="Meet your advisors" body={data.advisorBody} />,
  },
  {
    selector: '.new-chat-button',
    content: <StepBody c={c} Icon={Plus} title="Start a new chat" body="Begin a fresh conversation. Each chat is saved automatically so you can return to it later." />,
  },
  {
    selector: '.sessions-list',
    content: <StepBody c={c} Icon={MessageCircle} title="Your past chats" body="All your previous conversations live here. Click any session to pick up where you left off." />,
  },
  {
    selector: '.enhanced-chat-input-container',
    content: <StepBody c={c} Icon={Paperclip} title="Ask anything" body="Type a question, attach a PDF or document for context, and your advisors will respond with diverse perspectives." />,
  },
  {
    selector: '.sidebar-canvas-btn',
    content: <StepBody c={c} Icon={BarChart3} title={data.canvas.title} body={data.canvas.body} />,
  },
];

// --- Custom Buttons -----------------------------------------------------
const makeButtons = (c) => {
  const ghostBtn = {
    background: 'transparent', color: c.textMuted,
    border: `1px solid ${c.border}`, padding: '10px 18px',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  };
  const primaryBtn = {
    background: c.accent, color: '#fff',
    border: 'none', padding: '10px 22px',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    boxShadow: `0 4px 14px -4px ${c.accentShadow}`,
  };

  const PrevButton = ({ currentStep, setCurrentStep }) => {
    if (currentStep === 0) return <span />;
    return (
      <button style={ghostBtn} onClick={() => setCurrentStep(currentStep - 1)}>Back</button>
    );
  };

  const NextButton = ({ currentStep, stepsLength, setCurrentStep, setIsOpen }) => {
    const isFirst = currentStep === 0;
    const isLast = currentStep === stepsLength - 1;
    const label = isFirst ? 'Begin tour' : isLast ? 'Get started' : 'Next';
    const padded = isFirst ? { ...primaryBtn, padding: '12px 28px', fontSize: 15 } : primaryBtn;
    return (
      <button
        style={padded}
        onClick={() => (isLast ? setIsOpen(false) : setCurrentStep(currentStep + 1))}
      >
        {label}
      </button>
    );
  };

  const SkipButton = ({ onClick }) => (
    <button
      onClick={onClick}
      style={{
        position: 'absolute', top: 14, right: 16,
        background: 'transparent', border: 'none',
        color: c.textDim, fontSize: 13, fontWeight: 500,
        cursor: 'pointer', padding: '4px 8px', borderRadius: 6,
      }}
    >
      Skip tour
    </button>
  );

  return { PrevButton, NextButton, SkipButton };
};

// Auto-opens the tour, writes flag on close.
const TourLauncher = () => {
  const { setIsOpen, isOpen } = useTour();

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY) === 'true';
    if (TESTING_ONBOARDING || !seen) {
      const t = setTimeout(() => setIsOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [setIsOpen]);

  useEffect(() => {
    if (!isOpen) {
      if (sessionStorage.getItem('__tourStarted__')) {
        localStorage.setItem(STORAGE_KEY, 'true');
      }
    } else {
      sessionStorage.setItem('__tourStarted__', '1');
    }
  }, [isOpen]);

  return null;
};

const OnboardingTour = ({ children }) => {
  const { isDark } = useTheme();
  const { config, advisors, resolveIcon } = useAppConfig();
  const c = useMemo(() => palette(isDark), [isDark]);

  const stepData = useMemo(() => ({
    title: config?.app?.title || 'PhD Advisory Panel',
    subtitle: config?.app?.subtitle || 'AI-Powered Guidance',
    features: buildFeatures(config, resolveIcon),
    advisorBody: buildAdvisorBody(advisors),
    canvas: {
      title: config?.canvas?.tour_title || DEFAULT_CANVAS_STEP.title,
      body: config?.canvas?.tour_body || DEFAULT_CANVAS_STEP.body,
    },
  }), [config, advisors, resolveIcon]);

  const steps = useMemo(() => buildSteps(c, stepData), [c, stepData]);
  const { PrevButton, NextButton, SkipButton } = useMemo(() => makeButtons(c), [c]);

  return (
    <TourProvider
      steps={steps}
      showBadge={false}
      disableInteraction
      prevButton={PrevButton}
      nextButton={NextButton}
      components={{ Close: SkipButton }}
      padding={{ mask: 8, popover: [16, 12] }}
      styles={{
        popover: (base) => ({
          ...base,
          borderRadius: 18,
          padding: '28px 26px 22px',
          maxWidth: 440,
          minWidth: 360,
          background: c.bg,
          backgroundColor: c.bg,
          color: c.text,
          boxShadow: '0 30px 80px -10px rgba(0,0,0,0.5)',
          border: `1px solid ${c.border}`,
        }),
        maskWrapper: (base) => ({ ...base, color: 'rgba(0, 0, 0, 0.82)' }),
        maskArea: (base) => ({ ...base, rx: 14 }),
        controls: (base) => ({
          ...base,
          marginTop: 22,
          paddingTop: 18,
          borderTop: `1px solid ${c.border}`,
          alignItems: 'center',
          justifyContent: 'space-between',
        }),
        dot: (base, { current }) => ({
          ...base,
          width: current ? 24 : 8,
          height: 8,
          borderRadius: 999,
          background: current ? c.accent : c.border,
          transition: 'all 0.25s ease',
        }),
        navigation: (base) => ({ ...base, gap: 7 }),
      }}
    >
      <TourLauncher />
      {children}
    </TourProvider>
  );
};

export default OnboardingTour;
