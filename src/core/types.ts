export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export interface ResourceLimit {
  type: 'memory' | 'time' | 'concurrent';
  value: number;
}

export interface ConfigField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
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
  outputType?: string;
  requiresBindings?: string[];
  source?: string;
  backgroundSchedule?: string;
  limits?: ResourceLimit[];
  configFields?: ConfigField[];
  presentations?: ModulePresentation[];
  init?: (config: any) => void;
  destroy?: () => void;
}

export interface OrchestratorConfig {
  apiProvider: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  julesApiKey: string;
  repoUrl: string;
  repoBranch: string;
  moduleConfigs: Record<string, any>;
}
