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

  saveArtifact: async (taskId: string, repoName: string, branchName: string, name: string, content: string): Promise<number> => {
    const artifact: Artifact = {
      taskId,
      repoName,
      branchName,
      name,
      content,
    };
    return await db.taskArtifacts.add(artifact);
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    switch (toolName) {
      case 'knowledge-artifacts.listArtifacts':
        return await ArtifactTool.listArtifacts(args[0] || context.taskId, args[1] || context.repoUrl, args[2] || context.repoBranch, context.taskId);
      case 'knowledge-artifacts.readArtifact':
        return await ArtifactTool.readArtifact(args[0]);
      case 'knowledge-artifacts.saveArtifact':
        return await ArtifactTool.saveArtifact(context.taskId, context.repoUrl, context.repoBranch, args[0], args[1]);
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
        content: { type: Type.STRING, description: 'The artifact content.' }
      },
      required: ['taskId', 'repoName', 'branchName', 'name', 'content']
    }
  }
];
