import { GoogleGenAI } from '@google/genai';
import { Task, TaskStep, WorkflowStatus, AgentState } from '../types';
import { registry } from './registry';
import { composeProgrammerPrompt } from './prompt';
import { eventBus } from './event-bus';
import { db } from '../services/db';
import { OrchestratorConfig } from './types';
import { JulesNegotiator } from '../services/negotiators/JulesNegotiator';
import { UserNegotiator } from '../services/negotiators/UserNegotiator';
import { ArtifactTool } from '../modules/knowledge-artifacts/ArtifactTool';
import { RepositoryTool } from '../modules/knowledge-repo-browser/RepositoryTool';
import { globalVars } from '../services/GlobalVars';
import { Sandbox, injectBindings } from './sandbox';

export class Orchestrator {
  private config: OrchestratorConfig | null = null;
  private ai: GoogleGenAI | null = null;
  private context: { accumulatedAnalysis: string[] } = { accumulatedAnalysis: [] };

  init(config: OrchestratorConfig) {
    this.config = config;
    if (config.apiProvider === 'gemini') {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || '' });
    }
  }

  private async moduleRequest(taskId: string, toolName: string, args: any[]): Promise<any> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    // Handle host-provided tools
    if (toolName === 'host.analyze' || toolName === 'host.addToContext') {
      const text = args[0];
      if (typeof text === 'string') {
        this.context.accumulatedAnalysis.push(text);
        this.appendActionLog(taskId, `Analysis added: ${text.substring(0, 50)}...`);
      }
      return true;
    }

    const requestId = Math.random().toString(36).substring(7);
    
    return new Promise((resolve, reject) => {
      const handler = (data: { requestId: string, result: any, error?: string }) => {
        if (data.requestId === requestId) {
          eventBus.off('module:response', handler);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result);
          }
        }
      };
      
      eventBus.on('module:response', handler);
      eventBus.emit('module:request', { requestId, taskId, toolName, args });
    });
  }

  private async logToChat(taskId: string, message: string) {
    const task = await db.tasks.get(taskId);
    if (task) {
      const newChat = (task.chat || '') + `\n> [Orchestrator] ${message}\n`;
      await db.tasks.update(taskId, { chat: newChat });
    }
  }

  private appendActionLog(taskId: string, msg: string) {
    eventBus.emit('module:log', { taskId, moduleId: 'orchestrator', message: msg });
  }

  private appendProgrammingLog(taskId: string, msg: string) {
    eventBus.emit('module:log', { taskId, moduleId: 'architect', message: msg });
  }

  private async callLlm(prompt: string, jsonMode: boolean = false): Promise<string> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    if (this.config.apiProvider === 'gemini') {
      if (!this.ai) throw new Error("AI not initialized");
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: prompt,
        config: jsonMode ? { responseMimeType: 'application/json' } : undefined
      });
      return response.text || '';
    } else {
      const response = await fetch(`${this.config.openaiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openaiKey}`
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
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

  async runStep(taskId: string, stepId: number): Promise<void> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    const task = await db.tasks.get(taskId);
    if (!task || !task.protocol) return;

    const step = task.protocol.steps.find(s => s.id === stepId);
    if (!step) return;

    await this.logToChat(taskId, `Starting execution for Step ${stepId}: ${step.title}`);
    this.appendActionLog(taskId, `Started Step ${stepId}`);

    // Load GlobalVars into the sandbox registry
    globalVars.clear();
    if (task.globalVars) {
      for (const [k, v] of Object.entries(task.globalVars)) {
        globalVars.set(k, v);
      }
    }

    let errorContext = '';
    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
      attempt++;
      
      const modules = registry.getEnabled();
      const prompt = composeProgrammerPrompt(modules, task, step, errorContext);
      
      try {
        let code = await this.callLlm(prompt);
        
        const codeMatch = code.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/i);
        if (codeMatch) {
          code = codeMatch[1].trim();
        } else {
          code = code.replace(/^\`\`\`(?:javascript|js)?\n/i, '').replace(/\n\`\`\`$/i, '').trim();
        }
        
        await this.logToChat(taskId, `Generated Code (Attempt ${attempt}):\n\`\`\`javascript\n${code}\n\`\`\``);
        this.appendProgrammingLog(taskId, `Step ${stepId} (Attempt ${attempt}) - code:\n"${code}"`);

        await this.executeInSandbox(taskId, code, stepId);
        return;

      } catch (error: any) {
        await this.logToChat(taskId, `Error generating or executing code: ${error.message}`);
        this.appendActionLog(taskId, `Error in Step ${stepId}: ${error.message}`);
        errorContext = error.message + (error.stack ? `\n${error.stack}` : '');
      }
    }
    
    await this.logToChat(taskId, `Failed to complete step after ${maxAttempts} attempts. Pausing task.`);
    await db.tasks.update(taskId, { 
      workflowStatus: 'IN_PROGRESS',
      agentState: 'ERROR' 
    });
  }

  private async executeInSandbox(taskId: string, code: string, stepId: number): Promise<void> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    const task = await db.tasks.get(taskId);
    if (!task || !task.protocol) throw new Error("Task or protocol not found");
    const step = task.protocol.steps.find(s => s.id === stepId);
    const executorId = step?.executor || 'executor-jules';
    const module = registry.get(executorId);
    const permissions = module?.permissions || [];
    const sandboxBindings = {
      ...module?.sandboxBindings,
      'analyze': 'host.analyze',
      'addToContext': 'host.addToContext'
    };

    this.context.accumulatedAnalysis = [];
    const sandbox = new Sandbox();
    injectBindings(sandbox, (toolName, args) => this.moduleRequest(taskId, toolName, args), this.context);

    try {
      const result = await sandbox.execute(code, permissions, sandboxBindings);
      await this.logToChat(taskId, `Execution Success. Result: ${JSON.stringify(result)}`);
      
      await db.tasks.update(taskId, { 
        globalVars: globalVars.getAll(),
        analysis: (this.context.accumulatedAnalysis.length > 0) ? this.context.accumulatedAnalysis.join('\n') : undefined
      });
      
      const updatedTask = await db.tasks.get(taskId);
      if (updatedTask && updatedTask.protocol) {
        const updatedSteps = updatedTask.protocol.steps.map(s => 
          s.id === stepId ? { ...s, status: 'completed' as const } : s
        );
        await db.tasks.update(taskId, { protocol: { ...updatedTask.protocol, steps: updatedSteps } });
      }
    } catch (error: any) {
      throw error;
    }
  }

  async runManual(task: Task) {
    eventBus.emit('task:manual-trigger', { taskId: task.id });
  }

  async processTask(task: Task, appendLog: (text: string) => Promise<void>) {
    if (!this.config) throw new Error("Orchestrator not initialized");

    const isResuming = task.workflowStatus === 'IN_PROGRESS';
    const initialLog = isResuming ? '' : '> Initializing Agent Session...\n';
    
    const updatedTaskData = { 
      workflowStatus: 'IN_PROGRESS' as WorkflowStatus,
      agentState: 'EXECUTING' as AgentState,
      agentId: task.agentId || 'jules-agent'
    };
    
    if (initialLog) {
      eventBus.emit('module:log', { taskId: task.id, moduleId: 'orchestrator', message: initialLog.trim() });
    }
    
    await db.tasks.update(task.id, updatedTaskData);
    let currentTask = { ...task, ...updatedTaskData };

    try {
      if (!this.config.repoUrl) {
        await appendLog(`> [Error] Execution requires a repository source. Please select a repository.\n`);
        await db.tasks.update(task.id, { workflowStatus: 'TODO', agentState: 'ERROR', agentId: undefined });
        return;
      }

      // Generate Protocol if not exists
      if (!currentTask?.protocol) {
        await appendLog(`> [Architect] Generating Task Protocol...\n`);
        const protocol = await this.moduleRequest(task.id, 'architect-codegen.generateProtocol', [task.title, task.description]);
        await db.tasks.update(task.id, { protocol });
        currentTask = { ...currentTask!, protocol };
        await appendLog(`> [Architect] Protocol generated with ${protocol.steps.length} steps.\n`);
      }

      await appendLog(`> [Orchestrator] Initializing Orchestrator...\n`);
      
      let status = 'DONE';
      
      const pendingStep = currentTask?.protocol?.steps.find(s => s.status === 'pending' || s.status === 'in_progress');
      
      if (pendingStep) {
        if (pendingStep.status === 'pending') {
          const updatedSteps = currentTask!.protocol!.steps.map(s => 
            s.id === pendingStep.id ? { ...s, status: 'in_progress' as const } : s
          );
          await db.tasks.update(task.id, { protocol: { ...currentTask!.protocol!, steps: updatedSteps } });
        }

        await this.runStep(task.id, pendingStep.id);
        
        const updatedTask = await db.tasks.get(task.id);
        if (updatedTask?.agentState === 'WAITING_FOR_USER' || updatedTask?.agentState === 'ERROR') {
          status = 'PAUSED';
        } else {
          const moreSteps = updatedTask?.protocol?.steps.some(s => s.status === 'pending');
          if (moreSteps) {
            status = 'PAUSED';
            await db.tasks.update(task.id, { agentState: 'IDLE' });
          } else {
            status = 'DONE';
          }
        }
      }
      
      await appendLog(`> [Orchestrator] Step execution complete. Status: ${status}\n`);
      
      let nextWorkflowStatus: WorkflowStatus = 'IN_REVIEW';
      let nextAgentState: AgentState = 'IDLE';
      
      if (status === 'PAUSED') {
        const updatedTask = await db.tasks.get(task.id);
        nextWorkflowStatus = updatedTask?.workflowStatus || 'IN_PROGRESS';
        nextAgentState = updatedTask?.agentState || 'WAITING_FOR_USER';
      } else if (status === 'DONE') {
        nextWorkflowStatus = 'IN_REVIEW';
        nextAgentState = 'IDLE';
      }

      await db.tasks.update(task.id, { 
        workflowStatus: nextWorkflowStatus,
        agentState: nextAgentState,
        agentId: 'local-agent'
      });
      
      return status;
    } catch (error: any) {
      const isSessionMissing = error.status === 404 || error.message?.includes('not found');
      const nextWorkflowStatus: WorkflowStatus = isSessionMissing ? 'TODO' : 'IN_REVIEW';
      const nextAgentState: AgentState = 'ERROR';
      
      await appendLog(`\n\n[FATAL ERROR] ${error.message}`);
      await db.tasks.update(task.id, { workflowStatus: nextWorkflowStatus, agentState: nextAgentState, agentId: undefined });
      throw error;
    }
  }
}

export const orchestrator = new Orchestrator();
