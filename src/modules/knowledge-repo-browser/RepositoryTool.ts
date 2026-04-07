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
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-repo-browser.listFiles': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        return await RepositoryTool.listFiles(repoUrl || context.repoUrl, branch || context.repoBranch, token, path || '');
      }
      case 'knowledge-repo-browser.readFile': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        return await RepositoryTool.readFile(repoUrl || context.repoUrl, branch || context.repoBranch, token, path);
      }
      case 'knowledge-repo-browser.headFile': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        const lines = obj ? obj.lines : args[3];
        return await RepositoryTool.headFile(repoUrl || context.repoUrl, branch || context.repoBranch, token, path, lines);
      }
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
