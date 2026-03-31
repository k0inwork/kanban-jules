import { db, Artifact } from './db';

export class TaskFs {
  async saveArtifact(taskId: string, name: string, content: string): Promise<number> {
    return await db.taskArtifacts.add({ taskId, name, content });
  }

  async getArtifacts(taskId: string): Promise<Artifact[]> {
    const directArtifacts = await db.taskArtifacts.where('taskId').equals(taskId).toArray();
    const linkedArtifactLinks = await db.taskArtifactLinks.where('taskId').equals(taskId).toArray();
    
    const linkedArtifacts = await Promise.all(
      linkedArtifactLinks.map(link => db.taskArtifacts.get(link.artifactId))
    );
    
    return [...directArtifacts, ...linkedArtifacts.filter((a): a is Artifact => !!a)];
  }

  async getAllArtifacts(): Promise<Artifact[]> {
    return await db.taskArtifacts.toArray();
  }

  async attachArtifact(targetTaskId: string, artifactId: number): Promise<void> {
    await db.taskArtifactLinks.add({
      taskId: targetTaskId,
      artifactId: artifactId
    });
  }
}
