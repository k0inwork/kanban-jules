import { llmCall } from '../../core/llm';
import { db } from '../../services/db';
import { julesApi } from '../../lib/julesApi';
import { JulesSessionManager } from './JulesSessionManager';
import { eventBus } from '../../core/event-bus';
import { HostConfig } from '../../core/types';
import { TaskStateMachine } from '../../core/TaskStateMachine';

export class JulesPostman {
  private static instance: JulesPostman | null = null;
  private interval: any;
  private config: HostConfig;
  private activeTasks: Set<string> = new Set();
  private isPolling = false;

  static init(config: HostConfig) {
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

  constructor(config: HostConfig) {
    this.config = config;
  }

  start() {
    this.checkInitialTasks();
    eventBus.on('task:state_changed', this.handleStateChange);
  }

  stop() {
    eventBus.off('task:state_changed', this.handleStateChange);
    this.activeTasks.clear();
    this.stopPolling();
  }

  private handleStateChange = (data: any) => {
    if (data.newState.agentState === 'WAITING_FOR_EXECUTOR') {
      this.activeTasks.add(data.taskId);
      this.ensurePolling();
    } else {
      this.activeTasks.delete(data.taskId);
      if (this.activeTasks.size === 0) {
        this.stopPolling();
      }
    }
  }

  private async checkInitialTasks() {
    const tasks = await db.tasks.where('agentState').equals('WAITING_FOR_EXECUTOR').toArray();
    for (const task of tasks) {
      this.activeTasks.add(task.id);
    }
    if (this.activeTasks.size > 0) {
      this.ensurePolling();
    }
  }

  private ensurePolling() {
    if (!this.interval) {
      this.interval = setInterval(() => this.poll(), 5000);
    }
  }

  private stopPolling() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      if (!this.config) return;
      const julesConfig = this.config.moduleConfigs['executor-jules'] || {};
      const julesApiKey = julesConfig.julesApiKey;
      if (!julesApiKey) return;

      for (const taskId of this.activeTasks) {
        const task = await db.tasks.get(taskId);
        if (!task || task.agentState !== 'WAITING_FOR_EXECUTOR') {
          this.activeTasks.delete(taskId);
          if (this.activeTasks.size === 0) this.stopPolling();
          continue;
        }
      try {
        const session = await JulesSessionManager.findOrCreateSession(
          julesApiKey, 
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
          await JulesSessionManager.sendMessage(julesApiKey, session.name, task.pendingExecutorPrompt);
          await db.tasks.update(task.id, { pendingExecutorPrompt: undefined });
        }

        const activitiesRes = await julesApi.listActivities(julesApiKey, session.name, 10);
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
            const classificationPrompt = `Classify this message from a remote coding agent as SIGNAL or NOISE. 
                SIGNAL: The agent is asking a question, requesting feedback on a plan, or has finished the task.
                NOISE: The agent is just reporting progress or internal thoughts that don't require immediate user/supervisor attention.
                
                Message: "${content}"
                
                Return only "SIGNAL" or "NOISE".`;

            try {
              const classificationResult = await llmCall(this.config, classificationPrompt);
              category = (classificationResult.trim().toUpperCase() === 'SIGNAL') ? 'SIGNAL' : 'NOISE';
            } catch (e) {
              console.error(`[Postman] Classification failed:`, e);
              category = 'SIGNAL'; // Default to signal on error to be safe
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
                await db.tasks.update(t.id, { chat: updatedChat });
                await TaskStateMachine.dispatch(t.id, { type: 'EXECUTOR_REPLIED' });
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

        const currentSession = await julesApi.getSession(julesApiKey, session.name);
        await db.julesSessions.update(session.id, { status: currentSession.state });

        if (currentSession.state === 'COMPLETED' || currentSession.state === 'FAILED') {
          await db.julesSessions.update(session.id, { taskId: undefined });
          
          eventBus.emit('module:log', { taskId: task.id, moduleId: 'postman', message: `Session ${currentSession.state}.` });
          const t = await db.tasks.get(task.id);
          if (t) {
            await TaskStateMachine.dispatch(t.id, { type: 'EXECUTOR_REPLIED' });
          }
        }
        } catch (e: any) {
          console.error(`[Postman] Error polling session for task ${task.id}:`, e);
          if (e.status === 404 || e.message?.includes('not found')) {
            await db.julesSessions.where('taskId').equals(task.id).delete();
          }
        }
      }
    } finally {
      this.isPolling = false;
    }
  }
}
