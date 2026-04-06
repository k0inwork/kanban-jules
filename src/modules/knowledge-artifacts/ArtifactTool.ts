import { db, Artifact } from '../../services/db';

export const ArtifactTool = {
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
      if (a.name && a.name.startsWith('_')) {
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
