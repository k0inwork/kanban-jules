import { db } from '../services/db';
import { Task, WorkflowStatus, AgentState } from '../types';
import { eventBus } from './event-bus';

export type TaskEventType = 
  | 'START' 
  | 'PAUSE' 
  | 'STOP' 
  | 'COMPLETE' 
  | 'REQUIRE_USER_INPUT' 
  | 'USER_REPLIED' 
  | 'REQUIRE_EXECUTOR' 
  | 'EXECUTOR_REPLIED' 
  | 'ERROR' 
  | 'FATAL_ERROR';

export interface TaskEvent {
  type: TaskEventType;
  payload?: any;
}

export class TaskStateMachine {
  /**
   * Dispatches an event to transition a task's state.
   * This centralizes all workflowStatus and agentState mutations.
   */
  static async dispatch(taskId: string, event: TaskEvent): Promise<Task | null> {
    const task = await db.tasks.get(taskId);
    if (!task) return null;

    let nextWorkflowStatus: WorkflowStatus = task.workflowStatus;
    let nextAgentState: AgentState = task.agentState;
    let updates: Partial<Task> = {};

    switch (event.type) {
      case 'START':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'EXECUTING';
        break;
      case 'PAUSE':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'PAUSED';
        break;
      case 'STOP':
        nextWorkflowStatus = 'TODO';
        nextAgentState = 'IDLE';
        updates.agentId = undefined;
        break;
      case 'COMPLETE':
        nextWorkflowStatus = 'DONE';
        nextAgentState = 'IDLE';
        break;
      case 'REQUIRE_USER_INPUT':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'WAITING_FOR_USER';
        break;
      case 'USER_REPLIED':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'IDLE'; // Ready to be picked up by the orchestrator loop
        break;
      case 'REQUIRE_EXECUTOR':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'WAITING_FOR_EXECUTOR';
        if (event.payload?.prompt) {
          updates.pendingExecutorPrompt = event.payload.prompt;
        }
        break;
      case 'EXECUTOR_REPLIED':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'IDLE';
        updates.pendingExecutorPrompt = undefined;
        break;
      case 'ERROR':
        nextWorkflowStatus = 'IN_PROGRESS';
        nextAgentState = 'ERROR';
        break;
      case 'FATAL_ERROR':
        nextWorkflowStatus = event.payload?.isSessionMissing ? 'TODO' : 'IN_REVIEW';
        nextAgentState = 'ERROR';
        updates.agentId = undefined;
        break;
    }

    // Only update if something actually changed to avoid unnecessary DB writes
    if (nextWorkflowStatus !== task.workflowStatus || nextAgentState !== task.agentState || Object.keys(updates).length > 0) {
      updates.workflowStatus = nextWorkflowStatus;
      updates.agentState = nextAgentState;

      await db.tasks.update(taskId, updates);
      const updatedTask = await db.tasks.get(taskId);
      
      eventBus.emit('task:state_changed', { 
        taskId, 
        previousState: { workflowStatus: task.workflowStatus, agentState: task.agentState },
        newState: { workflowStatus: nextWorkflowStatus, agentState: nextAgentState },
        event: event.type
      });

      return updatedTask!;
    }

    return task;
  }
}
