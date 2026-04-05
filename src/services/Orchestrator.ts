import { GoogleGenAI } from '@google/genai';
import { db } from './db';
import { Task } from '../types';

import { JulesNegotiator } from './negotiators/JulesNegotiator';
import { UserNegotiator } from './negotiators/UserNegotiator';
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
        
        You have access to a persistent GlobalVars object (a standard JS object) to store state across steps.
        Current GlobalVars: ${JSON.stringify(globalVars.getAll())}
        
        You have access to the following async Subagent functions:
        - await askJules(prompt: string, successCriteria: string): Delegates repository/CLI work to Jules.
        - await askUser(question: string): Asks the user a question and waits for their reply.
        
        ${errorContext ? `\nPREVIOUS EXECUTION FAILED:\n${errorContext}\nPlease rewrite the code to fix this error, handle it gracefully, or use askUser() to request human intervention.\n` : ''}
        
        Write ONLY valid JavaScript code. Do not include markdown formatting like \`\`\`javascript.
        The code will be executed in an async context. You can use await.
        Return the final result of the step, or update GlobalVars.
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
    sandbox.injectAPI('askJules', async (prompt: string, successCriteria: string) => {
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

    sandbox.injectAPI('askUser', async (question: string) => {
      await this.logToChat(`Calling Subagent: UNA with args: ["${question}"]`);
      return await UserNegotiator.negotiate(this.taskId, question);
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
