import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { julesApi, type Session, type Activity, type Source, JulesApiError } from '@/lib/julesApi';
import { GeminiClient } from '@/lib/ai/gemini';
import { ZAiClient } from '@/lib/ai/zai';
import { cacheDb } from '@/lib/cacheDb';

const API_KEY_STORAGE = 'jules_api_key';
const GEMINI_KEY_STORAGE = 'gemini_api_key';
const ZAI_KEY_STORAGE = 'zai_api_key';
const AUTO_PING_ENABLED_STORAGE = 'auto_ping_enabled';
const AUTO_PING_INTERVAL_STORAGE = 'auto_ping_interval';
const POLL_INTERVAL_MS = 5000;

const ACTIVE_STATES = new Set([
  'QUEUED',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'AWAITING_USER_FEEDBACK',
  'IN_PROGRESS',
]);

interface JulesContextValue {
  apiKey: string;
  setApiKey: (key: string) => void;
  geminiKey: string;
  setGeminiKey: (key: string) => void;
  zaiKey: string;
  setZaiKey: (key: string) => void;

  isKeyValid: boolean | null; // null = untested
  isKeyTesting: boolean;
  testApiKey: (key: string) => Promise<boolean>;

  isGeminiValid: boolean | null;
  isGeminiTesting: boolean;
  testGeminiKey: (key: string) => Promise<boolean>;

  isZaiValid: boolean | null;
  isZaiTesting: boolean;
  testZaiKey: (key: string) => Promise<boolean>;

  sessions: Session[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  refreshSessions: () => Promise<void>;

  selectedSessionId: string | null;
  selectSession: (id: string | null) => void;
  selectedSession: Session | null;

  activities: Activity[];
  activitiesLoading: boolean;
  activitiesError: string | null;
  refreshActivities: (forceRefresh?: boolean) => Promise<void>;

  sources: Source[];
  sourcesLoading: boolean;

  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  approvePlan: (sessionId: string) => Promise<void>;
  createSession: (prompt: string, title?: string, sourceContext?: { source: string; branch: string }, requireApproval?: boolean) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;

  aiProvider: 'gemini' | 'zai';
  setAiProvider: (provider: 'gemini' | 'zai') => void;

  geminiModel: string;
  setGeminiModel: (model: string) => void;

  zaiModel: string;
  setZaiModel: (model: string) => void;

  autoPingEnabled: boolean;
  setAutoPingEnabled: (enabled: boolean) => void;

  autoPingInterval: number;
  setAutoPingInterval: (interval: number) => void;

  llmPayloads: { id: string; timestamp: Date; provider: string; request: any; response: any }[];
  addLlmPayload: (payload: { provider: string; request: any; response: any }) => void;
  clearLlmPayloads: () => void;
}

const JulesContext = createContext<JulesContextValue | null>(null);

export function JulesProvider({ children }: { children: React.ReactNode }) {
  const [aiProvider, setAiProvider] = useState<'gemini' | 'zai'>('gemini');
  const [geminiModel, setGeminiModel] = useState<string>('gemini-3.1-pro-preview');
  const [zaiModel, setZaiModel] = useState<string>('glm-5');
  const [apiKey, setApiKeyState] = useState<string>(() => {
    return localStorage.getItem(API_KEY_STORAGE) || import.meta.env.VITE_JULES_API_KEY || '';
  });
  const [geminiKey, setGeminiKeyState] = useState<string>(() => {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [zaiKey, setZaiKeyState] = useState<string>(() => {
    return localStorage.getItem(ZAI_KEY_STORAGE) || import.meta.env.Z_API_KEY || import.meta.env.VITE_Z_API_KEY || '';
  });
  const [autoPingEnabled, setAutoPingEnabledState] = useState<boolean>(() => {
    const stored = localStorage.getItem(AUTO_PING_ENABLED_STORAGE);
    return stored !== null ? stored === 'true' : true;
  });
  const [autoPingInterval, setAutoPingIntervalState] = useState<number>(() => {
    const stored = localStorage.getItem(AUTO_PING_INTERVAL_STORAGE);
    return stored !== null ? parseInt(stored, 10) : 30;
  });

  const [isKeyValid, setIsKeyValid] = useState<boolean | null>(null);
  const [isKeyTesting, setIsKeyTesting] = useState(false);

  const [isGeminiValid, setIsGeminiValid] = useState<boolean | null>(null);
  const [isGeminiTesting, setIsGeminiTesting] = useState(false);

  const [isZaiValid, setIsZaiValid] = useState<boolean | null>(null);
  const [isZaiTesting, setIsZaiTesting] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  const [llmPayloads, setLlmPayloads] = useState<{ id: string; timestamp: Date; provider: string; request: any; response: any }[]>([]);

  const addLlmPayload = useCallback((payload: { provider: string; request: any; response: any }) => {
    setLlmPayloads((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date(),
        ...payload
      }
    ]);
  }, []);

  const clearLlmPayloads = useCallback(() => {
    setLlmPayloads([]);
  }, []);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    localStorage.setItem(API_KEY_STORAGE, key);
    setIsKeyValid(null);
  }, []);

  const setGeminiKey = useCallback((key: string) => {
    setGeminiKeyState(key);
    localStorage.setItem(GEMINI_KEY_STORAGE, key);
    setIsGeminiValid(null);
  }, []);

  const setZaiKey = useCallback((key: string) => {
    setZaiKeyState(key);
    localStorage.setItem(ZAI_KEY_STORAGE, key);
    setIsZaiValid(null);
  }, []);

  const setAutoPingEnabled = useCallback((enabled: boolean) => {
    setAutoPingEnabledState(enabled);
    localStorage.setItem(AUTO_PING_ENABLED_STORAGE, enabled.toString());
  }, []);

  const setAutoPingInterval = useCallback((interval: number) => {
    setAutoPingIntervalState(interval);
    localStorage.setItem(AUTO_PING_INTERVAL_STORAGE, interval.toString());
  }, []);

  const testApiKey = useCallback(async (key: string): Promise<boolean> => {
    if (!key.trim()) return false;
    setIsKeyTesting(true);
    try {
      await julesApi.listSessions(key, 1);
      setIsKeyValid(true);
      return true;
    } catch {
      setIsKeyValid(false);
      return false;
    } finally {
      setIsKeyTesting(false);
    }
  }, []);

  const testGeminiKey = useCallback(async (key: string): Promise<boolean> => {
    if (!key.trim()) return false;
    setIsGeminiTesting(true);
    try {
      const client = new GeminiClient(key, '', geminiModel);
      const valid = await client.testConnection();
      setIsGeminiValid(valid);
      return valid;
    } catch {
      setIsGeminiValid(false);
      return false;
    } finally {
      setIsGeminiTesting(false);
    }
  }, [geminiModel]);

  const testZaiKey = useCallback(async (key: string): Promise<boolean> => {
    if (!key.trim()) return false;
    setIsZaiTesting(true);
    try {
      const client = new ZAiClient(key, '', zaiModel);
      const valid = await client.testConnection();
      setIsZaiValid(valid);
      return valid;
    } catch {
      setIsZaiValid(false);
      return false;
    } finally {
      setIsZaiTesting(false);
    }
  }, [zaiModel]);

  const refreshSessions = useCallback(async () => {
    if (!apiKey) return;

    // Optimistically load from cache first
    const cachedSessions = await cacheDb.getSessions(apiKey);
    if (cachedSessions && cachedSessions.length > 0) {
      setSessions(cachedSessions);
    } else {
      setSessionsLoading(true);
    }

    setSessionsError(null);
    try {
      const res = await julesApi.listSessions(apiKey, 50);
      setSessions(res.sessions || []);
      // Update cache in the background
      cacheDb.saveSessions(apiKey, res.sessions || []).catch(console.error);
    } catch (err) {
      const msg = err instanceof JulesApiError ? err.message : 'Failed to load sessions';
      setSessionsError(msg);
    } finally {
      setSessionsLoading(false);
    }
  }, [apiKey]);

  const lastFetchedSessionUpdateTimes = useRef<Record<string, string>>({});

  const refreshActivities = useCallback(async (forceRefresh = false) => {
    if (!apiKey || !selectedSessionId) return;

    const currentSession = sessions.find(s => s.id === selectedSessionId);

    // Optimistically load from cache first
    const cachedActivities = await cacheDb.getActivities(apiKey, selectedSessionId);
    if (cachedActivities && cachedActivities.length > 0) {
      setActivities(cachedActivities);
    } else {
      setActivitiesLoading(true);
    }

    setActivitiesError(null);
    try {
      // If we're polling, check if the session updateTime has changed
      if (!forceRefresh && currentSession && currentSession.updateTime) {
         const lastUpdateTime = lastFetchedSessionUpdateTimes.current[selectedSessionId];
         if (lastUpdateTime === currentSession.updateTime && cachedActivities) {
           // Skip network fetch because we know the session hasn't been updated
           // The cached activities are guaranteed to be up-to-date
           setActivitiesLoading(false);
           return;
         }
      }

      const res = await julesApi.listActivities(apiKey, selectedSessionId, 100);
      setActivities(res.activities || []);
      // Update cache in the background
      cacheDb.saveActivities(apiKey, selectedSessionId, res.activities || []).catch(console.error);

      // Record the update time we just fetched for
      if (currentSession && currentSession.updateTime) {
        lastFetchedSessionUpdateTimes.current[selectedSessionId] = currentSession.updateTime;
      }
    } catch (err) {
      const msg = err instanceof JulesApiError ? err.message : 'Failed to load activities';
      setActivitiesError(msg);
    } finally {
      setActivitiesLoading(false);
    }
  }, [apiKey, selectedSessionId, sessions]);

  const loadSources = useCallback(async () => {
    if (!apiKey) return;
    setSourcesLoading(true);
    try {
      const res = await julesApi.listSources(apiKey, 50);
      setSources(res.sources || []);
    } catch {
      // silently fail
    } finally {
      setSourcesLoading(false);
    }
  }, [apiKey]);

  // Load sessions when API key is set
  useEffect(() => {
    if (apiKey) {
      refreshSessions();
      loadSources();
    } else {
      setSessions([]);
      setSources([]);
    }
  }, [apiKey, refreshSessions, loadSources]);

  // Poll sessions periodically if any are active
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (!apiKey) return;

    const hasActive = sessions.some((s) => ACTIVE_STATES.has(s.state));
    if (hasActive) {
      pollTimerRef.current = setInterval(refreshSessions, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [apiKey, sessions, refreshSessions]);

  // Load activities when session changes
  useEffect(() => {
    if (activityPollTimerRef.current) clearInterval(activityPollTimerRef.current);
    // don't blindly clear activities so we can seamlessly switch/load caches
    if (!selectedSessionId || !apiKey) {
       setActivities([]);
       return;
    }

    // Pass forceRefresh=false, relies on cache matching session's updateTime
    refreshActivities(false);

    // Poll activities if session is active
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (session && ACTIVE_STATES.has(session.state)) {
      activityPollTimerRef.current = setInterval(() => refreshActivities(false), POLL_INTERVAL_MS);
    }

    return () => {
      if (activityPollTimerRef.current) clearInterval(activityPollTimerRef.current);
    };
  }, [selectedSessionId, apiKey, refreshActivities, sessions]);
  // Keep track of recent pings to avoid race condition where we ping a session multiple times
  // before its updateTime is refreshed from the API.
  const recentlyPingedSessions = useRef<Record<string, number>>({});

  // Auto-ping logic
  useEffect(() => {
    if (autoPingTimerRef.current) clearInterval(autoPingTimerRef.current);
    if (!apiKey || !autoPingEnabled || autoPingInterval <= 0) return;

    const activeSessions = sessions.filter(s => ACTIVE_STATES.has(s.state));
    if (activeSessions.length === 0) return;

    const checkAndPing = async () => {
      const now = new Date();
      for (const session of activeSessions) {
        if (session.updateTime) {
          const updateTime = new Date(session.updateTime);
          const diffSec = (now.getTime() - updateTime.getTime()) / 1000;

          const lastPingTime = recentlyPingedSessions.current[session.id] || 0;
          const pingDiffSec = (now.getTime() - lastPingTime) / 1000;

          if (diffSec >= autoPingInterval && pingDiffSec >= autoPingInterval) {
            const messages = ["ping", "hello", "hi"];
            const msg = messages[Math.floor(Math.random() * messages.length)];
            try {
              await julesApi.sendMessage(apiKey, session.id, msg);
              recentlyPingedSessions.current[session.id] = Date.now();
              if (session.id === selectedSessionId) {
                 setTimeout(() => refreshActivities(true), 1000);
              }
            } catch (err) {
              console.error(`Failed to auto-ping session ${session.id}:`, err);
            }
          }
        }
      }
    };

    autoPingTimerRef.current = setInterval(checkAndPing, 5000);
    return () => { if (autoPingTimerRef.current) clearInterval(autoPingTimerRef.current); };
  }, [apiKey, sessions, autoPingEnabled, autoPingInterval, selectedSessionId, refreshActivities]);


  const selectSession = useCallback((id: string | null) => {
    setSelectedSessionId(id);
  }, []);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  const sendMessage = useCallback(
    async (sessionId: string, prompt: string) => {
      await julesApi.sendMessage(apiKey, sessionId, prompt);
      // Force refresh activities after sending a message
      setTimeout(() => refreshActivities(true), 1000);
    },
    [apiKey, refreshActivities],
  );

  const approvePlan = useCallback(
    async (sessionId: string) => {
      await julesApi.approvePlan(apiKey, sessionId);
      await refreshSessions();
      setTimeout(() => refreshActivities(true), 1000);
    },
    [apiKey, refreshSessions, refreshActivities],
  );

  const createSession = useCallback(
    async (
      prompt: string,
      title?: string,
      sourceContext?: { source: string; branch: string },
      requireApproval = false,
    ) => {
      const body = {
        prompt,
        title,
        requirePlanApproval: requireApproval,
        ...(sourceContext && {
          sourceContext: {
            source: sourceContext.source,
            githubRepoContext: { startingBranch: sourceContext.branch },
          },
        }),
      };
      const session = await julesApi.createSession(apiKey, body);
      await refreshSessions();
      return session;
    },
    [apiKey, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await julesApi.deleteSession(apiKey, sessionId);
      if (selectedSessionId === sessionId) setSelectedSessionId(null);
      await refreshSessions();
    },
    [apiKey, selectedSessionId, refreshSessions],
  );

  return (
    <JulesContext.Provider
      value={{
        aiProvider,
        setAiProvider,
        geminiModel,
        setGeminiModel,
        zaiModel,
        setZaiModel,
        autoPingEnabled,
        setAutoPingEnabled,
        autoPingInterval,
        setAutoPingInterval,
        apiKey,
        setApiKey,
        geminiKey,
        setGeminiKey,
        zaiKey,
        setZaiKey,
        isKeyValid,
        isKeyTesting,
        testApiKey,
        isGeminiValid,
        isGeminiTesting,
        testGeminiKey,
        isZaiValid,
        isZaiTesting,
        testZaiKey,
        sessions,
        sessionsLoading,
        sessionsError,
        refreshSessions,
        selectedSessionId,
        selectSession,
        selectedSession,
        activities,
        activitiesLoading,
        activitiesError,
        refreshActivities,
        sources,
        sourcesLoading,
        sendMessage,
        approvePlan,
        createSession,
        deleteSession,
        llmPayloads,
        addLlmPayload,
        clearLlmPayloads,
      }}
    >
      {children}
    </JulesContext.Provider>
  );
}

export function useJules() {
  const ctx = useContext(JulesContext);
  if (!ctx) throw new Error('useJules must be used within JulesProvider');
  return ctx;
}
