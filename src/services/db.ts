import Dexie, { Table } from 'dexie';
import { Task } from '../types';

export interface GitCache {
  path: string;
  content: string;
  timestamp: number;
}

export type ArtifactStatus = 'draft' | 'in_review' | 'revised' | 'approved';

export interface Artifact {
  id?: number;
  taskId: string;
  repoName: string;
  branchName: string;
  name: string;
  content: string;
  type?: string;
  status?: ArtifactStatus;
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
  category: string; // 'error' | 'observation' | 'insight' | 'decision' | 'correction'
  abstraction: number; // 0=raw, 5=synthesized, 10=strategic
  layer: string[]; // ['L0'] | ['L1'] | ['L2'] | ['L0','L1'] | ...
  tags: string[];
  source: string; // 'execution' | 'dream:micro' | 'dream:session' | 'dream:deep' | 'user' | 'external:*'
  supersedes?: number[];
  active: boolean;
  project: string; // 'self' | 'target' (default: 'target')
}

export interface PushQueueItem {
  id?: number;
  dir: string;        // Lightning-FS directory to push from
  branch: string;     // branch name to push
  repoUrl: string;    // remote URL
  token: string;      // auth token
  status: 'pending' | 'pushing' | 'failed';
  error?: string;
  timestamp: number;
  taskId?: string;
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

export interface YuanHistory {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Project {
  id: string;           // uuid, primary key
  name: string;
  repoUrl: string;
  repoBranch: string;
  constitution: string; // full text, may be empty
  createdAt: number;
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
  moduleKnowledge!: Table<ModuleKnowledge>;
  kbLog!: Table<KBEntry>;
  kbDocs!: Table<KBDoc>;
  pushQueue!: Table<PushQueueItem>;
  yuanHistory!: Table<YuanHistory>;
  projects!: Table<Project>;

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
    this.version(22).stores({
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
    }).upgrade(tx => {
      return tx.table('kbLog').toCollection().modify(entry => {
        const tagSet = new Set(entry.tags || []);
        if (entry.category === 'dream') {
          entry.category = 'insight';
          tagSet.add('consolidation');
        } else if (entry.category === 'pattern') {
          entry.category = 'insight';
        } else if (entry.category === 'constitution') {
          entry.category = 'decision';
          tagSet.add('constitution-amendment');
        } else if (entry.category === 'execution') {
          entry.category = 'observation';
          tagSet.add('execution');
        }
        entry.tags = [...tagSet];
      });
    });
    this.version(23).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project',
      kbDocs: '++id, timestamp, title, type, active, source, project',
      pushQueue: '++id, branch, status, timestamp'
    });
    this.version(24).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName, status',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project',
      kbDocs: '++id, timestamp, title, type, active, source, project',
      pushQueue: '++id, branch, status, timestamp',
      yuanHistory: '++id, role, timestamp'
    }).upgrade(tx => {
      return tx.table('taskArtifacts').toCollection().modify(artifact => {
        if (!artifact.status) artifact.status = 'draft';
      });
    });
    this.version(25).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName, status',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp',
      tasks: 'id, workflowStatus, agentState, createdAt',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project',
      kbDocs: '++id, timestamp, title, type, active, source, project',
      pushQueue: '++id, branch, status, timestamp',
      yuanHistory: '++id, role, timestamp'
    }).upgrade(tx => {
      return tx.table('taskArtifacts').toCollection().modify(artifact => {
        if (artifact.status === 'reviewed') artifact.status = 'in_review';
      });
    });
    this.version(26).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName, status, projectId',
      taskArtifactLinks: '++id, taskId, artifactId, projectId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName, projectId',
      messages: '++id, sender, taskId, type, status, category, activityName, timestamp, projectId',
      tasks: 'id, workflowStatus, agentState, createdAt, projectId',
      projectConfigs: 'id',
      moduleKnowledge: 'id',
      kbLog: '++id, timestamp, category, abstraction, active, source, project, projectId',
      kbDocs: '++id, timestamp, title, type, active, source, project, projectId',
      pushQueue: '++id, branch, status, timestamp, projectId',
      yuanHistory: '++id, role, timestamp',
      projects: 'id, name, createdAt'
    });
  }
}

export const db = new MyDatabase();
