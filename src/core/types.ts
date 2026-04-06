export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
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
}
