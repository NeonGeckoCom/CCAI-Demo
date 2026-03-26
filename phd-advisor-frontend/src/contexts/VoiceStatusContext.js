import { createContext, useContext } from 'react';

const noop = () => {};

/** Defaults: voice calls go straight to the API (no /voice/status or /voice/wake). */
const defaultVoiceStatus = {
  ensureReady: () => true,
  ttsReady: null,
  sttReady: null,
  waking: false,
  checkStatus: noop,
  requestWake: noop,
  toast: null,
  dismissToast: noop,
  showToast: noop,
};

const VoiceStatusContext = createContext(defaultVoiceStatus);

/** No-op wrapper kept for compatibility; context uses defaults if omitted. */
export function VoiceStatusProvider({ children }) {
  return children;
}

export function useVoiceStatus() {
  return useContext(VoiceStatusContext);
}
