import React from 'react';
import * as Lucide from 'lucide-react';

/**
 * Renders a lucide icon by its PascalCase name (matching the design tokens,
 * e.g. "LayoutDashboard", "Sparkles"). Falls back to HelpCircle if a name
 * isn't found in the installed lucide-react version.
 */
const Icon = ({ name, size = 18, strokeWidth = 2, color, className, style }) => {
  const Cmp = Lucide[name] || Lucide.HelpCircle;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
      style={{ display: 'inline-flex', lineHeight: 0, flexShrink: 0, ...style }}
    />
  );
};

export default Icon;
