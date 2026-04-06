import { ModuleManifest } from './types';

import julesManifest from '../modules/executor-jules/manifest.json';
import mailboxManifest from '../modules/channel-mailbox/manifest.json';
import artifactsManifest from '../modules/knowledge-artifacts/manifest.json';
import repoBrowserManifest from '../modules/knowledge-repo-browser/manifest.json';
import projectManagerManifest from '../modules/process-project-manager/manifest.json';
import userNegotiatorManifest from '../modules/channel-user-negotiator/manifest.json';

export class ModuleRegistry {
  private modules: ModuleManifest[] = [
    julesManifest as ModuleManifest,
    mailboxManifest as ModuleManifest,
    artifactsManifest as ModuleManifest,
    repoBrowserManifest as ModuleManifest,
    projectManagerManifest as ModuleManifest,
    userNegotiatorManifest as ModuleManifest,
  ];

  getAll(): ModuleManifest[] {
    return this.modules;
  }

  get(id: string): ModuleManifest | undefined {
    return this.modules.find(m => m.id === id);
  }
}

export const registry = new ModuleRegistry();
