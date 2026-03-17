import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const VoiceStatusContext = createContext(null);

const POLL_INTERVAL = 5000;

export function VoiceStatusProvider({ authToken, children }) {
  const [ttsReady, setTtsReady] = useState(null);   // null = unknown
  const [sttReady, setSttReady] = useState(null);
  const [waking, setWaking] = useState(false);
  const [toast, setToast] = useState(null);          // { message, type }
  const pollRef = useRef(null);
  const wasPendingRef = useRef({ tts: false, stt: false });
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, type = 'info', duration = 6000) => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (duration) {
      toastTimerRef.current = setTimeout(() => setToast(null), duration);
    }
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const checkStatus = useCallback(async () => {
    if (!authToken) return;
    try {
      const resp = await fetch(`${process.env.REACT_APP_API_URL}/api/voice/status`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();

      setTtsReady(data.tts_ready);
      setSttReady(data.stt_ready);

      if (data.tts_ready && wasPendingRef.current.tts) {
        wasPendingRef.current.tts = false;
        showToast('Voice output (text-to-speech) is now available!', 'success', 5000);
      }
      if (data.stt_ready && wasPendingRef.current.stt) {
        wasPendingRef.current.stt = false;
        showToast('Voice input (speech-to-text) is now available!', 'success', 5000);
      }
      if (data.tts_ready && data.stt_ready) {
        stopPolling();
        setWaking(false);
      }
    } catch {
      // network error – keep polling
    }
  }, [authToken, showToast]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
  }, [checkStatus]);

  const requestWake = useCallback(async (source) => {
    if (!authToken) return;
    setWaking(true);
    if (source === 'tts') wasPendingRef.current.tts = true;
    if (source === 'stt') wasPendingRef.current.stt = true;

    try {
      await fetch(`${process.env.REACT_APP_API_URL}/api/voice/wake`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
    } catch { /* ignore */ }
    startPolling();
  }, [authToken, startPolling]);

  // Attempt to use voice: returns true if ready, false if waking up
  const ensureReady = useCallback((service) => {
    const ready = service === 'tts' ? ttsReady : sttReady;
    if (ready === true) return true;

    // If status is unknown (null) — we haven't heard back yet.
    // Still allow the call to proceed but trigger wake in background.
    if (ready === null) {
      requestWake(service);
      return true;
    }

    const label = service === 'tts' ? 'voice output' : 'voice input';
    showToast(
      `Since this is a demo, the ${label} service needs a moment to wake up. ` +
      `We'll notify you once it's ready — feel free to use text in the meantime!`,
      'waking',
      null,
    );
    requestWake(service);
    return false;
  }, [ttsReady, sttReady, showToast, requestWake]);

  // Run an initial status check on mount
  useEffect(() => {
    if (authToken) checkStatus();
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      stopPolling();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [stopPolling]);

  return (
    <VoiceStatusContext.Provider value={{
      ttsReady, sttReady, waking,
      ensureReady, checkStatus, requestWake,
      toast, dismissToast, showToast,
    }}>
      {children}
    </VoiceStatusContext.Provider>
  );
}

export function useVoiceStatus() {
  return useContext(VoiceStatusContext);
}
