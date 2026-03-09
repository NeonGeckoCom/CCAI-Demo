import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  RefreshCw, 
  Download, 
  Calendar,
  TrendingUp,
  Target,
  BookOpen,
  Lightbulb,
  AlertTriangle,
  Users,
  BarChart3,
  Heart,
  ArrowLeft,
  Printer
} from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import '../styles/CanvasPage.css';

// Section icons mapping
const sectionIcons = {
  research_progress: TrendingUp,
  methodology: BarChart3,
  theoretical_framework: BookOpen,
  challenges_obstacles: AlertTriangle,
  next_steps: Target,
  writing_communication: FileText,
  career_development: Users,
  literature_review: BookOpen,
  data_analysis: BarChart3,
  motivation_mindset: Heart
};

const CanvasSection = ({ section, sectionKey, isExpanded, onToggle }) => {
  const IconComponent = sectionIcons[sectionKey] || Lightbulb;
  
  return (
    <div className="canvas-section">
      <div 
        className="section-header" 
        onClick={() => onToggle(sectionKey)}
      >
        <div className="section-header-content">
          <IconComponent className="section-icon" />
          <div className="section-titles">
            <h3 className="section-title">{section.title}</h3>
            <p className="section-description">{section.description}</p>
          </div>
        </div>
        <div className="section-meta">
          <span className="insight-count">{section.insights.length} insights</span>
          <div className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>
            ▼
          </div>
        </div>
      </div>
      
      {isExpanded && (
        <div className="section-content">
          {section.insights.length === 0 ? (
            <div className="empty-section">
              <Lightbulb className="empty-icon" />
              <p>No insights yet. Keep chatting with your advisors to build this section!</p>
            </div>
          ) : (
            <div className="insights-grid">
              {section.insights.map((insight, index) => (
                <div key={index} className="insight-card">
                  <div className="insight-content">
                    {insight.content}
                  </div>
                  <div className="insight-footer">
                    <span className="insight-source">{insight.source_persona}</span>
                    <span className="insight-confidence">
                      {Math.round(insight.confidence_score * 100)}% confidence
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CanvasPage = ({ user, authToken, onNavigateToChat, onSignOut }) => {
  const { config } = useAppConfig();
  const appName = config?.app_settings?.app_name || 'Advisory Panel';
  const [canvasData, setCanvasData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [stats, setStats] = useState({});
  const [isPrintView, setIsPrintView] = useState(false);
  const [isProcessingFirstTime, setIsProcessingFirstTime] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let pollInterval = null;
    
    const initializeCanvas = async () => {
      await fetchCanvas();
      await fetchStats();
      await triggerAutoUpdate();
      
      setTimeout(() => {
        checkForEmptyCanvasWithChats();
      }, 2000);
    };
    
    initializeCanvas();
    
    // Cleanup on unmount
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []);

  const fetchCanvas = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setCanvasData(data);
        
        // Auto-expand sections with insights
        const sectionsToExpand = {};
        Object.entries(data.sections).forEach(([key, section]) => {
          if (section.insights.length > 0) {
            sectionsToExpand[key] = true;
          }
        });
        setExpandedSections(sectionsToExpand);
      } else {
        console.error('Failed to fetch canvas');
      }
    } catch (error) {
      console.error('Error fetching canvas:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas/stats`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // Check if user has chats but empty canvas
  const checkForEmptyCanvasWithChats = async () => {
    try {
      const isEmpty = !canvasData || canvasData.total_insights === 0;
      
      if (isEmpty) {
        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/chat-sessions/count`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const { count } = await response.json();
          if (count > 0) {
            console.log(`User has ${count} chats but empty canvas. Triggering full refresh.`);
            await handleFullRefresh();
          }
        } else {
          console.error('Failed to fetch chat sessions count:', response.status);
          // Don't trigger refresh if count fails
          return;
        }
      }
    } catch (error) {
      console.error('Error checking for empty canvas with chats:', error);
      // Stop the polling if there's an error
      return;
    }
  };

  const triggerAutoUpdate = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas/auto-update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        
        // If this is a first-time canvas update, show appropriate message
        if (result.type === 'full_update') {
          console.log('First-time canvas detected. Processing all your chats...');
          
          // Show loading state
          setIsProcessingFirstTime(true);
          setIsUpdating(true);
          
          // Poll for updates every 10 seconds for up to 3 minutes
          let attempts = 0;
          const maxAttempts = 18; // 3 minutes / 10 seconds
          
          const pollForUpdates = setInterval(async () => {
            attempts++;
            
            try {
              await fetchCanvas();
              
              // If canvas now has insights, stop polling
              if (canvasData && canvasData.total_insights > 0) {
                clearInterval(pollForUpdates);
                setIsUpdating(false);
                setIsProcessingFirstTime(false);
                console.log('Canvas successfully populated with insights!');
              }
              
              // Stop polling after max attempts
              if (attempts >= maxAttempts) {
                clearInterval(pollForUpdates);
                setIsUpdating(false);
                setIsProcessingFirstTime(false);
              }
            } catch (error) {
              console.error('Error polling for updates:', error);
            }
          }, 10000);
        }
      }
    } catch (error) {
      console.error('Error triggering auto-update:', error);
    }
  };

  const handleRefreshCanvas = async () => {
    // Prevent multiple simultaneous refresh requests
    if (isRefreshing || isUpdating) {
      console.log('Refresh already in progress, ignoring duplicate request');
      return;
    }
    
    setIsRefreshing(true);
    setIsUpdating(true);
    
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas/refresh`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Full refresh initiated:', result);
        
        // Poll for updates
        setTimeout(() => {
          fetchCanvas();
          fetchStats();
        }, 5000);
        
        setTimeout(() => {
          setIsUpdating(false);
          setIsRefreshing(false);
        }, 10000);
      }
    } catch (error) {
      console.error('Error refreshing canvas:', error);
      setIsUpdating(false);
      setIsRefreshing(false);
    }
  };

  const handleFullRefresh = async () => {
    // Prevent multiple simultaneous refresh requests
    if (isRefreshing || isUpdating) {
      console.log('Refresh already in progress, ignoring duplicate request');
      return;
    }
    
    setIsRefreshing(true);
    setIsUpdating(true);
    
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas/refresh`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Full refresh initiated:', result);
        
        // Poll for updates
        setTimeout(() => {
          fetchCanvas();
          fetchStats();
        }, 5000);
        
        setTimeout(() => {
          setIsUpdating(false);
          setIsRefreshing(false);
        }, 10000);
      }
    } catch (error) {
      console.error('Error refreshing canvas:', error);
      setIsUpdating(false);
      setIsRefreshing(false);
    }
  };

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const handlePrint = () => {
    setIsPrintView(true);
    setTimeout(() => {
      window.print();
      setIsPrintView(false);
    }, 100);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="canvas-loading">
        <div className="loading-spinner"></div>
        <p>Loading your {appName} Canvas...</p>
      </div>
    );
  }

  // Sort sections by priority and insights count
  const sortedSections = Object.entries(canvasData?.sections || {})
    .sort(([, a], [, b]) => {
      // First by priority (lower number = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Then by insights count (more insights first)
      return b.insights.length - a.insights.length;
    });

  return (
    <div className={`canvas-page ${isPrintView ? 'print-view' : ''}`}>
      {/* Header */}
      <div className="canvas-header">
        <div className="header-left">
          <button 
            className="back-button"
            onClick={onNavigateToChat}
          >
            <ArrowLeft size={20} />
            Back to Chat
          </button>
          <div className="canvas-title-section">
            <h1 className="canvas-title">
              <FileText className="canvas-title-icon" />
              {appName} Canvas
            </h1>
            <p className="canvas-subtitle">Your research progress at a glance</p>
          </div>
        </div>
        
        <div className="header-actions">
          <div className="header-buttons">
            <button 
              onClick={handleRefreshCanvas}
              disabled={isRefreshing || isUpdating}
              className={`refresh-button ${(isRefreshing || isUpdating) ? 'disabled' : ''}`}
            >
              <RefreshCw className={`refresh-icon ${(isRefreshing || isUpdating) ? 'spinning' : ''}`} />
              {(isRefreshing || isUpdating) ? 'Refreshing...' : 'Refresh Canvas'}
            </button>
            
            <button 
              className="action-button print-button"
              onClick={handlePrint}
            >
              <Printer className="action-icon" />
              Print
            </button>
          </div>
          <a 
            href="https://neon.ai" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="canvas-powered-by"
          >
            <img src="/neon-logo.png" alt="" className="canvas-powered-by-logo" />
            Powered by Neon.ai
          </a>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="canvas-stats">
        <div className="stat-item">
          <span className="stat-number">{canvasData?.total_insights || 0}</span>
          <span className="stat-label">Total Insights</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">
            {Object.keys(canvasData?.sections || {}).filter(key => 
              canvasData.sections[key].insights.length > 0
            ).length}
          </span>
          <span className="stat-label">Active Sections</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">
            {formatDate(canvasData?.last_updated)}
          </span>
          <span className="stat-label">Last Updated</span>
        </div>
      </div>

      {/* Canvas Content */}
      <div className="canvas-content">
        {sortedSections.length === 0 ? (
          <div className="empty-canvas">
            <FileText className="empty-canvas-icon" />
            <h2>Your Canvas is Empty</h2>
            {isUpdating || isProcessingFirstTime ? (
              <div>
                <p>
                  {isProcessingFirstTime 
                    ? 'Processing your chat history to populate insights...' 
                    : 'Updating canvas with latest insights...'
                  }
                </p>
                <div className="loading-spinner">
                  <RefreshCw className="spinning" />
                </div>
                <p className="processing-note">
                  This may take a few minutes for extensive chat history.
                </p>
              </div>
            ) : (
              <div>
                <p>Start chatting with your AI advisors to populate your {appName} Canvas with insights!</p>
                <div className="empty-canvas-actions">
                  <button 
                    className="start-chatting-button"
                    onClick={onNavigateToChat}
                  >
                    Start Chatting
                  </button>
                  <button 
                    className="refresh-button secondary"
                    onClick={handleFullRefresh}
                  >
                    <RefreshCw className="action-icon" />
                    Process Existing Chats
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="sections-container">
            {sortedSections.map(([sectionKey, section]) => (
              <CanvasSection
                key={sectionKey}
                section={section}
                sectionKey={sectionKey}
                isExpanded={expandedSections[sectionKey]}
                onToggle={toggleSection}
              />
            ))}
          </div>
        )}
      </div>

      {/* Copyright Footer */}
      <footer className="canvas-copyright-footer">
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
      </footer>

      {/* Print Footer */}
      {isPrintView && (
        <div className="print-footer">
          <p>Generated by {appName} - {new Date().toLocaleDateString()}</p>
          <p>Student: {user?.email} | Total Insights: {canvasData?.total_insights || 0}</p>
        </div>
      )}
    </div>
  );
};

export default CanvasPage;