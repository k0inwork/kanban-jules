import { db, Artifact } from './db';

export class TaskFs {
  async saveArtifact(taskId: string, repoName: string, branchName: string, name: string, content: string): Promise<number> {
    return await db.taskArtifacts.add({ taskId, repoName, branchName, name, content });
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
    const existing = await db.taskArtifactLinks.where({
      taskId: targetTaskId,
      artifactId: artifactId
    }).first();
    
    if (!existing) {
      await db.taskArtifactLinks.add({
        taskId: targetTaskId,
        artifactId: artifactId
      });
    }
  }

  async deleteArtifact(artifactId: number): Promise<void> {
    await db.taskArtifacts.delete(artifactId);
    await db.taskArtifactLinks.where('artifactId').equals(artifactId).delete();
  }

  async removeArtifactLink(taskId: string, artifactId: number): Promise<void> {
    await db.taskArtifactLinks.where({ taskId, artifactId }).delete();
  }

  async clearAllArtifacts(): Promise<void> {
    await db.taskArtifacts.clear();
    await db.taskArtifactLinks.clear();
  }
}
