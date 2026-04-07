import { db, Artifact } from '../../services/db';
import { OrchestratorConfig, RequestContext } from '../../core/types';

export const ArtifactTool = {
  init: (config: OrchestratorConfig) => {
    // ArtifactTool doesn't need config for now, but we'll keep the init method for consistency.
  },
  listArtifacts: async (taskId?: string, repoName?: string, branchName?: string, requestingTaskId?: string): Promise<Artifact[]> => {
    let artifacts: Artifact[] = [];
    if (taskId) {
      artifacts = await db.taskArtifacts.where('taskId').equals(taskId).toArray();
    } else if (repoName && branchName) {
      artifacts = await db.taskArtifacts.where({ repoName, branchName }).toArray();
    } else {
      artifacts = await db.taskArtifacts.toArray();
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

  saveArtifact: async (taskId: string, repoName: string, branchName: string, name: string, content: string, type?: string, metadata?: any): Promise<number> => {
    const artifact: Artifact = {
      taskId,
      repoName,
      branchName,
      name,
      content,
      type,
      metadata,
      createdAt: Date.now()
    };
    return await db.taskArtifacts.add(artifact);
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-artifacts.listArtifacts': {
        const obj = unpack(args[0]);
        const taskId = obj ? obj.taskId : args[0];
        const repoName = obj ? obj.repoName : args[1];
        const branchName = obj ? obj.branchName : args[2];
        return await ArtifactTool.listArtifacts(taskId || context.taskId, repoName || context.repoUrl, branchName || context.repoBranch, context.taskId);
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
        return await ArtifactTool.saveArtifact(context.taskId, context.repoUrl, context.repoBranch, name, content, type, metadata);
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
