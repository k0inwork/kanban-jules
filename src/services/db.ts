import Dexie, { Table } from 'dexie';
import { Task } from '../types';

export interface GitCache {
  path: string;
  content: string;
  timestamp: number;
}

export interface Artifact {
  id?: number;
  taskId: string;
  repoName: string;
  branchName: string;
  name: string;
  content: string;
}

export interface ArtifactLink {
  id?: number;
  taskId: string;
  artifactId: number;
}

export interface JulesSession {
  id: string;
  name: string;
  title: string;
  taskId: string;
  status: string;
  createdAt: number;
  repoUrl?: string;
  branchName?: string;
}

export interface AgentMessage {
  id?: number;
  sender: string;
  taskId?: string;
  type: 'info' | 'proposal' | 'alert' | 'chat';
  category?: 'SIGNAL' | 'NOISE';
  content: string;
  activityName?: string;
  proposedTask?: {
    title: string;
    description: string;
  };
  status: 'unread' | 'read' | 'archived';
  timestamp: number;
  replyToId?: number;
}

export interface ProjectConfig {
  id: string; // repoUrl + branch
  constitution: string;
  updatedAt: number;
}

export class MyDatabase extends Dexie {
  gitCache!: Table<GitCache>;
  taskArtifacts!: Table<Artifact>;
  taskArtifactLinks!: Table<ArtifactLink>;
  julesSessions!: Table<JulesSession>;
  messages!: Table<AgentMessage>;
  tasks!: Table<Task>;
  projectConfigs!: Table<ProjectConfig>;

  constructor() {
    super('AgentKanbanDB');
    this.version(15).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id'
    });
    this.version(16).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id'
    }).upgrade(tx => {
      return tx.table('tasks').toCollection().modify(task => {
        if (!task.moduleLogs) task.moduleLogs = {};
        if (task.jnaLogs) {
          task.moduleLogs['executor-jules'] = task.jnaLogs;
          delete task.jnaLogs;
        }
        if (task.unaLogs) {
          task.moduleLogs['channel-user-negotiator'] = task.unaLogs;
          delete task.unaLogs;
        }
        delete task.pendingJulesPrompt;
        delete task.julesRetryCount;
      });
    });
    this.version(17).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id'
    }).upgrade(tx => {
      return tx.table('tasks').toCollection().modify(task => {
        if (!task.moduleLogs) task.moduleLogs = {};
        if (task.programmingLog) {
          task.moduleLogs['architect'] = (task.moduleLogs['architect'] || '') + task.programmingLog;
          delete task.programmingLog;
        }
        if (task.actionLog) {
          task.moduleLogs['orchestrator'] = (task.moduleLogs['orchestrator'] || '') + task.actionLog;
          delete task.actionLog;
        }
        if (task.logs) {
          task.moduleLogs['orchestrator'] = (task.moduleLogs['orchestrator'] || '') + task.logs;
          delete task.logs;
        }
      });
    });
  }
}

export const db = new MyDatabase();
