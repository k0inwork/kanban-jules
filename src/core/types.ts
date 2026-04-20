export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  requestTimeoutMs?: number;
}

export interface ResourceLimit {
  type: 'memory' | 'time' | 'concurrent';
  value: number;
}

export interface ConfigOption {
  value: string;
  label: string;
}

export interface ConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description: string;
  required: boolean;
  secret?: boolean;
  default?: any;
  options?: ConfigOption[];
}

export interface ModulePresentation {
  type: 'kanban' | 'chat' | 'browser';
  config: any;
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  type: 'architect' | 'knowledge' | 'executor' | 'channel' | 'process';
  description: string;
  tools: ToolDefinition[];
  sandboxBindings: Record<string, string>;
  permissions: string[];
  enabled?: boolean;
  hidden?: boolean;
  outputType?: string;
  requiresBindings?: string[];
  source?: string;
  backgroundSchedule?: string;
  limits?: ResourceLimit[];
  configFields?: ConfigField[];
  presentations?: ModulePresentation[];
  init?: (config: any) => void;
  destroy?: () => void;
  requestTimeoutMs?: number; // default timeout for all tools in this module (ms)
}

export interface RequestContext {
  taskId: string;
  repoUrl: string;
  repoBranch: string;
  githubToken?: string;
  taskDir?: string;      // task-scoped Lightning-FS directory (set when task has a branch)
  branchName?: string;   // task branch name (e.g. 'task/550e8400')
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;
  moduleConfig: any;
  abortSignal?: AbortSignal;
}

export interface HostConfig {
  apiProvider: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  githubToken: string;
  repoUrl: string;
  repoBranch: string;
  julesEndpoint: string;
  julesSourceName: string;
  julesSourceId: string;
  moduleConfigs: Record<string, any>;
}

export interface OrchestratorConfig {
  repoUrl: string;
  repoBranch: string;
  githubToken?: string;
  moduleConfigs: Record<string, any>;
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>;
  apiProvider?: string;
  geminiModel?: string;
  openaiModel?: string;
}
