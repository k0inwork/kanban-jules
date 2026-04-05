/**
 * File: /src/services/Orchestrator.ts
 * Description: Task execution orchestrator.
 * Responsibility: Manages the lifecycle of a task execution step, including code generation, sandbox execution, and subagent delegation.
 */
import { GoogleGenAI } from '@google/genai';
import { db } from './db';
import { Task } from '../types';

import { JulesNegotiator } from './negotiators/JulesNegotiator';
import { UserNegotiator } from './negotiators/UserNegotiator';
import { ArtifactTool } from './ArtifactTool';
import { sandbox } from './Sandbox';
import { globalVars } from './GlobalVars';

export interface OrchestratorConfig {
  apiProvider: string;
  geminiModel: string;
  openaiUrl: string;
  openaiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  julesApiKey: string;
  repoUrl: string;
  repoBranch: string;
}

export class Orchestrator {
  private ai: GoogleGenAI;
  private config: OrchestratorConfig;
  private taskId: string;

  constructor(ai: GoogleGenAI, taskId: string, config: OrchestratorConfig) {
    this.ai = ai;
    this.taskId = taskId;
    this.config = config;
  }

  private async logToChat(message: string) {
    const task = await db.tasks.get(this.taskId);
    if (task) {
      const newChat = (task.chat || '') + `\n> [Orchestrator] ${message}\n`;
      await db.tasks.update(this.taskId, { chat: newChat });
    }
  }

  private async appendActionLog(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `> [${timestamp}] ${msg}\n`;
    const task = await db.tasks.get(this.taskId);
    if (task) {
      await db.tasks.update(this.taskId, {
        actionLog: (task.actionLog || '') + logEntry
      });
    }
  }

  private async appendProgrammingLog(msg: string) {
    const task = await db.tasks.get(this.taskId);
    if (task) {
      await db.tasks.update(this.taskId, {
        programmingLog: (task.programmingLog || '') + msg + '\n'
      });
    }
  }

  private async callLlm(prompt: string): Promise<string> {
    if (this.config.apiProvider === 'gemini') {
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

  async runStep(stepId: number): Promise<void> {
    const task = await db.tasks.get(this.taskId);
    if (!task || !task.protocol) return;

    const step = task.protocol.steps.find(s => s.id === stepId);
    if (!step) return;

    await this.logToChat(`Starting execution for Step ${stepId}: ${step.title}`);
    await this.appendActionLog(`Started Step ${stepId}`);

    // Load GlobalVars into the sandbox registry
    globalVars.clear();
    if (task.globalVars) {
      for (const [k, v] of Object.entries(task.globalVars)) {
        globalVars.set(k, v);
      }
    }

    let errorContext = '';
    let attempt = 0;
    const maxAttempts = 5; // Hard limit failsafe

    while (attempt < maxAttempts) {
      attempt++;
      
      // 1. Generate JS Code
      const prompt = `
        You are the Main Architect. Your job is to write executable JavaScript code to accomplish the following protocol step.
        
        Task Title: ${task.title}
        Task Description: ${task.description}
        
        Current Step: ${step.title}
        Step Description: ${step.description}
        
        You have access to a persistent GlobalVars object to store state across steps.
        Use GlobalVars.set(key, value) to store data and GlobalVars.get(key) to retrieve it.
        Current GlobalVars: ${JSON.stringify(globalVars.getAll())}
        
        You have access to the following async Subagent functions:
        - await askJules(prompt: string, successCriteria: string): Delegates repository/CLI work to Jules. 
          CRITICAL: Jules has NO access to local state (GlobalVars or Artifacts). 
          To use local data in Jules, you MUST explicitly pass the data in the prompt: "JULES: The following data is available: <varName>=<value>. Please perform <operation> using this value and explicitly return the result."
          Jules will return the result as a string. You MUST then locally store this result in GlobalVars using GlobalVars.set().
          CRITICAL: Before calling askJules, verify that the local variables you are passing are not 'undefined' or 'null'. If they are, you must first retrieve them from GlobalVars or ask the user for the missing information.
        - await askUser(question: string, format?: string): Asks the user a question and waits for their reply. If a format is provided (e.g., "must be a number"), the system will automatically validate and convert the user's input. If validation fails, it throws an error.
        
        You have access to the following local state management:
        - GlobalVars: A persistent object to store state across steps. Use GlobalVars.set(key, value) and GlobalVars.get(key).
        - Artifacts: Use Artifacts.saveArtifact, Artifacts.readArtifact, and Artifacts.listArtifacts to manage task-specific, local artifacts. These are local to the task and never shared.
        
        ${errorContext ? `\nPREVIOUS EXECUTION FAILED:\n${errorContext}\nPlease rewrite the code to fix this error, handle it gracefully, or use askUser() to request human intervention.\n` : ''}
        
        Write ONLY valid JavaScript code. Do not include markdown formatting like \`\`\`javascript.
        The code will be executed in an async context. You can use await.
        Return the final result of the step, or update GlobalVars.
        
        IMPORTANT: Do not use local files or artifacts to store intermediate data in Jules. Always use GlobalVars for cross-step state and Artifacts for local, task-specific storage.
        For Jules steps, follow the pattern:
        1. Retrieve local data from GlobalVars using GlobalVars.get(key).
        2. Verify that the retrieved data is not undefined or null.
        3. Call askJules() with the data explicitly passed in the prompt.
        4. Store the result returned by askJules() back into GlobalVars using GlobalVars.set(key, value).
      `;

      try {
        let code = await this.callLlm(prompt);
        
        // Extract code from markdown block if present
        const codeMatch = code.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/i);
        if (codeMatch) {
          code = codeMatch[1].trim();
        } else {
          // Fallback to basic cleanup
          code = code.replace(/^\`\`\`(?:javascript|js)?\n/i, '').replace(/\n\`\`\`$/i, '').trim();
        }
        
        await this.logToChat(`Generated Code (Attempt ${attempt}):\n\`\`\`javascript\n${code}\n\`\`\``);
        await this.appendProgrammingLog(`Step ${stepId} (Attempt ${attempt}) - code:\n"${code}"`);

        // 2. Execute Code in Sandbox
        await this.executeInSandbox(code, stepId);
        
        // If we reach here, execution succeeded
        return;

      } catch (error: any) {
        await this.logToChat(`Error generating or executing code: ${error.message}`);
        await this.appendActionLog(`Error in Step ${stepId}: ${error.message}`);
        errorContext = error.message + (error.stack ? `\n${error.stack}` : '');
      }
    }
    
    // If we exhausted attempts
    await this.logToChat(`Failed to complete step after ${maxAttempts} attempts. Pausing task.`);
    await db.tasks.update(this.taskId, { 
      workflowStatus: 'IN_PROGRESS',
      agentState: 'ERROR' 
    });
  }

  private async executeInSandbox(code: string, stepId: number): Promise<void> {
    // Inject Subagent APIs
    sandbox.injectAPI('Artifacts', {
      listArtifacts: (taskId?: string, repoName?: string, branchName?: string, requestingTaskId?: string) =>
        ArtifactTool.listArtifacts(taskId || this.taskId, repoName || this.config.repoUrl.split('/').pop() || this.config.repoUrl, branchName || this.config.repoBranch, requestingTaskId),
      readArtifact: ArtifactTool.readArtifact,
      saveArtifact: (name: string, content: string) =>
        ArtifactTool.saveArtifact(this.taskId, this.config.repoUrl.split('/').pop() || this.config.repoUrl, this.config.repoBranch, name, content)
    });

    sandbox.injectAPI('askJules', async (prompt: string, successCriteria: string) => {
      if (prompt.includes('=undefined') || prompt.includes('=null')) {
        await this.logToChat(`[Error] Attempted to call Jules with undefined or null data in prompt: ${prompt}`);
        throw new Error("Attempted to call Jules with undefined or null data. Please ensure all variables are defined before calling askJules.");
      }
      await this.logToChat(`Calling Subagent: JNA with args: ["${prompt}", "${successCriteria}"]`);
      const task = await db.tasks.get(this.taskId);
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
    });

    sandbox.injectAPI('askUser', async (question: string, format?: string) => {
      await this.logToChat(`Calling Subagent: UNA with args: ["${question}", "${format || 'none'}"]`);
      const rawReply = await UserNegotiator.negotiate(this.taskId, question);
      
      if (!format) return rawReply;

      // Validate/Convert using LLM
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
      await this.logToChat(`UNA Validation Result: ${validatedReply}`);
      
      if (validatedReply.startsWith('ERROR:')) {
        throw new Error(validatedReply);
      }
      return validatedReply;
    });

    try {
      const result = await sandbox.execute(code);
      await this.logToChat(`Execution Success. Result: ${JSON.stringify(result)}`);
      
      // Update GlobalVars in DB
      await db.tasks.update(this.taskId, { globalVars: globalVars.getAll() });
      
      // Mark step as completed
      const task = await db.tasks.get(this.taskId);
      if (task && task.protocol) {
        const updatedSteps = task.protocol.steps.map(s => 
          s.id === stepId ? { ...s, status: 'completed' as const } : s
        );
        await db.tasks.update(this.taskId, { protocol: { ...task.protocol, steps: updatedSteps } });
      }
    } catch (error: any) {
      throw error;
    }
  }
}
