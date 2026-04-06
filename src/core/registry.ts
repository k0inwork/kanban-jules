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

export class ModuleRegistry {
  private modules: ModuleManifest[] = [
    { ...julesManifest, enabled: true, init: JulesPostman.init, destroy: JulesPostman.destroy },
    { ...artifactsManifest, enabled: true, init: ArtifactTool.init, destroy: () => {} },
    { ...repoBrowserManifest, enabled: true, init: RepositoryTool.init, destroy: () => {} },
    { ...projectManagerManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...userNegotiatorManifest, enabled: true, init: () => {}, destroy: () => {} },
    { ...architectManifest, enabled: true, init: ArchitectTool.init, destroy: () => {} },
  ] as ModuleManifest[];

  private handlers: Map<string, (toolName: string, args: any[], context: RequestContext) => Promise<any>> = new Map();

  registerHandler(toolName: string, handler: (toolName: string, args: any[], context: RequestContext) => Promise<any>) {
    this.handlers.set(toolName, handler);
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
