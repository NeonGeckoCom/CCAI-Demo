import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAppConfig } from '../contexts/AppConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import AvatarPickerModal from './AvatarPickerModal';

const AdvisorCard = ({ advisor, advisorId }) => {
  const Icon = advisor.icon;
  const { isDark } = useTheme();
  const { getAdvisorColors } = useAppConfig();
  const colors = getAdvisorColors(advisorId, isDark);
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div className="advisor-card">
        <div
          className="advisor-card-icon"
          style={{ backgroundColor: colors.bgColor, position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setPickerOpen(true)}
        >
          {advisor.avatarUrl ? (
            <img src={advisor.avatarUrl} alt={advisor.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
          ) : (
            <Icon style={{ color: colors.color }} />
          )}
          {hovered && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Pencil size={18} color="#fff" />
            </div>
          )}
        </div>
        <h3 className="advisor-card-title">{advisor.name}</h3>
        <p className="advisor-card-role" style={{ color: colors.color }}>{advisor.role}</p>
        <p className="advisor-card-description">{advisor.description}</p>
      </div>
      {pickerOpen && (
        <AvatarPickerModal advisorId={advisorId} advisorName={advisor.name} onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
};

export default AdvisorCard;
