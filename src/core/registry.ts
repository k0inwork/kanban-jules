import { ModuleManifest } from './types';

import julesManifest from '../modules/executor-jules/manifest.json';
import artifactsManifest from '../modules/knowledge-artifacts/manifest.json';
import repoBrowserManifest from '../modules/knowledge-repo-browser/manifest.json';
import projectManagerManifest from '../modules/process-project-manager/manifest.json';
import userNegotiatorManifest from '../modules/channel-user-negotiator/manifest.json';

export class ModuleRegistry {
  private modules: ModuleManifest[] = [
    { ...julesManifest, enabled: true },
    { ...artifactsManifest, enabled: true },
    { ...repoBrowserManifest, enabled: true },
    { ...projectManagerManifest, enabled: true },
    { ...userNegotiatorManifest, enabled: true },
  ] as ModuleManifest[];

  private handlers: Map<string, (toolName: string, args: any[]) => Promise<any>> = new Map();

  registerHandler(toolName: string, handler: (toolName: string, args: any[]) => Promise<any>) {
    this.handlers.set(toolName, handler);
  }

  async invokeHandler(toolName: string, args: any[]): Promise<any> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new Error(`No handler registered for tool: ${toolName}`);
    }
    return handler(toolName, args);
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
