import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppConfigProvider } from './contexts/AppConfigContext';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import AuthPage from './pages/AuthPage';
import CanvasPageV2 from './pages/CanvasPageV2';
import SettingsPage from './pages/SettingsPage';
import UserGuide from './components/UserGuide';
import AppHeader from './components/canvas/AppHeader';
import AdvisorModal from './components/canvas/AdvisorModal';
import WelcomeTour from './components/canvas/WelcomeTour';
import { ADVISORS, MOCK_USER, TOUR_KEY } from './data/canvasData';
import './styles/components.css';
import './styles/CanvasV2.css';

// Set REACT_APP_TESTING_ONBOARDING=true in your .env to force the onboarding
// tour to run on every page load. Leave unset in production — tour will only
// show once per user (localStorage).
export const TESTING_ONBOARDING = process.env.REACT_APP_TESTING_ONBOARDING === 'true';

// Build a display identity for the global AppHeader from the authenticated
// user, falling back to the prototype's demo identity for any missing fields.
function toHeaderUser(user) {
  const name = user?.name || user?.full_name || user?.email || MOCK_USER.name;
  const email = user?.email || MOCK_USER.email;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || MOCK_USER.initials;
  return { name, email, initials };
}

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [canvasTab, setCanvasTab] = useState('insights');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);

  // Global app state shared by Chat + Canvas + Settings
  const [activeAdvisorIds, setActiveAdvisorIds] = useState(() => new Set(ADVISORS.map((a) => a.id)));
  const [advisorModalOpen, setAdvisorModalOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Check for existing authentication on app start
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('user');

    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setAuthToken(token);
        setUser(parsedUser);
        setIsAuthenticated(true);
        setCurrentView('chat');
      } catch (error) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
      }
    }
  }, []);

  // Show the canvas welcome tour on the first canvas visit
  useEffect(() => {
    if (currentView !== 'canvas') return;
    try {
      if (TESTING_ONBOARDING || !localStorage.getItem(TOUR_KEY)) setTourOpen(true);
    } catch (e) { /* ignore */ }
  }, [currentView]);

  // Replay-tour requests from Settings
  useEffect(() => {
    const onReplay = () => setTourOpen(true);
    window.addEventListener('tour:replay', onReplay);
    return () => window.removeEventListener('tour:replay', onReplay);
  }, []);

  const onNav = (next, opts) => {
    if (next === 'canvas') {
      setCanvasTab(opts?.canvasTab || 'insights');
      setCurrentView('canvas');
      return;
    }
    setCurrentView(next);
  };

  const navigateToAuth = () => setCurrentView('auth');
  const navigateToCanvas = () => onNav('canvas');
  const navigateToChat = () => setCurrentView('chat');
  const navigateToHome = () => setCurrentView('home');

  const handleAuthSuccess = (userData, token) => {
    setUser(userData);
    setAuthToken(token);
    setIsAuthenticated(true);
    setCurrentView('chat');
  };

  const handleUserUpdate = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  const handleSignOut = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    setUser(null);
    setAuthToken(null);
    setIsAuthenticated(false);
    setCurrentView('home');
  };

  const closeTour = () => {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* ignore */ }
    setTourOpen(false);
  };

  const headerUser = toHeaderUser(user);
  const openAdvisors = () => setAdvisorModalOpen(true);

  return (
    <AppConfigProvider>
      <ThemeProvider>
        <div className="App">
          {currentView === 'home' && (
            <HomePage
              onNavigateToChat={isAuthenticated ? navigateToChat : navigateToAuth}
              isAuthenticated={isAuthenticated}
            />
          )}

          {currentView === 'auth' && (
            <AuthPage onAuthSuccess={handleAuthSuccess} />
          )}

          {currentView === 'canvas' && isAuthenticated && (
            <CanvasPageV2
              user={headerUser}
              authToken={authToken}
              canvasTab={canvasTab}
              onSetCanvasTab={setCanvasTab}
              onNav={onNav}
              activeAdvisorIds={activeAdvisorIds}
              onOpenAdvisors={openAdvisors}
              onSignOut={handleSignOut}
            />
          )}

          {currentView === 'settings' && isAuthenticated && (
            <SettingsPage
              user={headerUser}
              onNav={onNav}
              activeAdvisorIds={activeAdvisorIds}
              onOpenAdvisors={openAdvisors}
              onSignOut={handleSignOut}
            />
          )}

          {currentView === 'chat' && isAuthenticated && (
            <div className="chat-host">
              <AppHeader
                view="chat"
                onNav={onNav}
                activeAdvisorIds={activeAdvisorIds}
                onOpenAdvisors={openAdvisors}
                user={headerUser}
                onSignOut={handleSignOut}
              />
              <ChatPage
                user={user}
                authToken={authToken}
                onNavigateToHome={navigateToHome}
                onNavigateToCanvas={navigateToCanvas}
                onSignOut={handleSignOut}
                onUserUpdate={handleUserUpdate}
              />
            </div>
          )}

          {/* Global help center — listens for the 'open-user-guide' event */}
          <UserGuide />

          {/* Shared advisor manager + canvas welcome tour, available app-wide */}
          <AdvisorModal
            open={advisorModalOpen}
            onClose={() => setAdvisorModalOpen(false)}
            activeIds={activeAdvisorIds}
            onSave={(next) => { setActiveAdvisorIds(next); setAdvisorModalOpen(false); }}
          />
          <WelcomeTour open={tourOpen} onClose={closeTour} />
        </div>
      </ThemeProvider>
    </AppConfigProvider>
  );
}

export default App;
