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
  Printer,
  Trash2,
  MessageCircle,
  ArrowRight
} from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import ConfirmDialog from '../components/ConfirmDialog';
import CopyrightNotice from '../components/CopyrightNotice';
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

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
          return;
        }
      }
    } catch (error) {
      console.error('Error checking for empty canvas with chats:', error);
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
        
        if (result.type === 'full_update') {
          console.log('First-time canvas detected. Processing all your chats...');
          
          setIsProcessingFirstTime(true);
          setIsUpdating(true);
          
          let attempts = 0;
          const maxAttempts = 18;
          
          const pollForUpdates = setInterval(async () => {
            attempts++;
            
            try {
              await fetchCanvas();
              
              if (canvasData && canvasData.total_insights > 0) {
                clearInterval(pollForUpdates);
                setIsUpdating(false);
                setIsProcessingFirstTime(false);
                console.log('Canvas successfully populated with insights!');
              }
              
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

  const handleClearCanvas = async () => {
    setIsClearing(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/phd-canvas`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        setCanvasData(null);
        await fetchCanvas();
      }
    } catch (error) {
      console.error('Error clearing canvas:', error);
    } finally {
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  };

  const handleRefreshCanvas = async () => {
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

  const sortedSections = Object.entries(canvasData?.sections || {})
    .sort(([, a], [, b]) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.insights.length - a.insights.length;
    });

  return (
    <div className={`canvas-page ${isPrintView ? 'print-view' : ''}`}>
      {/* Header */}
      <div className="canvas-header">
        <div className="canvas-header-top">
          <button
            className="back-button"
            onClick={onNavigateToChat}
          >
            <ArrowLeft size={20} />
            Back to Chat
          </button>

          <div className="header-actions">
            <button
              onClick={handleRefreshCanvas}
              disabled={isRefreshing || isUpdating}
              className={`canvas-icon-btn refresh-button ${(isRefreshing || isUpdating) ? 'disabled' : ''}`}
              title={(isRefreshing || isUpdating) ? 'Refreshing…' : 'Refresh Canvas'}
              aria-label="Refresh canvas"
            >
              <RefreshCw className={`refresh-icon ${(isRefreshing || isUpdating) ? 'spinning' : ''}`} />
            </button>

            <button
              className="canvas-icon-btn print-button"
              onClick={handlePrint}
              title="Print"
              aria-label="Print canvas"
            >
              <Printer className="action-icon" />
            </button>

            <button
              className="canvas-icon-btn clear-canvas-btn"
              onClick={() => setShowClearConfirm(true)}
              disabled={isClearing}
              title="Clear Canvas"
              aria-label="Clear canvas"
            >
              <Trash2 className="action-icon" />
            </button>
          </div>
        </div>

        <div className="canvas-title-section">
          <h1 className="canvas-title">
            <FileText className="canvas-title-icon" />
            {appName} Canvas
          </h1>
          <p className="canvas-subtitle">Your research progress at a glance</p>
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
                <div className="inline-loading-spinner">
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
                    className="empty-canvas-btn primary"
                    onClick={onNavigateToChat}
                  >
                    <MessageCircle size={18} />
                    <span>Start Chatting</span>
                    <ArrowRight size={16} className="empty-canvas-btn-arrow" />
                  </button>
                  <button
                    className="empty-canvas-btn secondary"
                    onClick={handleFullRefresh}
                  >
                    <RefreshCw size={16} />
                    <span>Process Existing Chats</span>
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
        <CopyrightNotice />
      </footer>

      {/* Print Footer */}
      {isPrintView && (
        <div className="print-footer">
          <p>Generated by {appName} - {new Date().toLocaleDateString()}</p>
          <p>Student: {user?.email} | Total Insights: {canvasData?.total_insights || 0}</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear canvas?"
        message="This will permanently delete all insights on your canvas. This action can't be undone."
        confirmLabel={isClearing ? 'Clearing…' : 'Clear canvas'}
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleClearCanvas}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};

export default CanvasPage;
