import { vfs } from '../../services/vfs';
import { OrchestratorConfig, RequestContext } from '../../core/types';

export const RepositoryTool = {
  init: (config: OrchestratorConfig) => {
    // No config needed — vfs reads/writes IDBFS directly
  },

  listFiles: async (repoUrl: string, branch: string, token: string, path: string = ''): Promise<string[]> => {
    const basePath = `/tmp/repo-root${path ? '/' + path : ''}`;
    return vfs.readdir(basePath);
  },

  readFile: async (repoUrl: string, branch: string, token: string, path: string): Promise<string> => {
    return vfs.readFile(`/tmp/repo-root/${path}`);
  },

  headFile: async (repoUrl: string, branch: string, token: string, path: string, lines: number = 3): Promise<string> => {
    return vfs.headFile(`/tmp/repo-root/${path}`, lines);
  },

  writeFile: async (repoUrl: string, branch: string, token: string, path: string, content: string, commitMessage: string, taskDir?: string): Promise<boolean> => {
    const basePath = taskDir ? `/tmp/${taskDir}/repo` : '/tmp/repo-root';
    await vfs.writeFile(`${basePath}/${path}`, content);
    return true;
  },

  handleRequest: async (toolName: string, args: any[], context: RequestContext): Promise<any> => {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;

    switch (toolName) {
      case 'knowledge-repo-browser.listFiles': {
        const obj = unpack(args[0]);
        const path = obj?.path || args[2] || '';
        const basePath = context.taskDir
          ? `/tmp/${context.taskDir}/repo${path ? '/' + path : ''}`
          : `/tmp/repo-root${path ? '/' + path : ''}`;
        return vfs.readdir(basePath);
      }
      case 'knowledge-repo-browser.readFile': {
        const obj = unpack(args[0]);
        const path = obj?.path || args[2];
        const basePath = context.taskDir
          ? `/tmp/${context.taskDir}/repo/${path}`
          : `/tmp/repo-root/${path}`;
        return vfs.readFile(basePath);
      }
      case 'knowledge-repo-browser.headFile': {
        const obj = unpack(args[0]);
        const path = obj?.path || args[2];
        const lines = obj?.lines || args[3] || 3;
        const basePath = context.taskDir
          ? `/tmp/${context.taskDir}/repo/${path}`
          : `/tmp/repo-root/${path}`;
        return vfs.headFile(basePath, lines);
      }
      case 'knowledge-repo-browser.writeFile': {
        const obj = unpack(args[0]);
        const path = obj?.path || args[2];
        const content = obj?.content || args[3];
        const commitMessage = obj?.commitMessage || args[4] || `Update ${path}`;
        const basePath = context.taskDir
          ? `/tmp/${context.taskDir}/repo/${path}`
          : `/tmp/repo-root/${path}`;
        await vfs.writeFile(basePath, content);
        return true;
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
    description: 'Write content to a file in the repository.',
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
