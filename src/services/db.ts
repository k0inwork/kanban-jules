import Dexie, { Table } from 'dexie';

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
}

export class MyDatabase extends Dexie {
  gitCache!: Table<GitCache>;
  taskArtifacts!: Table<Artifact>;
  taskArtifactLinks!: Table<ArtifactLink>;
  julesSessions!: Table<JulesSession>;

  constructor() {
    super('AgentKanbanDB');
    this.version(6).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId',
      julesSessions: 'id, taskId, name, createdAt'
    });
  }
}

export const db = new MyDatabase();
