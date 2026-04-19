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
import { JulesHandler } from '../modules/executor-jules/JulesHandler';
import { UserHandler } from '../modules/channel-user-negotiator/UserHandler';
import { LocalHandler } from '../modules/executor-local/LocalHandler';
import { GithubHandler } from '../modules/executor-github/GithubHandler';
import { LocalAnalyzer } from '../modules/knowledge-local-analyzer/LocalAnalyzer';
import { YuanSandboxHandler } from '../modules/sandbox-yuan/YuanSandboxHandler';
import { KBHandler } from '../modules/knowledge-kb/Handler';
import { ProjectorHandler } from '../modules/knowledge-projector/Handler';
import { DreamHandler } from '../modules/process-dream/Handler';
import { ReflectionHandler } from '../modules/process-reflection/Handler';
import { initCommitHarvest, destroyCommitHarvest } from '../modules/process-dream/commit-harvest';
import { pushQueue } from '../services/PushQueue';
import { BashExecutorHandler } from '../modules/bash-executor/BashExecutorHandler';
import { ClaudeExecutorHandler } from '../modules/executor-claude/ClaudeExecutorHandler';
import { BoardTool } from '../modules/knowledge-board/BoardTool';

export class ModuleHost {
  private julesPostman: JulesPostman | null = null;
  private config: HostConfig | null = null;
  private stopPushFlush: (() => void) | null = null;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    // Background trigger: board idle → sessionDream (self-healing §5.5)
    let boardIdleTimer: ReturnType<typeof setTimeout> | null = null;
    eventBus.on('module:log', async ({ taskId, moduleId }) => {
      if (moduleId === 'orchestrator') {
        // Reset idle timer on any orchestrator activity
        if (boardIdleTimer) clearTimeout(boardIdleTimer);
        boardIdleTimer = setTimeout(async () => {
          if (!this.config) return;
          const tasks = await db.tasks.toArray();
          const inProgress = tasks.filter(t => t.workflowStatus === 'IN_PROGRESS').length;
          if (inProgress === 0) {
            try {
              const context: RequestContext = {
                taskId: '',
                repoUrl: this.config.repoUrl,
                repoBranch: this.config.repoBranch,
                githubToken: this.config.githubToken,
                llmCall: this.llmCall.bind(this),
                moduleConfig: this.config.moduleConfigs['process-dream'] || {}
              };
              await registry.invokeHandler('process-dream.sessionDream', [], context);
            } catch {
              // Session dream failure is non-critical
            }
          }
        }, 5 * 60 * 1000); // 5 minutes idle threshold
      }
    });

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
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = `> [${timestamp}] ${message}\n`;
      const task = await db.tasks.get(taskId);
      if (task) {
        const moduleLogs = task.moduleLogs || {};
        moduleLogs[moduleId] = (moduleLogs[moduleId] || '') + logEntry;
        await db.tasks.update(taskId, { moduleLogs });
      }
    });

    eventBus.on('module:request', async ({ requestId, taskId, toolName, args }) => {
      try {
        const moduleId = toolName.split('.')[0];
        const task = taskId ? await db.tasks.get(taskId) : null;
        const context: RequestContext = {
          taskId,
          repoUrl: this.config?.repoUrl || '',
          repoBranch: this.config?.repoBranch || '',
          githubToken: this.config?.githubToken || '',
          taskDir: task?.branchDir,
          branchName: task?.branchName,
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
    
    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
        
        try {
          const llmPromise = (async () => {
            if (this.config!.apiProvider === 'gemini') {
              const ai = new GoogleGenAI({ apiKey: this.config!.geminiApiKey || process.env.GEMINI_API_KEY || '' });
              const response: GenerateContentResponse = await ai.models.generateContent({
                model: this.config!.geminiModel,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: jsonMode ? { responseMimeType: 'application/json' } : undefined
              });
              return response.text || '';
            } else {
              const response = await fetch(`${this.config!.openaiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${this.config!.openaiKey}`
                },
                body: JSON.stringify({
                  model: this.config!.openaiModel,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                  response_format: jsonMode ? { type: 'json_object' } : undefined
                }),
                signal: controller.signal
              });
              if (response.ok) {
                const data = await response.json();
                return data.choices[0].message.content || '';
              } else {
                const error = await response.text();
                throw new Error(`OpenAI API error: ${error}`);
              }
            }
          })();

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('NetworkError: LLM call timed out after 60 seconds')), 60000);
          });

          return await Promise.race([llmPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error: any) {
        lastError = error;
        const isNetworkError = error.message?.includes('NetworkError') || error.message?.includes('fetch') || error.message?.includes('ECONNREFUSED');
        const isRateLimit = error.message?.includes('429') || error.message?.includes('1302') || error.message?.includes('rate limit') || error.message?.includes('速率限制');
        
        if (!isNetworkError && !isRateLimit) {
          throw error; // Don't retry other errors like 400 Bad Request
        }
        
        if (attempt < maxRetries - 1) {
          const delay = 5000 * (attempt + 1); // 5s, 10s
          const msg = `[Host] LLM call failed (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms... Error: ${error.message}`;
          console.warn(msg);
          eventBus.emit('module:log', { taskId: 'system', moduleId: 'orchestrator', message: msg });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
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

    // Initialize commit harvest listener (dream engine extracts decisions from Jules commits)
    initCommitHarvest(config, this.llmCall.bind(this));

    // Start push queue auto-flush (flushes pending pushes on connectivity)
    this.stopPushFlush = pushQueue.startAutoFlush();

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
    const bashHandler = new BashExecutorHandler();
    const claudeHandler = new ClaudeExecutorHandler();
    // DEV-ONLY: executor-claude — disabled in production
    // TODO: gate behind process.env.ENABLE_HOST_AGENT === 'true'

    registry.registerModuleHandlers('executor-jules', julesHandler.handleRequest.bind(julesHandler));
    registry.registerModuleHandlers('channel-user-negotiator', userHandler.handleRequest.bind(userHandler));
    registry.registerModuleHandlers('executor-local', localHandler.handleRequest.bind(localHandler));
    registry.registerModuleHandlers('executor-github', githubHandler.handleRequest.bind(githubHandler));
    registry.registerModuleHandlers('knowledge-artifacts', ArtifactTool.handleRequest);
    registry.registerModuleHandlers('knowledge-repo-browser', RepositoryTool.handleRequest);
    registry.registerModuleHandlers('architect-codegen', ArchitectTool.handleRequest);
    registry.registerModuleHandlers('process-project-manager', ProcessAgent.handleRequest);
    registry.registerModuleHandlers('knowledge-local-analyzer', LocalAnalyzer.handleRequest.bind(LocalAnalyzer));
    registry.registerModuleHandlers('knowledge-kb', KBHandler.handleRequest);
    registry.registerModuleHandlers('knowledge-projector', ProjectorHandler.handleRequest);
    registry.registerModuleHandlers('process-dream', DreamHandler.handleRequest);
    registry.registerModuleHandlers('process-reflection', ReflectionHandler.handleRequest);

    // Yuan sandbox — runScript tool for batching tool calls
    const yuanSandboxHandler = new YuanSandboxHandler();
    registry.registerModuleHandlers('sandbox-yuan', yuanSandboxHandler.handleRequest.bind(yuanSandboxHandler));
    registry.registerModuleHandlers('bash-executor', bashHandler.handleRequest.bind(bashHandler));
    registry.registerModuleHandlers('executor-claude', claudeHandler.handleRequest.bind(claudeHandler));
    registry.registerModuleHandlers('knowledge-board', BoardTool.handleRequest);

    // host.agentContextGet/Set handled per-task in orchestrator.moduleRequest
  }

  stop() {
    destroyCommitHarvest();
    if (this.stopPushFlush) {
      this.stopPushFlush();
      this.stopPushFlush = null;
    }
    const modules = registry.getEnabled();
    for (const module of modules) {
      if (module.destroy) {
        module.destroy();
      }
    }
  }
}

export const host = new ModuleHost();
