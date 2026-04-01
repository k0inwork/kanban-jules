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

export const artifactToolDeclarations = [
  {
    name: 'listArtifacts',
    description: 'List all artifacts for a given task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID.' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'readArtifact',
    description: 'Read the content of an artifact.',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'number', description: 'The artifact ID.' }
      },
      required: ['artifactId']
    }
  },
  {
    name: 'saveArtifact',
    description: 'Save a new artifact.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID.' },
        repoName: { type: 'string', description: 'The repository name.' },
        branchName: { type: 'string', description: 'The branch name.' },
        name: { type: 'string', description: 'The artifact name.' },
        content: { type: 'string', description: 'The artifact content.' }
      },
      required: ['taskId', 'repoName', 'branchName', 'name', 'content']
    }
  }
];
