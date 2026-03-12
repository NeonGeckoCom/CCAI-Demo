import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, FileText, X, Trash2, Download } from 'lucide-react';
import FileUpload from './FileUpload';

const EnhancedChatInput = ({ 
  onSendMessage, 
  onFileUploaded,
  uploadedDocuments = [],
  isLoading,
  currentChatSessionId,
  authToken, 
  placeholder = "Ask your advisors anything..." 
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef(null);

  const handleSend = () => {
    if (!inputMessage.trim() || isLoading || isUploading) return;
    
    onSendMessage(inputMessage);
    setInputMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUploaded = (file, response) => {
    setIsUploading(false);
    setShowUpload(false);
    
    if (onFileUploaded) {
      onFileUploaded(file, response);
    }
  };

  const handleUploadStart = () => {
    setIsUploading(true);
  };

  const toggleUpload = () => {
    if (!isUploading) {
      setShowUpload(!showUpload);
      setShowDocuments(false); // Close documents panel when opening upload
    }
  };

  const toggleDocuments = () => {
    setShowDocuments(!showDocuments);
    setShowUpload(false); // Close upload panel when opening documents
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [inputMessage]);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type) => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('text')) return '📃';
    return '📄';
  };

  const formatUploadTime = (date) => {
    return new Date(date).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isDisabled = isLoading || isUploading;
  const canSend = inputMessage.trim() && !isDisabled;

  return (
    <div className="enhanced-chat-input-container">
      {/* File Upload Area */}
      {showUpload && (
        <div className="floating-upload-section">
          <FileUpload 
            onFileUploaded={handleFileUploaded}
            isUploading={isUploading}
            currentChatSessionId={currentChatSessionId}  
            authToken={authToken}
            onUploadStart={handleUploadStart}
          />
        </div>
      )}

      {/* Documents Viewer Panel */}
      {showDocuments && (
        <div className="floating-documents-section">
          <div className="documents-header">
            <div className="documents-title">
              <FileText size={16} />
              <span>Uploaded Documents ({uploadedDocuments.length})</span>
            </div>
            <button 
              onClick={() => setShowDocuments(false)}
              className="close-documents-btn"
            >
              <X size={16} />
            </button>
          </div>
          
          <div className="documents-list">
            {uploadedDocuments.length === 0 ? (
              <div className="no-documents">
                <FileText size={24} />
                <p>No documents uploaded yet</p>
                <span>Upload documents to reference them in your conversations</span>
              </div>
            ) : (
              uploadedDocuments.map((doc) => (
                <div key={doc.id} className="document-item">
                  <div className="document-icon">
                    {getFileIcon(doc.type)}
                  </div>
                  <div className="document-info">
                    <div className="document-name">{doc.name}</div>
                    <div className="document-details">
                      {formatFileSize(doc.size)} • {formatUploadTime(doc.uploadTime)}
                    </div>
                  </div>
                  <div className="document-actions">
                    <button 
                      className="document-action-btn"
                      title="Remove document"
                      onClick={() => {
                        // TODO: Implement remove functionality
                        console.log('Remove document:', doc.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Input Box */}
      <div className="floating-input-box">
        {/* Text Input Row */}
        <div className="text-input-row">
          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            className="main-textarea"
            disabled={isDisabled}
            rows={1}
          />
        </div>

        {/* Controls Row */}
        <div className="controls-row">
          {/* Left - File Controls */}
          <div className="file-controls">
            <button
              onClick={toggleUpload}
              className={`add-docs-btn ${showUpload ? 'active' : ''}`}
              disabled={isUploading}
              type="button"
            >
              <Paperclip size={16} />
              <span>Add documents</span>
            </button>
            
            {uploadedDocuments.length > 0 && (
              <button
                onClick={toggleDocuments}
                className={`view-docs-btn ${showDocuments ? 'active' : ''}`}
                type="button"
                title={`View ${uploadedDocuments.length} uploaded document${uploadedDocuments.length !== 1 ? 's' : ''}`}
              >
                <FileText size={16} />
                <span className="docs-count">{uploadedDocuments.length}</span>
              </button>
            )}
          </div>

          {/* Right - Send Button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`send-button ${canSend ? 'enabled' : 'disabled'}`}
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedChatInput;