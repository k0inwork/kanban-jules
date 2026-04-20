// Jules API Client
// Base URL: https://jules.googleapis.com/v1alpha
// Auth: x-goog-api-key header

export const JULES_BASE_URL = 'https://jules.googleapis.com/v1alpha';

export type SessionState =
  | 'QUEUED'
  | 'PLANNING'
  | 'AWAITING_PLAN_APPROVAL'
  | 'AWAITING_USER_FEEDBACK'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ARCHIVED';

export interface Session {
  name: string;
  id: string;
  prompt?: string;
  title?: string;
  state: SessionState;
  url?: string;
  createTime: string;
  updateTime: string;
  outputs?: SessionOutput[];
}

export interface SessionOutput {
  pullRequest?: {
    url: string;
    title: string;
    description?: string;
    [key: string]: any; // Allow other fields like branch, headRef, etc.
  };
}

export interface PlanStep {
  id: string;
  index: number;
  title: string;
  description?: string;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  createTime: string;
}

export interface Artifact {
  changeSet?: {
    source: string;
    gitPatch: {
      baseCommitId: string;
      unidiffPatch: string;
      suggestedCommitMessage?: string;
    };
  };
  bashOutput?: {
    command: string;
    output: string;
    exitCode: number;
  };
  media?: {
    mimeType: string;
    data: string;
  };
}

export interface Activity {
  name: string;
  id: string;
  originator: 'user' | 'agent' | 'system';
  description?: string;
  createTime: string;
  artifacts?: Artifact[];
  // Event types
  planGenerated?: { plan: Plan };
  planApproved?: { planId: string };
  userMessaged?: { userMessage: string };
  agentMessaged?: { agentMessage: string };
  progressUpdated?: { title: string; description?: string };
  sessionCompleted?: Record<string, never>;
  sessionFailed?: { reason?: string };
}

export interface Source {
  name: string;
  id: string;
  githubRepo?: {
    owner: string;
    repo: string;
    isPrivate: boolean;
    defaultBranch: { displayName: string };
    branches: { displayName: string }[];
  };
}

export interface ListSessionsResponse {
  sessions: Session[];
  nextPageToken?: string;
}

export interface ListActivitiesResponse {
  activities: Activity[];
  nextPageToken?: string;
}

export interface ListSourcesResponse {
  sources: Source[];
  nextPageToken?: string;
}

export interface CreateSessionRequest {
  prompt: string;
  title?: string;
  sourceContext?: {
    source: string;
    githubRepoContext?: {
      startingBranch: string;
    };
  };
  requirePlanApproval?: boolean;
  automationMode?: 'AUTO_CREATE_PR';
}

class JulesApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    message?: string,
  ) {
    super(message || `Jules API error: ${status}`);
    this.name = 'JulesApiError';
  }
}

async function julesRequest<T>(
  apiKey: string,
  path: string,
  options: RequestInit = {},
  retries = 3
): Promise<T> {
  const url = `${JULES_BASE_URL}${path}`;
  console.log(`[Jules API] ${options.method || 'GET'} ${url}`);
  if (options.body) {
    console.log(`[Jules API] Body: ${options.body}`);
  }
  
  let lastError: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('Jules API call timed out after 60 seconds'), 60000); // 60s timeout

      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
            ...options.headers,
          },
          signal: controller.signal
        });

        if (!response.ok) {
          let errorBody: { error?: { code?: number; message?: string; status?: string } } = {};
          try {
            errorBody = await response.json();
          } catch {
            // ignore parse error
          }
          
          // Retry on 5xx errors or 429 Rate Limit
          if (response.status >= 500 || response.status === 429) {
            if (attempt < retries - 1) {
              const delay = 2000 * (attempt + 1);
              console.warn(`[Jules API] HTTP ${response.status}. Retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
          
          console.error(`[Jules API Error] ${response.status} ${url}`, errorBody);
          throw new JulesApiError(
            response.status,
            errorBody?.error?.status,
            errorBody?.error?.message || `HTTP ${response.status}`,
          );
        }

        const text = await response.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: any) {
      lastError = error;
      const isNetworkError = error.message?.includes('NetworkError') || error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED');
      if (!isNetworkError || attempt === retries - 1) {
        throw error;
      }
      const delay = 2000 * (attempt + 1);
      console.warn(`[Jules API] Network error: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export const julesApi = {
  listSessions: (apiKey: string, pageSize = 30, pageToken?: string) => {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set('pageToken', pageToken);
    return julesRequest<ListSessionsResponse>(apiKey, `/sessions?${params}`);
  },

  getSession: (apiKey: string, sessionName: string) => {
    const name = sessionName.startsWith('/') ? sessionName : `/${sessionName}`;
    return julesRequest<Session>(apiKey, name);
  },

  createSession: (apiKey: string, body: CreateSessionRequest) =>
    julesRequest<Session>(apiKey, '/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSession: (apiKey: string, sessionName: string) => {
    const name = sessionName.startsWith('/') ? sessionName : `/${sessionName}`;
    return julesRequest<Record<string, never>>(apiKey, name, {
      method: 'DELETE',
    });
  },

  sendMessage: (apiKey: string, sessionName: string, prompt: string) => {
    const name = sessionName.startsWith('/') ? sessionName : `/${sessionName}`;
    return julesRequest<Record<string, never>>(apiKey, `${name}:sendMessage`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  },

  approvePlan: (apiKey: string, sessionName: string) => {
    const name = sessionName.startsWith('/') ? sessionName : `/${sessionName}`;
    return julesRequest<Record<string, never>>(apiKey, `${name}:approvePlan`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  listActivities: (apiKey: string, sessionName: string, pageSize = 50, pageToken?: string) => {
    const name = sessionName.startsWith('/') ? sessionName : `/${sessionName}`;
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set('pageToken', pageToken);
    return julesRequest<ListActivitiesResponse>(
      apiKey,
      `${name}/activities?${params}`,
    );
  },

  listSources: (apiKey: string, pageSize = 30) => {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    return julesRequest<ListSourcesResponse>(apiKey, `/sources?${params}`);
  },
};
