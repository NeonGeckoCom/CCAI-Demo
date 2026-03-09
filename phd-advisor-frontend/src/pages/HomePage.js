import React from 'react';
import { MessageCircle, ArrowRight } from 'lucide-react';
import AdvisorCard from '../components/AdvisorCard';
import ThemeToggle from '../components/ThemeToggle';
import { useAppConfig } from '../contexts/AppConfigContext';

const HomePage = ({ onNavigateToChat, isAuthenticated }) => {
  const { config, advisors, resolveIcon } = useAppConfig();

  const UsersIcon = resolveIcon('Users');

  return (
    <div className="homepage">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo-container">
              <UsersIcon className="logo-icon" />
            </div>
            <div>
              <h1 className="logo-title">{config.app.title}</h1>
              <p className="logo-subtitle">{config.app.subtitle}</p>
            </div>
          </div>
          <div className="header-right">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="main">
        <div className="hero-section">
          <h2 className="hero-title">
            {config.homepage.headline_prefix}{' '}
            <span className="hero-highlight">{config.homepage.headline_highlight}</span>
          </h2>
          <p className="hero-subtitle">
            {config.homepage.description}
          </p>
          <button
            onClick={onNavigateToChat}
            className="cta-button"
          >
            <MessageCircle className="cta-icon" />
            <span>{isAuthenticated ? 'Continue Conversation' : 'Start Conversation'}</span>
            <ArrowRight className="cta-arrow" />
          </button>
        </div>

        {/* Advisors Grid */}
        <div className="advisors-grid">
          {Object.entries(advisors).map(([id, advisor]) => (
            <AdvisorCard key={id} advisor={advisor} advisorId={id} />
          ))}
        </div>

        {/* Features Section */}
        <div className="features-section">
          <h3 className="features-title">{config.homepage.features_title}</h3>
          <div className="features-grid">
            {(config.homepage.features || []).map((feature, index) => {
              const FeatureIcon = resolveIcon(feature.icon);
              return (
                <div key={index} className="feature-card">
                  <div className="feature-icon">
                    <FeatureIcon />
                  </div>
                  <h4 className="feature-title">{feature.title}</h4>
                  <p className="feature-description">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </main>
      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">
            Copyright{' '}
            <a href="https://neon.ai" target="_blank" rel="noopener noreferrer" className="footer-neon-link">
              <img src="/neon-logo.png" alt="" className="footer-neon-logo" />
              Neon.ai
            </a>
            , portions copyright University of Colorado Boulder. All rights reserved.{' '}
            <a href="https://www.neon.ai/contact" target="_blank" rel="noopener noreferrer" className="footer-patents-link">
              Patents and licensing.
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
