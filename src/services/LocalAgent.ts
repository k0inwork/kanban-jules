import { GoogleGenAI, Type } from '@google/genai';
import { LocalAnalyzer } from './LocalAnalyzer';
import { ArtifactTool, artifactToolDeclarations } from './ArtifactTool';
import { RepositoryTool, repositoryToolDeclarations } from './RepositoryTool';

export class LocalAgent {
  private analyzer: LocalAnalyzer;
  private artifactTool: typeof ArtifactTool;
  private repositoryTool: typeof RepositoryTool;
  private ai: GoogleGenAI;
  private repoUrl: string;
  private branch: string;
  private token: string;
  private taskId: string;

  constructor(ai: GoogleGenAI, repoUrl: string, branch: string, token: string, taskId: string, taskTitle: string) {
    this.ai = ai;
    this.repoUrl = repoUrl;
    this.branch = branch;
    this.token = token;
    this.taskId = taskId;
    this.analyzer = new LocalAnalyzer(repoUrl, branch, token, taskId, taskTitle);
    this.artifactTool = ArtifactTool;
    this.repositoryTool = RepositoryTool;
  }

  async runTask(taskTitle: string, taskDescription: string, appendLog: (log: string) => void): Promise<string[]> {
    appendLog(`> [LocalAgent] Starting local execution for: ${taskTitle}\n`);
    appendLog(`> [LocalAgent] Using LLM to execute task with tools...\n`);
    
    const localRepositoryToolDeclarations = [
      {
        name: 'listFiles',
        description: 'List files in a repository path.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: { type: Type.STRING, description: 'The path to list files from. Use "." for root.' }
          },
          required: ['path']
        }
      },
      {
        name: 'readFile',
        description: 'Read the content of a file in a repository.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: { type: Type.STRING, description: 'The file path.' }
          },
          required: ['path']
        }
      }
    ];

    const localArtifactToolDeclarations = [
      {
        name: 'listArtifacts',
        description: 'List all artifacts for a given task.',
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: []
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
            name: { type: Type.STRING, description: 'The artifact name.' },
            content: { type: Type.STRING, description: 'The artifact content.' }
          },
          required: ['name', 'content']
        }
      }
    ];

    const analyzerToolDeclaration = {
      name: 'analyzeCode',
      description: 'Analyzes the code for sensitive information.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: []
      }
    };

    const tools = [{ functionDeclarations: [...localRepositoryToolDeclarations, ...localArtifactToolDeclarations, analyzerToolDeclaration] }];
    
    const prompt = `
      You are a local agent executing a task on a repository.
      Task Title: ${taskTitle}
      Task Description: ${taskDescription}
      Repository: ${this.repoUrl}
      Branch: ${this.branch}
      
      You have the following tools available. You MUST use these exact tool names:
      - listFiles: List files in a repository path.
      - readFile: Read the content of a file in a repository.
      - saveArtifact: Save a new artifact.
      - listArtifacts: List all artifacts for a given task.
      - readArtifact: Read the content of an artifact.
      - analyzeCode: Analyzes the code for secrets and passwords.
      
      You MUST use the provided tools to complete the task. Do not just return a summary without taking action.
      Execute the task using these tools.
      When you are done, return a final summary of what you did.
    `;

    let currentContents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const findings: string[] = [];

    for (let i = 0; i < 10; i++) { // Max 10 turns
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: currentContents,
        tools: tools,
      });

      const responseMessage = response.candidates?.[0]?.content;
      if (!responseMessage) break;
      
      currentContents.push(responseMessage);

      if (responseMessage.parts && responseMessage.parts.some(p => p.text)) {
        const textParts = responseMessage.parts.filter(p => p.text).map(p => p.text).join('\n');
        appendLog(`> [LocalAgent] ${textParts}\n`);
        findings.push(textParts);
      }

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses: any[] = [];
        
        for (const call of response.functionCalls) {
          appendLog(`> [Tool Call] ${call.name}(${JSON.stringify(call.args)})\n`);
          let result: any;
          
          try {
            if (call.name === 'listFiles') {
              result = await this.repositoryTool.listFiles(this.repoUrl, this.branch, this.token, call.args.path);
            } else if (call.name === 'readFile') {
              result = await this.repositoryTool.readFile(this.repoUrl, this.branch, this.token, call.args.path);
            } else if (call.name === 'listArtifacts') {
              result = await this.artifactTool.listArtifacts(this.taskId);
            } else if (call.name === 'readArtifact') {
              result = await this.artifactTool.readArtifact(call.args.artifactId);
            } else if (call.name === 'saveArtifact') {
              const repoName = this.repoUrl.split('/').pop() || this.repoUrl;
              result = await this.artifactTool.saveArtifact(this.taskId, repoName, this.branch, call.args.name, call.args.content);
            } else if (call.name === 'analyzeCode') {
              result = await this.analyzer.analyze();
            } else {
              throw new Error(`Unknown tool called by LLM: ${call.name}`);
            }
          } catch (e: any) {
            result = { error: e.message };
          }
          
          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { result }
            }
          });
        }
        
        currentContents.push({ role: 'user', parts: functionResponses });
      } else {
        // No more tool calls, we are done
        break;
      }
    }

    return findings;
  }

  get tools() {
    return {
      analyzer: this.analyzer,
      artifactTool: this.artifactTool,
      repositoryTool: this.repositoryTool
    };
  }
}
