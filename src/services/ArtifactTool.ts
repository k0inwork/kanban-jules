import { db, Artifact } from './db';

export const ArtifactTool = {
  listArtifacts: async (taskId: string): Promise<Artifact[]> => {
    return await db.taskArtifacts.where('taskId').equals(taskId).toArray();
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
    description: 'List all artifacts for a given task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: 'The task ID.' }
      },
      required: ['taskId']
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
