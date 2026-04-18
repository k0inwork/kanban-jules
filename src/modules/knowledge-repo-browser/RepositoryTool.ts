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

  writeFile: async (repoUrl: string, branch: string, token: string, path: string, content: string, commitMessage: string, taskDir?: string): Promise<boolean> => {
    const gitFs = new GitFs(repoUrl, branch, token, taskDir);
    if (taskDir) {
      // Task-scoped: commit locally, don't push yet
      await gitFs.commitOnly(path, content, commitMessage);
    } else {
      await gitFs.writeFile(path, content, commitMessage);
    }
    return true;
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    const token = context.githubToken || import.meta.env.VITE_GITHUB_TOKEN || '';
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-repo-browser.listFiles': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        const gitFs = new GitFs(repoUrl || context.repoUrl, branch || context.repoBranch, token, context.taskDir);
        const files = await gitFs.listFiles(path || '');
        return files.map(f => f.path);
      }
      case 'knowledge-repo-browser.readFile': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        const gitFs = new GitFs(repoUrl || context.repoUrl, branch || context.repoBranch, token, context.taskDir);
        return await gitFs.getFile(path);
      }
      case 'knowledge-repo-browser.headFile': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        const lines = obj ? obj.lines : args[3];
        const gitFs = new GitFs(repoUrl || context.repoUrl, branch || context.repoBranch, token, context.taskDir);
        const content = await gitFs.getFile(path);
        return content.split('\n').slice(0, lines).join('\n');
      }
      case 'knowledge-repo-browser.writeFile': {
        const obj = unpack(args[0]);
        const repoUrl = obj ? obj.repoUrl : args[0];
        const branch = obj ? obj.branch : args[1];
        const path = obj ? obj.path : args[2];
        const content = obj ? obj.content : args[3];
        const commitMessage = obj ? obj.commitMessage : args[4];
        return await RepositoryTool.writeFile(repoUrl || context.repoUrl, branch || context.repoBranch, token, path, content, commitMessage || `Update ${path}`, context.taskDir);
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
  },
  {
    name: 'writeFile',
    description: 'Write content to a file in the repository. Creates a new commit.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repoUrl: { type: Type.STRING, description: 'The repository URL.' },
        branch: { type: Type.STRING, description: 'The branch name.' },
        token: { type: Type.STRING, description: 'The GitHub token.' },
        path: { type: Type.STRING, description: 'The file path.' },
        content: { type: Type.STRING, description: 'The content to write.' },
        commitMessage: { type: Type.STRING, description: 'The commit message.' }
      },
      required: ['repoUrl', 'branch', 'token', 'path', 'content']
    }
  }
];
