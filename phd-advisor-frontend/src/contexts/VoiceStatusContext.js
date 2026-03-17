import React, { createContext, useContext } from 'react';

const VoiceStatusContext = createContext(null);

export const useVoiceStatus = () => useContext(VoiceStatusContext);

export const VoiceStatusProvider = ({ children }) => (
  <VoiceStatusContext.Provider value={null}>
    {children}
  </VoiceStatusContext.Provider>
);

export default VoiceStatusContext;
