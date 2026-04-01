import { GoogleGenAI } from '@google/genai';
import { db, Artifact } from './db';
import { Task } from '../types';
import { AgentConfig } from './LocalAgent';

export class ProcessAgent {
  private ai: GoogleGenAI;
  private config: AgentConfig;
  private repoUrl: string;
  private branch: string;

  constructor(ai: GoogleGenAI, config: AgentConfig, repoUrl: string, branch: string) {
    this.ai = ai;
    this.config = config;
    this.repoUrl = repoUrl;
    this.branch = branch;
  }

  async runReview(): Promise<void> {
    console.log('[ProcessAgent] Starting project review...');
    
    // 1. Get all tasks, artifacts, and unread messages
    const tasks = await db.tasks.toArray();
    const repoName = this.repoUrl.split('/').pop() || this.repoUrl;
    const artifacts = await db.taskArtifacts.where({ repoName, branchName: this.branch }).toArray();
    const unreadMessages = await db.messages.where('status').equals('unread').toArray();

    const context = {
      tasks: tasks.map(t => ({ title: t.title, status: t.status, description: t.description })),
      artifacts: artifacts.map(a => ({ name: a.name, content: a.content.substring(0, 500) })),
      unreadMessages: unreadMessages.map(m => ({ sender: m.sender, content: m.content, type: m.type }))
    };

    const prompt = `
      You are the Project Manager Agent for this Kanban board.
      Your goal is to analyze the current state of the project and propose new tasks if necessary.
      
      Current Tasks:
      ${JSON.stringify(context.tasks, null, 2)}
      
      Artifacts Produced:
      ${JSON.stringify(context.artifacts, null, 2)}

      Unread Messages in Mailbox:
      ${JSON.stringify(context.unreadMessages, null, 2)}
      
      Based on the artifacts (like design specs, research, or code analysis) and existing messages, what should be the next steps?
      
      RULES:
      1. If you see a "Design Spec" but no task to implement it, propose an "Implementation" task.
      2. If you see a "Code Analysis" with security findings, propose a "Security Fix" task.
      3. Do NOT propose tasks that are already on the board or have already been proposed in unread messages.
      4. If a message already contains a proposal you agree with, do not repeat it.
      
      Respond in JSON format:
      {
        "proposals": [
          {
            "type": "info" | "proposal" | "alert",
            "content": "Why are you suggesting this?",
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
