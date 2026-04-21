import { db, Artifact, ArtifactStatus } from '../../services/db';
import { OrchestratorConfig, RequestContext } from '../../core/types';
import { GitFs } from '../../services/GitFs';
import { KBHandler } from '../knowledge-kb/Handler';

export const ArtifactTool = {
  init: (config: OrchestratorConfig) => {
    // noop
  },
  listArtifacts: async (taskId?: string, repoName?: string, branchName?: string, requestingTaskId?: string, status?: ArtifactStatus): Promise<Artifact[]> => {
    let artifacts: Artifact[] = [];
    if (taskId) {
      artifacts = await db.taskArtifacts.where('taskId').equals(taskId).toArray();
    } else if (repoName && branchName) {
      artifacts = await db.taskArtifacts.where({ repoName, branchName }).toArray();
    } else {
      artifacts = await db.taskArtifacts.toArray();
    }

    // Filter by status if provided
    if (status) {
      artifacts = artifacts.filter(a => (a.status || 'draft') === status);
    }

    // Filter out '_' prefixed artifacts unless the requesting task is the owner
    return artifacts.filter(a => {
      if (typeof a.name === 'string' && a.name.startsWith('_')) {
        return requestingTaskId && a.taskId === requestingTaskId;
      }
      return true;
    });
  },

  readArtifact: async (artifactId: number): Promise<Artifact | undefined> => {
    return await db.taskArtifacts.get(artifactId);
  },

  updateStatus: async (artifactId: number, status: ArtifactStatus): Promise<void> => {
    const artifact = await db.taskArtifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact ${artifactId} not found`);
    if (!['draft', 'in_review', 'revised', 'approved'].includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be draft, in_review, revised, or approved.`);
    }
    await db.taskArtifacts.update(artifactId, { status });
  },

  promoteToKB: async (artifactId: number, context: RequestContext): Promise<{ kbDocId: number; version: number }> => {
    const artifact = await db.taskArtifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact ${artifactId} not found`);
    if (artifact.status !== 'approved') throw new Error(`Artifact ${artifactId} must be approved before promoting to KB (current: ${artifact.status})`);

    const summary = (artifact.metadata?.summary as string) || artifact.content.substring(0, 200) + '...';
    const kbDocId = await KBHandler.handleRequest('knowledge-kb.saveDocument', [{
      title: artifact.name,
      type: artifact.type || 'artifact',
      content: artifact.content,
      summary,
      tags: [artifact.type || 'artifact', 'promoted'],
      layer: ['L1'],
      source: 'artifact',
    }], context);

    // Track promotion in artifact metadata
    const promotion = {
      promotedAt: Date.now(),
      kbDocId,
      version: ((artifact.metadata?.promotedVersion as number) || 0) + 1,
    };
    await db.taskArtifacts.update(artifactId, {
      metadata: { ...artifact.metadata, promotedToKB: true, promotedVersion: promotion.version, promotedAt: promotion.promotedAt, kbDocId },
    });

    return { kbDocId, version: promotion.version };
  },

  saveArtifact: async (taskId: string, repoName: string, branchName: string, name: string, content: string, token: string, type?: string, metadata?: any): Promise<number> => {
    const artifact: Artifact = {
      taskId,
      repoName,
      branchName,
      name,
      content,
      type,
      status: 'draft' as ArtifactStatus,
      metadata,
      createdAt: Date.now()
    };
    const id = await db.taskArtifacts.add(artifact);

    // Also write to .artifacts/ folder in repo if possible
    if (repoName && branchName && token && !name.startsWith('_')) {
      try {
        const gitFs = new GitFs(repoName, branchName, token);
        const path = `.artifacts/${name}`;
        await gitFs.writeFile(path, content, `Fleet: Save artifact ${name}`);
      } catch (e) {
        console.error(`[ArtifactTool] Failed to write artifact to repo:`, e);
      }
    }

    return id;
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    const token = context.githubToken || import.meta.env.VITE_GITHUB_TOKEN || '';
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-artifacts.listArtifacts': {
        const obj = unpack(args[0]);
        const taskId = obj ? obj.taskId : args[0];
        const repoName = obj ? obj.repoName : args[1];
        const branchName = obj ? obj.branchName : args[2];
        const status = obj?.status as ArtifactStatus | undefined;
        return await ArtifactTool.listArtifacts(taskId || context.taskId, repoName || context.repoUrl, branchName || context.repoBranch, context.taskId, status);
      }
      case 'knowledge-artifacts.readArtifact': {
        const obj = unpack(args[0]);
        const artifactId = obj ? obj.artifactId : args[0];
        return await ArtifactTool.readArtifact(artifactId);
      }
      case 'knowledge-artifacts.saveArtifact': {
        const obj = unpack(args[0]);
        const name = obj ? obj.name : args[0];
        const content = obj ? obj.content : args[1];
        const type = obj ? obj.type : args[2];
        const metadata = obj ? obj.metadata : args[3];
        return await ArtifactTool.saveArtifact(context.taskId, context.repoUrl, context.repoBranch, name, content, token, type, metadata);
      }
      case 'knowledge-artifacts.updateArtifactStatus': {
        const obj = unpack(args[0]);
        const artifactId = obj?.artifactId ?? args[0];
        const status = obj?.status ?? args[1];
        if (!artifactId) throw new Error('artifactId is required');
        if (!status) throw new Error('status is required');
        await ArtifactTool.updateStatus(artifactId, status);
        return { artifactId, status };
      }
      case 'knowledge-artifacts.promoteToKB': {
        const obj = unpack(args[0]);
        const artifactId = obj?.artifactId ?? args[0];
        if (!artifactId) throw new Error('artifactId is required');
        return await ArtifactTool.promoteToKB(artifactId, context);
      }
      default:
        throw new Error(`Tool not found: ${toolName}`);
    }
  }
};

import { Type, FunctionDeclaration } from '@google/genai';

export const artifactToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'listArtifacts',
    description: 'List artifacts. Can filter by taskId or by repoName and branchName.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: 'The task ID (optional).' },
        repoName: { type: Type.STRING, description: 'The repository name (optional).' },
        branchName: { type: Type.STRING, description: 'The branch name (optional).' }
      }
    }
  },
  {
    name: 'readArtifact',
    description: 'Read the content of an artifact.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artifactId: { type: Type.NUMBER, description: 'The artifact ID.' }
      },
      required: ['artifactId']
    }
  },
  {
    name: 'saveArtifact',
    description: 'Save a new artifact.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: 'The task ID.' },
        repoName: { type: Type.STRING, description: 'The repository name.' },
        branchName: { type: Type.STRING, description: 'The branch name.' },
        name: { type: Type.STRING, description: 'The artifact name.' },
        content: { type: Type.STRING, description: 'The artifact content.' },
        type: { type: Type.STRING, description: 'The artifact type (optional).' },
        metadata: { type: Type.OBJECT, description: 'The artifact metadata (optional).' }
      },
      required: ['taskId', 'repoName', 'branchName', 'name', 'content']
    }
  }
];
