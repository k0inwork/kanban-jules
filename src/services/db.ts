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
  type?: string;
  metadata?: any;
  createdAt?: number;
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

export interface ModuleKnowledge {
  id: string; // e.g., 'executor-github', 'executor-jules'
  content: string;
  updatedAt: number;
}

export interface KBEntry {
  id?: number;
  timestamp: number;
  text: string;
  category: string; // 'architecture' | 'decision' | 'error' | 'pattern' | 'executor' | 'constitution' | 'observation' | 'dream' | 'correction' | 'external'
  abstraction: number; // 0=raw, 5=synthesized, 10=strategic
  layer: string[]; // ['L0'] | ['L1'] | ['L2'] | ['L0','L1'] | ...
  tags: string[];
  source: string; // 'execution' | 'dream:micro' | 'dream:session' | 'dream:deep' | 'user' | 'external:*'
  supersedes?: number[];
  active: boolean;
  project: string; // 'self' | 'target' (default: 'target')
}

export interface KBDoc {
  id?: number;
  timestamp: number;
  title: string;
  type: string; // 'spec' | 'design' | 'report' | 'reference' | 'constitution' | 'readme' | 'meeting-notes'
  content: string;
  summary: string;
  tags: string[];
  layer: string[];
  source: string; // 'upload' | 'artifact' | 'repo-scan' | 'external:*'
  active: boolean;
  version: number;
  project: string; // 'self' | 'target' (default: 'target')
}

export class MyDatabase extends Dexie {
  gitCache!: Table<GitCache>;
  taskArtifacts!: Table<Artifact>;
  taskArtifactLinks!: Table<ArtifactLink>;
  julesSessions!: Table<JulesSession>;
  messages!: Table<AgentMessage>;
  tasks!: Table<Task>;
  projectConfigs!: Table<ProjectConfig>;
  moduleKnowledge!: Table<ModuleKnowledge>;
  kbLog!: Table<KBEntry>;
  kbDocs!: Table<KBDoc>;

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
    this.version(18).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id'
    }).upgrade(tx => {
      return tx.table('tasks').toCollection().modify(task => {
        if (task.globalVars) {
          task.agentContext = task.globalVars;
          delete task.globalVars;
        }
      });
    });
    this.version(19).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id'
    });
    this.version(20).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project',
      kbDocs: '++id, timestamp, type, active, source, project'
    });
    this.version(21).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project',
      kbDocs: '++id, timestamp, title, type, active, source, project'
    });
  }
}

export const db = new MyDatabase();
