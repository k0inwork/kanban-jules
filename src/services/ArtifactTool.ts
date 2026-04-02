import { db, Artifact } from './db';

export const ArtifactTool = {
  listArtifacts: async (taskId?: string, repoName?: string, branchName?: string): Promise<Artifact[]> => {
    if (taskId) {
      return await db.taskArtifacts.where('taskId').equals(taskId).toArray();
    }
    if (repoName && branchName) {
      return await db.taskArtifacts.where({ repoName, branchName }).toArray();
    }
    return await db.taskArtifacts.toArray();
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

  finishStage: async (taskId: string, repoName: string, branchName: string, stageName: string, nextStage?: string, data?: any): Promise<number> => {
    // Find existing protocol or create new one
    const existing = await db.taskArtifacts
      .where({ taskId, name: 'task-protocol.json' })
      .first();
    
    let protocol = existing ? JSON.parse(existing.content) : { 
      objective: '', 
      completed_stages: [], 
      current_stage: '', 
      next_stage: '', 
      data: {} 
    };

    protocol.completed_stages = Array.from(new Set([...(protocol.completed_stages || []), stageName]));
    protocol.current_stage = nextStage || '';
    protocol.data = { ...(protocol.data || {}), ...(data || {}) };

    const content = JSON.stringify(protocol, null, 2);
    
    if (existing && existing.id) {
      await db.taskArtifacts.update(existing.id, { content });
      return existing.id;
    } else {
      return await db.taskArtifacts.add({
        taskId,
        repoName,
        branchName,
        name: 'task-protocol.json',
        content
      });
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
  },
  {
    name: 'finishStage',
    description: 'Mark a task stage as complete and update the task-protocol.json artifact. Use this to maintain hard state and avoid "vibish" execution.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: 'The task ID.' },
        repoName: { type: Type.STRING, description: 'The repository name.' },
        branchName: { type: Type.STRING, description: 'The branch name.' },
        stageName: { type: Type.STRING, description: 'The name of the stage just completed.' },
        nextStage: { type: Type.STRING, description: 'The name of the next stage to execute.' },
        data: { type: Type.OBJECT, description: 'Optional JSON data to persist in the protocol (e.g., file lists, analysis results).' }
      },
      required: ['taskId', 'repoName', 'branchName', 'stageName']
    }
  }
];
