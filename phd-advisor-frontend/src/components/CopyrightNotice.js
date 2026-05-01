import React from 'react';

const CopyrightNotice = ({ variant = 'footer', className = '' }) => {
  const isSidebar = variant === 'sidebar';
  const textClass = isSidebar ? 'sidebar-copyright-text' : 'footer-text';
  const patentsClass = isSidebar ? 'sidebar-patents-link' : 'footer-patents-link';
  const combinedClass = className ? `${textClass} ${className}` : textClass;

  return (
    <p className={combinedClass}>
      {'\u00A9 '}
      {isSidebar ? (
        'Neon.ai'
      ) : (
        <a
          href="https://neon.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-neon-link"
        >
          <img src="/neon-logo.png" alt="" className="footer-neon-logo" />
          Neon.ai
        </a>
      )}
      , {'\u00A9 '}University of Colorado Boulder. All rights reserved.{' '}
      <a
        href="https://www.neon.ai/contact"
        target="_blank"
        rel="noopener noreferrer"
        className={patentsClass}
      >
        Patents and licensing.
      </a>
    </p>
  );
};

export default CopyrightNotice;
