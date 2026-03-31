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

export class MyDatabase extends Dexie {
  gitCache!: Table<GitCache>;
  taskArtifacts!: Table<Artifact>;
  taskArtifactLinks!: Table<ArtifactLink>;

  constructor() {
    super('AgentKanbanDB');
    this.version(3).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId, repoName, branchName',
      taskArtifactLinks: '++id, taskId, artifactId'
    });
  }
}

export const db = new MyDatabase();
