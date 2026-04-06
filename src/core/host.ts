import { registry } from './registry';
import { eventBus } from './event-bus';
import { JulesPostman } from '../modules/executor-jules/JulesPostman';
import { OrchestratorConfig } from './types';
import { ProcessAgent } from '../modules/process-project-manager/ProcessAgent';
import { GoogleGenAI } from '@google/genai';

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
  }

  async init(config: OrchestratorConfig) {
    this.config = config;
    const modules = registry.getAll();
    console.log(`Host initialized with ${modules.length} modules.`);

    if (registry.get('executor-jules')) {
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
