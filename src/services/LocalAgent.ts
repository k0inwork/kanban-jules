import { GoogleGenAI, Type } from '@google/genai';
import { LocalAnalyzer } from './LocalAnalyzer';
import { ArtifactTool, artifactToolDeclarations } from './ArtifactTool';
import { RepositoryTool, repositoryToolDeclarations } from './RepositoryTool';
import { db } from './db';

export interface AgentConfig {
  apiProvider: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  geminiApiKey: string;
}

export class LocalAgent {
  private analyzer: LocalAnalyzer;
  private artifactTool: typeof ArtifactTool;
  private repositoryTool: typeof RepositoryTool;
  private ai: GoogleGenAI;
  private repoUrl: string;
  private branch: string;
  private token: string;
  private taskId: string;
  private config: AgentConfig;

  constructor(ai: GoogleGenAI, repoUrl: string, branch: string, token: string, taskId: string, taskTitle: string, config: AgentConfig) {
    this.ai = ai;
    this.repoUrl = repoUrl;
    this.branch = branch;
    this.token = token;
    this.taskId = taskId;
    this.config = config;
    this.analyzer = new LocalAnalyzer(repoUrl, branch, token, taskId, taskTitle);
    this.artifactTool = ArtifactTool;
    this.repositoryTool = RepositoryTool;
    console.log(`[LocalAgent] Initialized with repoUrl: ${repoUrl}, branch: ${branch}, taskId: ${taskId}, provider: ${config.apiProvider}`);
  }

  private async callLlm(contents: any[]): Promise<string> {
    if (this.config.apiProvider === 'gemini') {
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: contents,
      });
      return response.text || '';
    } else {
      // OpenAI compatible
      const messages = contents.map(c => ({
        role: c.role === 'model' ? 'assistant' : c.role,
        content: c.parts[0].text
      }));

      const response = await fetch(`${this.config.openaiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openaiKey}`
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          messages: messages,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
      }

      const data = await response.json();
      return data.choices[0].message.content || '';
    }
  }

  async runTask(taskTitle: string, taskDescription: string, taskLogs: string, appendLog: (log: string) => void): Promise<{ findings: string[], savedArtifactIds: number[], status?: 'REVIEW' | 'DONE' | 'PAUSED' }> {
    appendLog(`> [LocalAgent] Starting local execution for: ${taskTitle}\n`);
    appendLog(`> [LocalAgent] Task ID: ${this.taskId}\n`);
    appendLog(`> [LocalAgent] Task Description: ${taskDescription}\n`);
    appendLog(`> [LocalAgent] Repository: ${this.repoUrl}, Branch: ${this.branch}\n`);
    appendLog(`> [LocalAgent] Using LLM to execute task with tools...\n`);
    appendLog(`> [System] Remember: Asking the user for clarification is a highly encouraged tool. If you are unsure about the next steps, use the askUser tool instead of guessing.\n`);
    
    const modelName = this.config.apiProvider === 'gemini' ? this.config.geminiModel : this.config.openaiModel;
    appendLog(`> [LocalAgent] Provider: ${this.config.apiProvider}, Model: ${modelName}\n`);
    
    const localRepositoryToolDeclarations = [
      {
        name: 'listFiles',
        description: 'List files in a repository path.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: { type: Type.STRING, description: 'The path to list files from. Use "." for root.' },
            repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
            branch: { type: Type.STRING, description: 'Optional. The branch name.' }
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
            path: { type: Type.STRING, description: 'The file path.' },
            repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
            branch: { type: Type.STRING, description: 'Optional. The branch name.' }
          },
          required: ['path']
        }
      }
    ];

    const localArtifactToolDeclarations = [
      {
        name: 'listArtifacts',
        description: 'List artifacts for this repository and branch, or for a specific task.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'Optional. The task ID.' },
            repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
            branch: { type: Type.STRING, description: 'Optional. The branch name.' }
          }
        }
      },
      {
        name: 'readArtifact',
        description: 'Read the content of an artifact.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            artifactId: { type: Type.NUMBER, description: 'The artifact ID.' },
            repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
            branch: { type: Type.STRING, description: 'Optional. The branch name.' }
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
            content: { type: Type.STRING, description: 'The artifact content.' },
            repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
            branch: { type: Type.STRING, description: 'Optional. The branch name.' }
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
        properties: {
          repo_name: { type: Type.STRING, description: 'Optional. The repository name.' },
          branch: { type: Type.STRING, description: 'Optional. The branch name.' }
        }
      }
    };

    const localCommunicationToolDeclarations = [
      {
        name: 'listTasks',
        description: 'List all tasks on the Kanban board to understand the project context.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, description: 'Optional. Filter by status: todo, in-progress, review, done.' }
          }
        }
      },
      {
        name: 'sendMessage',
        description: 'Send a message to the user\'s Mailbox.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, description: 'The message type: info, proposal, alert.' },
            content: { type: Type.STRING, description: 'The message content.' },
            title: { type: Type.STRING, description: 'Optional. For proposals, the suggested task title.' },
            description: { type: Type.STRING, description: 'Optional. For proposals, the suggested task description.' }
          },
          required: ['type', 'content']
        }
      },
      {
        name: 'askUser',
        description: 'Ask the user a question or request missing information. Use this when you cannot proceed without user input. This will pause the task and wait for the user.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING, description: 'The question or information needed from the user.' }
          },
          required: ['question']
        }
      }
    ];

    const tools = [{ functionDeclarations: [...localRepositoryToolDeclarations, ...localArtifactToolDeclarations, analyzerToolDeclaration, ...localCommunicationToolDeclarations] }];
    appendLog(`> [LocalAgent] Tools available: ${tools[0].functionDeclarations.map(f => f.name).join(', ')}\n`);
    
    const prompt = `
      You are a local agent executing a task on a repository.
      Task Title: ${taskTitle}
      Task Description: ${taskDescription}
      Repository: ${this.repoUrl}
      Branch: ${this.branch}
      
      Task Logs/Chat History:
      ${taskLogs}
      
      You have the following tools available. To call a tool, you MUST use the following XML-like tags:
      
      - <listFiles path="path/to/dir"/> : List files in a repository path. Use "." for root.
      - <readFile path="path/to/file"/> : Read the content of a file.
      - <saveArtifact name="artifact_name" content="artifact_content"/> : Save a new artifact.
      - <listArtifacts/> : List all artifacts for the current repository and branch.
      - <listArtifacts taskId="task-id"/> : List all artifacts for a specific task.
      - <readArtifact artifactId="123"/> : Read the content of an artifact by ID.
      - <analyzeCode/> : Analyzes the code for secrets and passwords.
      - <listTasks/> : List all tasks on the board to see what else is being worked on.
      - <sendMessage type="info|proposal|alert" content="message text" [title="task title" description="task desc"]/> : Send a message to the user's Mailbox.
      - <askUser question="your question here"/> : Ask the user a question or request missing information. Use this when you cannot proceed without user input. This will pause the task and wait for the user.
      
      COMMUNICATION RULES:
      1. Use <sendMessage type="info"/> to report significant progress or findings that don't fit in an artifact.
      2. Use <sendMessage type="proposal"/> if you discover a new task that needs to be done (e.g., "I found a bug in X, we should fix it").
      3. Use <sendMessage type="alert"/> for critical blockers or security issues.
      4. Do NOT spam the mailbox. Only send messages for important events.
      
      CRITICAL INSTRUCTIONS:
      1. You MUST use these tags to take action. Do not just describe what you would do.
      2. If the task requires producing a result (like a file list, a report, or a code analysis), you MUST save it as an artifact using <saveArtifact name="..." content="..."/>.
      3. You can call multiple tools in one turn if needed.
      4. After calling a tool, wait for the tool response which will be provided in a <tool_response> tag.
      5. When the task is complete, provide a final summary of your findings.
      
      Example:
      To list files in the root: <listFiles path="."/>
    `;

    let currentContents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const findings: string[] = [];
    const savedArtifactIds: number[] = [];

    for (let i = 0; i < 15; i++) { // Max 15 turns
      try {
        appendLog(`> [Debug] Turn ${i} Request: ${JSON.stringify({ contents: currentContents }, null, 2)}\n`);
        const responseText = await this.callLlm(currentContents);

        appendLog(`> [LocalAgent] ${responseText}\n`);
        
        currentContents.push({ role: 'model', parts: [{ text: responseText }] });

        // Parse XML-like tool calls
        // Regex to match <toolName attr1="val1" attr2="val2" /> or <toolName />
        const toolCallRegex = /<(\w+)\s*([^>]*?)\/?>/g;
        let match;
        const toolCalls: { name: string, args: any }[] = [];

        while ((match = toolCallRegex.exec(responseText)) !== null) {
          const name = match[1];
          const attrString = match[2];
          const args: any = {};
          
          // Parse attributes: key="value"
          const attrRegex = /(\w+)="([^"]*)"/g;
          let attrMatch;
          while ((attrMatch = attrRegex.exec(attrString)) !== null) {
            args[attrMatch[1]] = attrMatch[2];
          }
          
          toolCalls.push({ name, args });
        }

        if (toolCalls.length > 0) {
          const toolResults: string[] = [];
          
          for (const call of toolCalls) {
            appendLog(`> [Tool Call] ${call.name}(${JSON.stringify(call.args)})\n`);
            let result: any;
            
            try {
              if (call.name === 'listFiles') {
                result = await this.repositoryTool.listFiles(this.repoUrl, this.branch, this.token, call.args.path || '.');
              } else if (call.name === 'readFile') {
                result = await this.repositoryTool.readFile(this.repoUrl, this.branch, this.token, call.args.path);
              } else if (call.name === 'listArtifacts') {
                const repoName = call.args.repo_name || this.repoUrl.split('/').pop() || this.repoUrl;
                const branch = call.args.branch || this.branch;
                const taskId = call.args.taskId;
                // If no taskId is provided, we default to repo/branch search to enable sharing
                if (!taskId && !call.args.repo_name && !call.args.branch) {
                  result = await this.artifactTool.listArtifacts(undefined, repoName, branch);
                } else {
                  result = await this.artifactTool.listArtifacts(taskId, repoName, branch);
                }
              } else if (call.name === 'readArtifact') {
                result = await this.artifactTool.readArtifact(parseInt(call.args.artifactId));
              } else if (call.name === 'saveArtifact') {
                const repoName = this.repoUrl.split('/').pop() || this.repoUrl;
                result = await this.artifactTool.saveArtifact(this.taskId, repoName, this.branch, call.args.name, call.args.content);
                if (typeof result === 'number') {
                  savedArtifactIds.push(result);
                }
              } else if (call.name === 'analyzeCode') {
                result = await this.analyzer.analyze();
              } else if (call.name === 'listTasks') {
                const status = call.args.status;
                if (status) {
                  result = await db.tasks.where('status').equals(status).toArray();
                } else {
                  result = await db.tasks.toArray();
                }
              } else if (call.name === 'sendMessage') {
                const msg: any = {
                  sender: 'local-agent',
                  taskId: this.taskId,
                  type: call.args.type || 'info',
                  content: call.args.content,
                  status: 'unread',
                  timestamp: Date.now()
                };
                if (call.args.type === 'proposal' && call.args.title) {
                  msg.proposedTask = {
                    title: call.args.title,
                    description: call.args.description || ''
                  };
                }
                await db.messages.add(msg);
                result = { success: true };
              } else if (call.name === 'askUser') {
                await db.messages.add({
                  sender: 'local-agent',
                  taskId: this.taskId,
                  type: 'alert',
                  content: `**Question regarding task "${taskTitle}":**\n\n${call.args.question}`,
                  status: 'unread',
                  timestamp: Date.now()
                });
                // We can't easily update the task.chat from here without passing a callback, 
                // but we can update it in the DB directly or pass a callback.
                // Let's just update the DB directly since we have the task ID.
                const task = await db.tasks.get(this.taskId);
                if (task) {
                  await db.tasks.update(this.taskId, { 
                    chat: (task.chat || '') + `\n\n> [Agent - ${new Date().toLocaleTimeString()}] ${call.args.question}\n`,
                    status: 'PAUSED'
                  });
                }
                appendLog(`> [LocalAgent] Pausing task to wait for user input.\n`);
                return { findings, savedArtifactIds, status: 'PAUSED' };
              } else {
                result = { error: `Unknown tool: ${call.name}` };
              }
            } catch (e: any) {
              result = { error: e.message };
            }
            
            const resultStr = JSON.stringify(result, null, 2);
            toolResults.push(`<tool_response name="${call.name}">\n${resultStr}\n</tool_response>`);
            appendLog(`> [Tool Response] ${call.name} result: ${resultStr.substring(0, 200)}${resultStr.length > 200 ? '...' : ''}\n`);
          }
          
          currentContents.push({ role: 'user', parts: [{ text: toolResults.join('\n\n') }] });
        } else {
          // No tool calls, assume we are done or the model is just talking
          if (responseText.toLowerCase().includes('summary') || responseText.toLowerCase().includes('conclusion') || i > 0) {
            findings.push(responseText);
            break;
          }
        }
      } catch (error: any) {
        console.error(`[LocalAgent] Error in generateContent:`, error);
        
        // Try to extract more detailed error info if available
        let errorMessage = error.message;
        if (error.statusText) {
          errorMessage += ` (${error.statusText})`;
        }
        
        appendLog(`> [Error] API call failed: ${errorMessage}\n`);
        break;
      }
    }

    appendLog(`> [LocalAgent] Execution complete. Found ${findings.length} findings and saved ${savedArtifactIds.length} artifacts.\n`);
    return { findings, savedArtifactIds, status: 'DONE' };
  }

  get tools() {
    return {
      analyzer: this.analyzer,
      artifactTool: this.artifactTool,
      repositoryTool: this.repositoryTool
    };
  }
}
