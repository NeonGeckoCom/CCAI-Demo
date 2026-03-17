import React from 'react';
import { Volume2, Mic, X, Loader2, CheckCircle } from 'lucide-react';
import { useVoiceStatus } from '../contexts/VoiceStatusContext';

const VoiceToast = () => {
  const { toast, dismissToast, waking } = useVoiceStatus();
  if (!toast) return null;

  const isWaking = toast.type === 'waking';
  const isSuccess = toast.type === 'success';

  return (
    <div style={{
      position: 'fixed',
      bottom: 100,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10000,
      maxWidth: 480,
      width: 'calc(100% - 32px)',
      animation: 'voiceToastIn 0.35s ease-out',
    }}>
      <div style={{
        background: isSuccess
          ? 'linear-gradient(135deg, #065f46, #047857)'
          : 'linear-gradient(135deg, #1e293b, #334155)',
        color: '#f1f5f9',
        borderRadius: 14,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
        border: `1px solid ${isSuccess ? 'rgba(52,211,153,0.3)' : 'rgba(148,163,184,0.2)'}`,
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: isSuccess
            ? 'rgba(52,211,153,0.2)'
            : 'rgba(99,102,241,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {isSuccess ? (
            <CheckCircle size={18} style={{ color: '#6ee7b7' }} />
          ) : isWaking ? (
            <Loader2 size={18} style={{ color: '#a5b4fc', animation: 'spin 1.2s linear infinite' }} />
          ) : (
            <Volume2 size={18} style={{ color: '#a5b4fc' }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600,
            fontSize: 13,
            marginBottom: 3,
            color: isSuccess ? '#6ee7b7' : '#e2e8f0',
          }}>
            {isSuccess ? 'Voice Ready' : 'Voice Services Waking Up'}
          </div>
          <div style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: '#94a3b8',
          }}>
            {toast.message}
          </div>
        </div>

        <button
          onClick={dismissToast}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#cbd5e1'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
        >
          <X size={16} />
        </button>
      </div>

      <style>{`
        @keyframes voiceToastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(16px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default VoiceToast;
