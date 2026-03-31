// src/components/ProviderDropdown.js
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Cpu, Cloud, Server, Loader2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const ProviderDropdown = ({ currentProvider, onProviderChange, isLoading = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { isDark } = useTheme();

  const providers = [
    {
      id: 'gemini',
      name: 'Gemini',
      description: 'Google\'s Gemini AI',
      icon: Cloud,
      badge: 'Cloud'
    },
    {
      id: 'ollama', 
      name: 'Ollama',
      description: 'Local LLM via Ollama',
      icon: Cpu,
      badge: 'Local'
    },
    {
      id: 'vllm',
      name: 'vLLM',
      description: 'vLLM inference endpoint',
      icon: Server,
      badge: 'API'
    }
  ];

  const currentProviderInfo = providers.find(p => p.id === currentProvider);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleProviderSelect = (providerId) => {
    if (providerId !== currentProvider && !isLoading) {
      onProviderChange(providerId);
      setIsOpen(false);
    }
  };

  const toggleDropdown = () => {
    if (!isLoading) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="provider-dropdown" ref={dropdownRef}>
      <button 
        className={`provider-button ${isOpen ? 'open' : ''} ${isLoading ? 'loading' : ''}`}
        onClick={toggleDropdown}
        disabled={isLoading}
      >
        <div className="provider-button-content">
          {isLoading ? (
            <Loader2 className="provider-icon spinning" size={16} />
          ) : (
            <currentProviderInfo.icon className="provider-icon" size={16} />
          )}
          <div className="provider-info">
            <span className="provider-name">{currentProviderInfo?.name || 'Unknown'}</span>
            <span className="provider-badge">{currentProviderInfo?.badge}</span>
          </div>
        </div>
        <ChevronDown 
          className={`dropdown-arrow ${isOpen ? 'rotated' : ''}`} 
          size={16} 
        />
      </button>

      {isOpen && (
        <div className="provider-dropdown-menu">
          {providers.map((provider) => {
            const Icon = provider.icon;
            const isSelected = provider.id === currentProvider;
            
            return (
              <button
                key={provider.id}
                className={`provider-option ${isSelected ? 'selected' : ''}`}
                onClick={() => handleProviderSelect(provider.id)}
                disabled={isSelected}
              >
                <Icon className="provider-option-icon" size={16} />
                <div className="provider-option-info">
                  <div className="provider-option-header">
                    <span className="provider-option-name">{provider.name}</span>
                    <span className={`provider-option-badge ${provider.id}`}>
                      {provider.badge}
                    </span>
                  </div>
                  <span className="provider-option-description">{provider.description}</span>
                </div>
                {isSelected && (
                  <div className="provider-option-checkmark">✓</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProviderDropdown;