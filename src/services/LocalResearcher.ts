import { GitFs } from './GitFs';
import { TaskFs } from './TaskFs';

export class LocalResearcher {
  private gitFs: GitFs;
  private taskFs: TaskFs;
  private taskId: string;
  private taskTitle: string;

  constructor(repoUrl: string, branch: string = 'main', token: string, taskId: string, taskTitle: string) {
    this.gitFs = new GitFs(repoUrl, branch, token);
    this.taskFs = new TaskFs();
    this.taskId = taskId;
    this.taskTitle = taskTitle;
  }

  async analyze(): Promise<string[]> {
    const files = await this.gitFs.listFiles();
    const findings: string[] = [];
    
    for (const file of files) {
      const content = await this.gitFs.getFile(file);
      if (content.includes('secret') || content.includes('password')) {
        const artifactName = `${this.taskTitle}: Secret found in ${file}`;
        await this.taskFs.saveArtifact(this.taskId, artifactName, content);
        findings.push(artifactName);
      }
    }
    
    if (findings.length === 0) {
      const artifactName = `${this.taskTitle}: No secrets found`;
      await this.taskFs.saveArtifact(this.taskId, artifactName, "No secrets found.");
      findings.push(artifactName);
    }

    return findings;
  }
}
