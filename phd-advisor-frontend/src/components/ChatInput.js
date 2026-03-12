import React, { useState } from 'react';
import { Send } from 'lucide-react';

const ChatInput = ({ onSendMessage, isLoading, placeholder = "Ask your advisors anything..." }) => {
  const [inputMessage, setInputMessage] = useState('');

  const handleSend = () => {
    if (!inputMessage.trim() || isLoading) return;
    
    onSendMessage(inputMessage);
    setInputMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-area">
      <div className="input-container">
        <textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          className="message-input"
          rows="2"
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={!inputMessage.trim() || isLoading}
          className="send-button"
        >
          <Send className="send-icon" />
          <span className="send-text">Send</span>
        </button>
      </div>
    </div>
  );
};

export default ChatInput;