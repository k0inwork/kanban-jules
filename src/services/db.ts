import Dexie, { Table } from 'dexie';

export interface GitCache {
  path: string;
  content: string;
  timestamp: number;
}

export interface Artifact {
  id?: number;
  taskId: string;
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
    this.version(2).stores({
      gitCache: 'path',
      taskArtifacts: '++id, taskId',
      taskArtifactLinks: '++id, taskId, artifactId'
    });
  }
}

export const db = new MyDatabase();
