import { GoogleGenAI } from '@google/genai';
import { db } from '../../services/db';
import { julesApi } from '../../lib/julesApi';
import { JulesSessionManager } from './JulesSessionManager';
import { JulesConfig } from './types';
import { eventBus } from '../../core/event-bus';

export class JulesPostman {
  private static instance: JulesPostman | null = null;
  private interval: any;
  private config: JulesConfig;

  static init(config: JulesConfig) {
    if (this.instance) this.instance.stop();
    this.instance = new JulesPostman(config);
    this.instance.start();
  }

  static destroy() {
    if (this.instance) {
      this.instance.stop();
      this.instance = null;
    }
  }

  constructor(config: JulesConfig) {
    this.config = config;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.poll(), 5000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    if (!this.config.julesApiKey) return;

    const tasks = await db.tasks.where('agentState').equals('WAITING_FOR_EXECUTOR').toArray();
    for (const task of tasks) {
      try {
        const session = await JulesSessionManager.findOrCreateSession(
          this.config.julesApiKey, 
          task, 
          this.config.repoUrl || '', 
          this.config.repoBranch || '', 
          'Fleet Orchestrator'
        );
        if (!session) continue;

        eventBus.emit('module:log', { taskId: task.id, moduleId: 'postman', message: `Polling session ${session.name}` });

        if (task.pendingExecutorPrompt) {
          console.log(`[Postman] Sending pending prompt to Executor for task ${task.id}`);
          eventBus.emit('module:log', { taskId: task.id, moduleId: 'postman', message: `Sending pending prompt to Executor: ${task.pendingExecutorPrompt.substring(0, 50)}...` });
          await JulesSessionManager.sendMessage(this.config.julesApiKey, session.name, task.pendingExecutorPrompt);
          await db.tasks.update(task.id, { pendingExecutorPrompt: undefined });
        }

        const activitiesRes = await julesApi.listActivities(this.config.julesApiKey, session.name, 10);
        const activities = activitiesRes.activities || [];
        
        for (const activity of activities) {
          const existingMsg = await db.messages.where('activityName').equals(activity.name).first();
          if (existingMsg) continue;

          let category: 'SIGNAL' | 'NOISE' = 'NOISE';
          let content = '';
          let type: 'info' | 'chat' | 'alert' = 'info';

          if (activity.agentMessaged) {
            const rawContent = activity.agentMessaged.agentMessage;
            
            eventBus.emit('module:log', { taskId: task.id, moduleId: 'postman', message: `New activity: agentMessaged` });
            
            content = rawContent;
            type = 'chat';
            
            // Classify agent message
            if (this.config.apiProvider === 'gemini') {
              const ai = new GoogleGenAI({ apiKey: this.config.geminiApiKey });
              const classification = await ai.models.generateContent({
                model: this.config.geminiModel,
                contents: `Classify this message from a remote coding agent as SIGNAL or NOISE. 
                SIGNAL: The agent is asking a question, requesting feedback on a plan, or has finished the task.
                NOISE: The agent is just reporting progress or internal thoughts that don't require immediate user/supervisor attention.
                
                Message: "${content}"
                
                Return only "SIGNAL" or "NOISE".`,
              });
              category = (classification.text?.trim().toUpperCase() === 'SIGNAL') ? 'SIGNAL' : 'NOISE';
            } else {
              const response = await fetch(`${this.config.openaiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${this.config.openaiKey}`
                },
                body: JSON.stringify({
                  model: this.config.openaiModel,
                  messages: [{ role: 'user', content: `Classify this message from a remote coding agent as SIGNAL or NOISE. 
                SIGNAL: The agent is asking a question, requesting feedback on a plan, or has finished the task.
                NOISE: The agent is just reporting progress or internal thoughts that don't require immediate user/supervisor attention.
                
                Message: "${content}"
                
                Return only "SIGNAL" or "NOISE".` }],
                  temperature: 0.1
                })
              });
              if (response.ok) {
                const data = await response.json();
                category = (data.choices[0].message.content?.trim().toUpperCase() === 'SIGNAL') ? 'SIGNAL' : 'NOISE';
              }
            }
          } else if (activity.progressUpdated) {
            content = `Progress: ${activity.progressUpdated.title}`;
            category = 'NOISE';
          } else if (activity.planGenerated) {
            content = `Plan Generated: ${activity.planGenerated.plan.steps.map((s: any) => s.title).join(', ')}`;
            category = 'SIGNAL';
            type = 'alert';
          }

          if (content) {
            await db.messages.add({
              sender: `Jules (${session.name})`,
              taskId: task.id,
              type,
              category,
              content,
              activityName: activity.name,
              status: 'unread',
              timestamp: new Date(activity.createTime).getTime()
            });

            if (category === 'SIGNAL') {
              const chatMsg = `\n\n> [Jules - ${new Date().toLocaleTimeString()}] ${content}\n`;
              const t = await db.tasks.get(task.id);
              if (t) {
                const updatedChat = (t.chat || '') + chatMsg;
                await db.tasks.update(t.id, { chat: updatedChat, agentState: 'IDLE' });
              }
            }
          }
          
          await db.messages.add({
            sender: 'system',
            taskId: task.id,
            type: 'info',
            content: JSON.stringify(activity),
            status: 'read',
            timestamp: Date.now()
          });
        }

        const currentSession = await julesApi.getSession(this.config.julesApiKey, session.name);
        await db.julesSessions.update(session.id, { status: currentSession.state });

        if (currentSession.state === 'COMPLETED' || currentSession.state === 'FAILED') {
          await db.julesSessions.update(session.id, { taskId: undefined });
          
          eventBus.emit('module:log', { taskId: task.id, moduleId: 'postman', message: `Session ${currentSession.state}.` });
          const t = await db.tasks.get(task.id);
          if (t) {
            await db.tasks.update(t.id, { agentState: 'EXECUTING' });
          }
        }
      } catch (e: any) {
        console.error(`[Postman] Error polling session for task ${task.id}:`, e);
        if (e.status === 404 || e.message?.includes('not found')) {
          await db.julesSessions.where('taskId').equals(task.id).delete();
        }
      }
    }
  }
}
