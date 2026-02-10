import React from 'react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';

const ThinkingIndicator = ({ advisorId }) => {
  const { advisors, getAdvisorColors } = useAppConfig();
  const advisor = advisors[advisorId];
  const { isDark } = useTheme();
  const colors = getAdvisorColors(advisorId, isDark);

  if (!advisor) return null;

  const Icon = advisor.icon;

  return (
    <div className="thinking-container">
      <div 
        className="advisor-avatar" 
        style={{ backgroundColor: colors.bgColor }}
      >
        {Icon ? <Icon style={{ color: colors.color }} /> : null}
      </div>
      <div 
        className="thinking-bubble"
        style={{ 
          backgroundColor: colors.bgColor,
          borderColor: colors.color + '40' // Adding transparency to the border
        }}
      >
        <div className="thinking-header">
          <h4 
            className="advisor-name" 
            style={{ color: colors.color }}
          >
            {advisor.name}
          </h4>
        </div>
        <div className="thinking-dots">
          <div 
            className="thinking-dot" 
            style={{ 
              backgroundColor: colors.color, 
              animationDelay: '0ms' 
            }}
          ></div>
          <div 
            className="thinking-dot" 
            style={{ 
              backgroundColor: colors.color, 
              animationDelay: '150ms' 
            }}
          ></div>
          <div 
            className="thinking-dot" 
            style={{ 
              backgroundColor: colors.color, 
              animationDelay: '300ms' 
            }}
          ></div>
        </div>
        <p 
          className="thinking-text"
          style={{ 
            color: colors.color,
            opacity: 0.8 
          }}
        >
          thinking...
        </p>
      </div>
    </div>
  );
};

export default ThinkingIndicator;
