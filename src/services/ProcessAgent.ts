import { GoogleGenAI } from '@google/genai';
import { db, Artifact } from './db';
import { Task } from '../types';
import { OrchestratorConfig } from './Orchestrator';

export class ProcessAgent {
  private ai: GoogleGenAI;
  private config: OrchestratorConfig;
  private repoUrl: string;
  private branch: string;

  constructor(ai: GoogleGenAI, config: OrchestratorConfig, repoUrl: string, branch: string) {
    this.ai = ai;
    this.config = config;
    this.repoUrl = repoUrl;
    this.branch = branch;
  }

  private async logToChat(taskId: string, message: string) {
    const task = await db.tasks.get(taskId);
    if (task) {
      const newChat = (task.chat || '') + `\n> [Agent] ${message}\n`;
      await db.tasks.update(taskId, { chat: newChat });
    }
  }

  async runReview(): Promise<void> {
    console.log('[ProcessAgent] Starting project review...');
    
    // 1. Get all tasks, artifacts, and unread messages
    const tasks = await db.tasks.toArray();
    const repoName = this.repoUrl.split('/').pop() || this.repoUrl;
    let artifacts = await db.taskArtifacts.where({ repoName, branchName: this.branch }).toArray();
    artifacts = artifacts.filter(a => !a.name || !a.name.startsWith('_'));
    const unreadMessages = await db.messages.where('status').equals('unread').toArray();
    
    // Load Constitution
    const configId = `${this.repoUrl}:${this.branch}`;
    const config = await db.projectConfigs.get(configId);
    const constitution = config?.constitution || 'No specific project rules defined.';

    const context = {
      tasks: tasks.map(t => ({ title: t.title, workflowStatus: t.workflowStatus, agentState: t.agentState, description: t.description })),
      artifacts: artifacts.map(a => ({ name: a.name, content: (a.content || '').substring(0, 500) })),
      unreadMessages: unreadMessages.map(m => ({ sender: m.sender, content: m.content, type: m.type })),
      constitution
    };

    const prompt = `
      You are the Project Manager Agent for this Kanban board.
      Your goal is to analyze the current state of the project and propose new tasks if necessary.
      
      PROJECT CONSTITUTION (Rules and Stage-Artifact Mapping):
      ${context.constitution}

      Current Tasks:
      ${JSON.stringify(context.tasks, null, 2)}
      
      Artifacts Produced:
      ${JSON.stringify(context.artifacts, null, 2)}

      Unread Messages in Mailbox:
      ${JSON.stringify(context.unreadMessages, null, 2)}
      
      Based on the artifacts (like design specs, research, or code analysis), existing messages, and the PROJECT CONSTITUTION, what should be the next steps?
      
      ANALYSIS STEPS:
      1. Identify the current PROJECT STAGE based on the artifacts present and the mapping in the CONSTITUTION.
      2. Determine if any required artifacts for the current or previous stages are missing.
      3. Propose tasks that move the project to the next stage or fill gaps in the current stage.

      RULES:
      1. If you see a "Design Spec" but no task to implement it, propose an "Implementation" task.
      2. If you see a "Code Analysis" with security findings, propose a "Security Fix" task.
      3. Do NOT propose tasks that are already on the board or have already been proposed in unread messages.
      4. If a message already contains a proposal you agree with, do not repeat it.
      5. Strictly adhere to the PROJECT CONSTITUTION provided above.
      
      Respond in JSON format:
      {
        "proposals": [
          {
            "type": "info" | "proposal" | "alert",
            "content": "Why are you suggesting this? (e.g., 'We are in the Design stage, but the Testing Spec is missing.')",
            "proposedTask": {
              "title": "Task Title",
              "description": "Detailed description of what needs to be done"
            }
          }
        ]
      }
      
      If no new tasks are needed, return an empty list of proposals.
    `;

    try {
      if (this.config.apiProvider === 'gemini' && !this.config.geminiApiKey) {
        throw new Error("Gemini API Key is missing for ProcessAgent.");
      }
      if (this.config.apiProvider === 'openai' && !this.config.openaiKey) {
        throw new Error("OpenAI API Key is missing for ProcessAgent.");
      }

      let responseText = '';
      if (this.config.apiProvider === 'gemini') {
        const response = await this.ai.models.generateContent({
          model: this.config.geminiModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' }
        });
        responseText = response.text || '{}';
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
            response_format: { type: 'json_object' }
          })
        });
        const data = await response.json();
        responseText = data.choices[0].message.content || '{}';
      }

      const result = JSON.parse(responseText);
      if (result.proposals && result.proposals.length > 0) {
        for (const prop of result.proposals) {
          await db.messages.add({
            sender: 'process-agent',
            type: prop.type,
            content: prop.content,
            proposedTask: prop.proposedTask,
            status: 'unread',
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.error('[ProcessAgent] Review failed:', error);
    }
  }
}
