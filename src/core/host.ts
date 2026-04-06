import { registry } from './registry';
import { eventBus } from './event-bus';
import { JulesPostman } from '../modules/executor-jules/JulesPostman';
import { OrchestratorConfig } from './types';
import { ProcessAgent } from '../modules/process-project-manager/ProcessAgent';
import { GoogleGenAI } from '@google/genai';
import { db } from '../services/db';
import { ArtifactTool } from '../modules/knowledge-artifacts/ArtifactTool';
import { RepositoryTool } from '../modules/knowledge-repo-browser/RepositoryTool';
import { ArchitectTool } from '../modules/architect-codegen/Architect';

export class ModuleHost {
  private julesPostman: JulesPostman | null = null;
  private config: OrchestratorConfig | null = null;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on('project:review', async () => {
      if (!this.config) return;
      console.log('Project review triggered.');
      const ai = new GoogleGenAI({ apiKey: this.config.geminiApiKey || process.env.GEMINI_API_KEY || '' });
      const processAgent = new ProcessAgent(ai as any, this.config, this.config.repoUrl, this.config.repoBranch);
      await processAgent.runReview();
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
        const result = await registry.invokeHandler(toolName, args);
        eventBus.emit('module:response', { requestId, result });
      } catch (error: any) {
        eventBus.emit('module:response', { requestId, result: null, error: error.message });
      }
    });
  }

  async init(config: OrchestratorConfig) {
    this.config = config;
    const modules = registry.getEnabled();
    console.log(`Host initialized with ${modules.length} enabled modules.`);

    // Initialize tools
    ArtifactTool.init(config);
    RepositoryTool.init(config);
    ArchitectTool.init(config);

    // Register handlers
    registry.registerHandler('knowledge-artifacts.listArtifacts', ArtifactTool.handleRequest);
    registry.registerHandler('knowledge-artifacts.readArtifact', ArtifactTool.handleRequest);
    registry.registerHandler('knowledge-artifacts.saveArtifact', ArtifactTool.handleRequest);
    registry.registerHandler('knowledge-repo-browser.listFiles', RepositoryTool.handleRequest);
    registry.registerHandler('knowledge-repo-browser.readFile', RepositoryTool.handleRequest);
    registry.registerHandler('knowledge-repo-browser.headFile', RepositoryTool.handleRequest);
    registry.registerHandler('architect-codegen.generateProtocol', ArchitectTool.handleRequest);

    if (registry.get('executor-jules')?.enabled !== false) {
      this.julesPostman = new JulesPostman(config);
      this.julesPostman.start();
      console.log('Jules Postman started.');
    }
  }

  stop() {
    if (this.julesPostman) {
      this.julesPostman.stop();
    }
  }
}

export const host = new ModuleHost();
