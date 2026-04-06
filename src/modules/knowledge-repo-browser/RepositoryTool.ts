import { GitFs } from '../../services/GitFs';
import { OrchestratorConfig, RequestContext } from '../../core/types';

export const RepositoryTool = {
  init: (config: OrchestratorConfig) => {
    // RepositoryTool doesn't need config for now, but we'll keep the init method for consistency.
  },
  listFiles: async (repoUrl: string, branch: string, token: string, path: string = ''): Promise<string[]> => {
    const gitFs = new GitFs(repoUrl, branch, token);
    const files = await gitFs.listFiles(path);
    return files.map(f => f.path);
  },

  readFile: async (repoUrl: string, branch: string, token: string, path: string): Promise<string> => {
    const gitFs = new GitFs(repoUrl, branch, token);
    return await gitFs.getFile(path);
  },

  headFile: async (repoUrl: string, branch: string, token: string, path: string, lines: number = 3): Promise<string> => {
    const gitFs = new GitFs(repoUrl, branch, token);
    const content = await gitFs.getFile(path);
    return content.split('\n').slice(0, lines).join('\n');
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    const token = import.meta.env.VITE_GITHUB_TOKEN || '';
    switch (toolName) {
      case 'knowledge-repo-browser.listFiles':
        return await RepositoryTool.listFiles(args[0] || context.repoUrl, args[1] || context.repoBranch, token, args[2]);
      case 'knowledge-repo-browser.readFile':
        return await RepositoryTool.readFile(args[0] || context.repoUrl, args[1] || context.repoBranch, token, args[2]);
      case 'knowledge-repo-browser.headFile':
        return await RepositoryTool.headFile(args[0] || context.repoUrl, args[1] || context.repoBranch, token, args[2], args[3]);
      default:
        throw new Error(`Tool not found: ${toolName}`);
    }
  }
};

import { Type, FunctionDeclaration } from '@google/genai';

export const repositoryToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'listFiles',
    description: 'List files in a repository path.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repoUrl: { type: Type.STRING, description: 'The repository URL.' },
        branch: { type: Type.STRING, description: 'The branch name.' },
        token: { type: Type.STRING, description: 'The GitHub token.' },
        path: { type: Type.STRING, description: 'The path to list files from.' }
      },
      required: ['repoUrl', 'branch', 'token']
    }
  },
  {
    name: 'readFile',
    description: 'Read the content of a file in a repository.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repoUrl: { type: Type.STRING, description: 'The repository URL.' },
        branch: { type: Type.STRING, description: 'The branch name.' },
        token: { type: Type.STRING, description: 'The GitHub token.' },
        path: { type: Type.STRING, description: 'The file path.' }
      },
      required: ['repoUrl', 'branch', 'token', 'path']
    }
  },
  {
    name: 'headFile',
    description: 'Read the first N lines of a file in a repository.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repoUrl: { type: Type.STRING, description: 'The repository URL.' },
        branch: { type: Type.STRING, description: 'The branch name.' },
        token: { type: Type.STRING, description: 'The GitHub token.' },
        path: { type: Type.STRING, description: 'The file path.' },
        lines: { type: Type.NUMBER, description: 'The number of lines to read. Default is 3.' }
      },
      required: ['repoUrl', 'branch', 'token', 'path']
    }
  }
];
