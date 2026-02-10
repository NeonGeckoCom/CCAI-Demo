import React from 'react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';

const AdvisorCard = ({ advisor, advisorId }) => {
  const Icon = advisor.icon;
  const { isDark } = useTheme();
  const { getAdvisorColors } = useAppConfig();
  const colors = getAdvisorColors(advisorId, isDark);

  return (
    <div className="advisor-card">
      <div 
        className="advisor-card-icon" 
        style={{ backgroundColor: colors.bgColor }}
      >
        <Icon style={{ color: colors.color }} />
      </div>
      <h3 className="advisor-card-title">{advisor.name}</h3>
      <p 
        className="advisor-card-role" 
        style={{ color: colors.color }}
      >
        {advisor.role}
      </p>
      <p className="advisor-card-description">{advisor.description}</p>
    </div>
  );
};

export default AdvisorCard;
