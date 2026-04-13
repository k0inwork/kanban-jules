import { registry } from './registry';
import { eventBus } from './event-bus';
import { JulesPostman } from '../modules/executor-jules/JulesPostman';
import { ModuleManifest, HostConfig, RequestContext, OrchestratorConfig } from './types';
import { ProcessAgent } from '../modules/process-project-manager/ProcessAgent';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { db } from '../services/db';
import { ArtifactTool } from '../modules/knowledge-artifacts/ArtifactTool';
import { RepositoryTool } from '../modules/knowledge-repo-browser/RepositoryTool';
import { ArchitectTool } from '../modules/architect-codegen/Architect';
import { agentContext } from '../services/AgentContext';
import { JulesHandler } from '../modules/executor-jules/JulesHandler';
import { UserHandler } from '../modules/channel-user-negotiator/UserHandler';
import { LocalHandler } from '../modules/executor-local/LocalHandler';
import { GithubHandler } from '../modules/executor-github/GithubHandler';
import { LocalAnalyzer } from '../modules/knowledge-local-analyzer/LocalAnalyzer';

import { llmCall } from './llm';

export class ModuleHost {
  private julesPostman: JulesPostman | null = null;
  private config: HostConfig | null = null;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on('project:review', async () => {
      if (!this.config) return;
      console.log('Project review triggered.');
      const moduleId = 'process-project-manager';
      const context: RequestContext = {
        taskId: '',
        repoUrl: this.config.repoUrl,
        repoBranch: this.config.repoBranch,
        githubToken: this.config.githubToken,
        llmCall: this.llmCall.bind(this),
        moduleConfig: this.config.moduleConfigs[moduleId] || {}
      };
      await registry.invokeHandler('process-project-manager.runReview', [], context);
    });

    eventBus.on('module:log', async ({ taskId, moduleId, message }) => {
      const now = Date.now();
      const timestampStr = new Date(now).toLocaleTimeString();
      const rawLogEntry = `> [${timestampStr}] ${message}\n`;
      
      const task = await db.tasks.get(taskId);
      if (task) {
        const moduleLogs = task.moduleLogs || {};
        moduleLogs[moduleId] = (moduleLogs[moduleId] || '') + rawLogEntry;
        
        const structuredLogs = task.structuredLogs || [];
        structuredLogs.push({
          timestamp: now,
          module: moduleId,
          text: message
        });
        
        // Keep only last 1000 logs to prevent DB bloat
        const trimmedLogs = structuredLogs.slice(-1000);
        
        await db.tasks.update(taskId, { 
          moduleLogs, 
          structuredLogs: trimmedLogs 
        });
      }
    });

    eventBus.on('module:request', async ({ requestId, taskId, toolName, args }) => {
      try {
        const moduleId = toolName.split('.')[0];
        const context: RequestContext = {
          taskId,
          repoUrl: this.config?.repoUrl || '',
          repoBranch: this.config?.repoBranch || '',
          githubToken: this.config?.githubToken || '',
          llmCall: this.llmCall.bind(this),
          moduleConfig: this.config?.moduleConfigs?.[moduleId] || {}
        };
        const result = await registry.invokeHandler(toolName, args, context);
        eventBus.emit('module:response', { requestId, result });
      } catch (error: any) {
        eventBus.emit('module:response', { requestId, result: null, error: error.message });
      }
    });
  }

  async llmCall(prompt: string, jsonMode?: boolean): Promise<string> {
    if (!this.config) throw new Error("Host not initialized");
    return llmCall(this.config, prompt, jsonMode);
  }

  async init(config: HostConfig) {
    this.config = config;
    const modules = registry.getEnabled();
    console.log(`Host initialized with ${modules.length} enabled modules.`);

    // Initialize modules
    for (const module of modules) {
      if (module.init) {
        module.init(config as any);
      }
    }

    // Instantiate and register handlers
    const julesConfig = config.moduleConfigs['executor-jules'] || {};
    const julesHandler = new JulesHandler({ 
      apiKey: julesConfig.julesApiKey || '',
      dailyLimit: julesConfig.julesDailyLimit,
      concurrentLimit: julesConfig.julesConcurrentLimit
    });
    const userHandler = new UserHandler();
    const localHandler = new LocalHandler();
    const githubHandler = new GithubHandler();

    registry.registerModuleHandlers('executor-jules', julesHandler.handleRequest.bind(julesHandler));
    registry.registerModuleHandlers('channel-user-negotiator', userHandler.handleRequest.bind(userHandler));
    registry.registerModuleHandlers('executor-local', localHandler.handleRequest.bind(localHandler));
    registry.registerModuleHandlers('executor-github', githubHandler.handleRequest.bind(githubHandler));
    registry.registerModuleHandlers('knowledge-artifacts', ArtifactTool.handleRequest);
    registry.registerModuleHandlers('knowledge-repo-browser', RepositoryTool.handleRequest);
    registry.registerModuleHandlers('architect-codegen', ArchitectTool.handleRequest);
    registry.registerModuleHandlers('process-project-manager', ProcessAgent.handleRequest);
    registry.registerModuleHandlers('knowledge-local-analyzer', LocalAnalyzer.handleRequest.bind(LocalAnalyzer));

    // Internal host tools (not in a manifest)
    registry.registerHandler('host.agentContextGet', async (tool, args) => agentContext.get(args[0]));
    registry.registerHandler('host.agentContextSet', async (tool, args) => {
      agentContext.set(args[0], args[1]);
      return true;
    });
  }

  stop() {
    const modules = registry.getEnabled();
    for (const module of modules) {
      if (module.destroy) {
        module.destroy();
      }
    }
  }
}

export const host = new ModuleHost();
