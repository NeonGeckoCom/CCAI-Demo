import React, { useEffect } from 'react';
import Icon from './Icon';

const Toast = ({ msg, onDone }) => {
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <div className="toast">
      <Icon name="CheckCircle2" size={16} className="t-icon" />
      <span>{msg}</span>
    </div>
  );
};

export default Toast;
