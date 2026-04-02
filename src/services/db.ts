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
  content: string;
  proposedTask?: {
    title: string;
    description: string;
  };
  status: 'unread' | 'read' | 'archived';
  timestamp: number;
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
    this.version(10).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt, repoUrl, branchName',
      messages: '++id, sender, taskId, type, status, timestamp',
      tasks: 'id, status, createdAt',
      projectConfigs: 'id'
    });
  }
}

export const db = new MyDatabase();
