import { GitFs } from './GitFs';

export const RepositoryTool = {
  listFiles: async (repoUrl: string, branch: string, token: string, path: string = ''): Promise<string[]> => {
    const gitFs = new GitFs(repoUrl, branch, token);
    const files = await gitFs.listFiles(path);
    return files.map(f => f.path);
  },

  readFile: async (repoUrl: string, branch: string, token: string, path: string): Promise<string> => {
    const gitFs = new GitFs(repoUrl, branch, token);
    return await gitFs.getFile(path);
  }
};

export const repositoryToolDeclarations = [
  {
    name: 'listFiles',
    description: 'List files in a repository path.',
    parameters: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'The repository URL.' },
        branch: { type: 'string', description: 'The branch name.' },
        token: { type: 'string', description: 'The GitHub token.' },
        path: { type: 'string', description: 'The path to list files from.' }
      },
      required: ['repoUrl', 'branch', 'token']
    }
  },
  {
    name: 'readFile',
    description: 'Read the content of a file in a repository.',
    parameters: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'The repository URL.' },
        branch: { type: 'string', description: 'The branch name.' },
        token: { type: 'string', description: 'The GitHub token.' },
        path: { type: 'string', description: 'The file path.' }
      },
      required: ['repoUrl', 'branch', 'token', 'path']
    }
  }
];
