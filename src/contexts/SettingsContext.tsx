import React, { createContext, useContext, ReactNode } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
import { HostConfig } from '../core/types';

interface SettingsContextType {
  autonomyMode: string;
  updateAutonomyMode: (mode: any) => void;
  hostConfig: HostConfig;
  saveSettings: (config: HostConfig) => void;
  settings: any;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useAppSettings();
  
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
