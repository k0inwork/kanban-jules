import { GoogleGenAI } from '@google/genai';
import { Task, TaskStep, WorkflowStatus, AgentState } from '../types';
import { registry } from './registry';
import { composeProgrammerPrompt } from './prompt';
import { eventBus } from './event-bus';
import { db } from '../services/db';
import { OrchestratorConfig } from './types';
import { generateTaskProtocol } from '../services/TaskArchitect';
import { JulesNegotiator } from '../services/negotiators/JulesNegotiator';
import { UserNegotiator } from '../services/negotiators/UserNegotiator';
import { ArtifactTool } from '../modules/knowledge-artifacts/ArtifactTool';
import { sandbox } from '../services/Sandbox';
import { globalVars } from '../services/GlobalVars';
import { injectBindings } from './sandbox';

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

    if (toolName === 'executor-jules.execute') {
      const [prompt, successCriteria] = args;
      if (prompt.includes('=undefined') || prompt.includes('=null')) {
        await this.logToChat(taskId, `[Error] Attempted to call Jules with undefined or null data in prompt: ${prompt}`);
        throw new Error("Attempted to call Jules with undefined or null data. Please ensure all variables are defined before calling askJules.");
      }
      await this.logToChat(taskId, `Calling Subagent: JNA with args: ["${prompt}", "${successCriteria}"]`);
      const task = await db.tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      return await JulesNegotiator.negotiate(
        this.config.julesApiKey,
        task,
        this.config.repoUrl,
        this.config.repoBranch,
        prompt,
        successCriteria,
        async (julesOutput: string, criteria: string) => {
          const verifyPrompt = `
            You are a Verification Agent.
            Success Criteria: ${criteria}
            Jules Output: ${julesOutput}
            Did Jules successfully meet the criteria? 
            If YES, reply with exactly "YES".
            If NO, reply with "NO".
          `;
          const vText = await this.callLlm(verifyPrompt);
          return vText.trim().startsWith('YES');
        }
      );
    }

    if (toolName === 'channel-user-negotiator.askUser') {
      const [question, format] = args;
      await this.logToChat(taskId, `Calling Subagent: UNA with args: ["${question}", "${format || 'none'}"]`);
      const rawReply = await UserNegotiator.negotiate(taskId, question);
      
      if (!format) return rawReply;

      const validationPrompt = `
        You are a Data Validation and Conversion Agent.
        Question: ${question}
        Format/Constraint: ${format}
        User Input: ${rawReply}
        
        If the input satisfies the format, return the input (or the converted value if requested).
        If the input does not satisfy the format, return "ERROR: <reason>".
        Return ONLY the result or the error message.
      `;
      
      const validatedReply = await this.callLlm(validationPrompt);
      await this.logToChat(taskId, `UNA Validation Result: ${validatedReply}`);
      
      if (validatedReply.startsWith('ERROR:')) {
        throw new Error(validatedReply);
      }
      return validatedReply;
    }

    if (toolName === 'knowledge-artifacts.listArtifacts') {
      const [tId, repoName, branchName, requestingTaskId] = args;
      return ArtifactTool.listArtifacts(
        tId || taskId,
        repoName || this.config.repoUrl.split('/').pop() || this.config.repoUrl,
        branchName || this.config.repoBranch,
        requestingTaskId
      );
    }

    if (toolName === 'knowledge-artifacts.saveArtifact') {
      const [name, content] = args;
      return ArtifactTool.saveArtifact(
        taskId,
        this.config.repoUrl.split('/').pop() || this.config.repoUrl,
        this.config.repoBranch,
        name,
        content
      );
    }

    if (toolName === 'knowledge-artifacts.readArtifact') {
      const [name] = args;
      return ArtifactTool.readArtifact(name);
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  private async logToChat(taskId: string, message: string) {
    const task = await db.tasks.get(taskId);
    if (task) {
      const newChat = (task.chat || '') + `\n> [Orchestrator] ${message}\n`;
      await db.tasks.update(taskId, { chat: newChat });
    }
  }

  private async appendActionLog(taskId: string, msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `> [${timestamp}] ${msg}\n`;
    const task = await db.tasks.get(taskId);
    if (task) {
      await db.tasks.update(taskId, {
        actionLog: (task.actionLog || '') + logEntry
      });
    }
  }

  private async appendProgrammingLog(taskId: string, msg: string) {
    const task = await db.tasks.get(taskId);
    if (task) {
      await db.tasks.update(taskId, {
        programmingLog: (task.programmingLog || '') + msg + '\n'
      });
    }
  }

  private async callLlm(prompt: string): Promise<string> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    if (this.config.apiProvider === 'gemini') {
      if (!this.ai) throw new Error("AI not initialized");
      const response = await this.ai.models.generateContent({
        model: this.config.geminiModel,
        contents: prompt,
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

  async runStep(taskId: string, stepId: number): Promise<void> {
    if (!this.config) throw new Error("Orchestrator not initialized");

    const task = await db.tasks.get(taskId);
    if (!task || !task.protocol) return;

    const step = task.protocol.steps.find(s => s.id === stepId);
    if (!step) return;

    await this.logToChat(taskId, `Starting execution for Step ${stepId}: ${step.title}`);
    await this.appendActionLog(taskId, `Started Step ${stepId}`);

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
      
      const modules = registry.getAll();
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
        await this.appendProgrammingLog(taskId, `Step ${stepId} (Attempt ${attempt}) - code:\n"${code}"`);

        await this.executeInSandbox(taskId, code, stepId);
        return;

      } catch (error: any) {
        await this.logToChat(taskId, `Error generating or executing code: ${error.message}`);
        await this.appendActionLog(taskId, `Error in Step ${stepId}: ${error.message}`);
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

    this.context.accumulatedAnalysis = [];
    injectBindings(sandbox, (toolName, args) => this.moduleRequest(taskId, toolName, args), this.context);

    try {
      const result = await sandbox.execute(code);
      await this.logToChat(taskId, `Execution Success. Result: ${JSON.stringify(result)}`);
      
      await db.tasks.update(taskId, { 
        globalVars: globalVars.getAll(),
        analysis: (this.context.accumulatedAnalysis.length > 0) ? this.context.accumulatedAnalysis.join('\n') : undefined
      });
      
      const task = await db.tasks.get(taskId);
      if (task && task.protocol) {
        const updatedSteps = task.protocol.steps.map(s => 
          s.id === stepId ? { ...s, status: 'completed' as const } : s
        );
        await db.tasks.update(taskId, { protocol: { ...task.protocol, steps: updatedSteps } });
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
    const updatedTaskData = { 
      workflowStatus: 'IN_PROGRESS' as WorkflowStatus,
      agentState: 'EXECUTING' as AgentState,
      agentId: task.agentId || 'jules-agent', 
      logs: isResuming ? task.logs : (task.logs ? task.logs + '\n\n---\n\n' : '') + '> Initializing Agent Session...\n' 
    };
    await db.tasks.update(task.id, updatedTaskData);
    let currentTask = { ...task, ...updatedTaskData };

    try {
      if (!this.config.julesApiKey) {
        throw new Error("Jules API Key is required to use the real Jules API. Please configure it in Settings.");
      }

      if (!this.config.repoUrl) {
        await appendLog(`> [Error] Execution requires a repository source. Please select a repository.\n`);
        await db.tasks.update(task.id, { workflowStatus: 'TODO', agentState: 'ERROR', agentId: undefined });
        return;
      }

      // Generate Protocol if not exists
      if (!currentTask?.protocol) {
        await appendLog(`> [Architect] Generating Task Protocol...\n`);
        const protocol = await generateTaskProtocol(
          task.title,
          task.description,
          this.config.apiProvider,
          this.config.geminiModel,
          this.config.openaiUrl,
          this.config.openaiKey,
          this.config.openaiModel,
          this.config.geminiApiKey || ''
        );
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
