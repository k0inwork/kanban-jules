import { ModuleManifest, RequestContext } from './types';

import julesManifest from '../modules/executor-jules/manifest.json';
import { JulesPostman } from '../modules/executor-jules/JulesPostman';

import artifactsManifest from '../modules/knowledge-artifacts/manifest.json';
import { ArtifactTool } from '../modules/knowledge-artifacts/ArtifactTool';

import repoBrowserManifest from '../modules/knowledge-repo-browser/manifest.json';
import { RepositoryTool } from '../modules/knowledge-repo-browser/RepositoryTool';

import projectManagerManifest from '../modules/process-project-manager/manifest.json';
import { ProcessAgent } from '../modules/process-project-manager/ProcessAgent';

import userNegotiatorManifest from '../modules/channel-user-negotiator/manifest.json';

import architectManifest from '../modules/architect-codegen/manifest.json';
import { ArchitectTool } from '../modules/architect-codegen/Architect';

import localExecutorManifest from '../modules/executor-local/manifest.json';
import githubExecutorManifest from '../modules/executor-github/manifest.json';
import localAnalyzerManifest from '../modules/knowledge-local-analyzer/manifest.json';
import { LocalAnalyzer } from '../modules/knowledge-local-analyzer/LocalAnalyzer';

import knowledgeKbManifest from '../modules/knowledge-kb/manifest.json';
import knowledgeProjectorManifest from '../modules/knowledge-projector/manifest.json';
import processDreamManifest from '../modules/process-dream/manifest.json';
import processReflectionManifest from '../modules/process-reflection/manifest.json';

import sandboxYuanManifest from '../modules/sandbox-yuan/manifest.json';
import bashExecutorManifest from '../modules/bash-executor/manifest.json';
import { BashExecutorHandler } from '../modules/bash-executor/BashExecutorHandler';

import claudeExecutorManifest from '../modules/executor-claude/manifest.json';
import { ClaudeExecutorHandler } from '../modules/executor-claude/ClaudeExecutorHandler';

export class ModuleRegistry {
  private modules: ModuleManifest[] = [
    { ...julesManifest, enabled: true, init: JulesPostman.init, destroy: JulesPostman.destroy },
    { ...artifactsManifest, enabled: true, init: ArtifactTool.init, destroy: () => {} },
    { ...repoBrowserManifest, enabled: true, init: RepositoryTool.init, destroy: () => {} },
    { ...projectManagerManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...userNegotiatorManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...architectManifest, enabled: true, init: ArchitectTool.init, destroy: () => {} },
    { ...localExecutorManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...githubExecutorManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...localAnalyzerManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...knowledgeKbManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...knowledgeProjectorManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...processDreamManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...processReflectionManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...sandboxYuanManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...bashExecutorManifest, enabled: true, init: BashExecutorHandler.init, destroy: () => {} },
    { ...claudeExecutorManifest, enabled: true, init: ClaudeExecutorHandler.init, destroy: () => {} },
  ] as ModuleManifest[];

  private handlers: Map<string, (toolName: string, args: any[], context: RequestContext) => Promise<any>> = new Map();

  registerHandler(toolName: string, handler: (toolName: string, args: any[], context: RequestContext) => Promise<any>) {
    this.handlers.set(toolName, handler);
  }

  registerModuleHandlers(moduleId: string, handler: (toolName: string, args: any[], context: RequestContext) => Promise<any>) {
    const module = this.get(moduleId);
    if (!module) {
      console.warn(`[Registry] Module ${moduleId} not found, cannot register handlers.`);
      return;
    }
    if (module.tools && Array.isArray(module.tools)) {
      for (const tool of module.tools) {
        this.registerHandler(tool.name, handler);
      }
    }
  }

  async invokeHandler(toolName: string, args: any[], context: RequestContext): Promise<any> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new Error(`No handler registered for tool: ${toolName}`);
    }
    return handler(toolName, args, context);
  }

  getAll(): ModuleManifest[] {
    return this.modules;
  }

  getEnabled(): ModuleManifest[] {
    return this.modules.filter(m => m.enabled !== false);
  }

  get(id: string): ModuleManifest | undefined {
    return this.modules.find(m => m.id === id);
  }

  register(manifest: ModuleManifest) {
    if (!this.get(manifest.id)) {
      this.modules.push(manifest);
    }
  }

  setEnabled(id: string, enabled: boolean) {
    const module = this.get(id);
    if (module) {
      module.enabled = enabled;
    }
  }
}

export const registry = new ModuleRegistry();
