import { GitFs } from './GitFs';
import { TaskFs } from './TaskFs';

export class LocalAnalyzer {
  private gitFs: GitFs;
  private taskFs: TaskFs;
  private taskId: string;
  private taskTitle: string;
  private repoUrl: string;
  private branch: string;

  constructor(repoUrl: string, branch: string = 'main', token: string, taskId: string, taskTitle: string) {
    this.gitFs = new GitFs(repoUrl, branch, token);
    this.taskFs = new TaskFs();
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.repoUrl = repoUrl;
    this.branch = branch;
  }

  async analyze(): Promise<string[]> {
    const items = await this.gitFs.listFiles();
    const files = items.filter(i => i.type === 'file');
    const findings: string[] = [];
    
    const repoName = this.repoUrl.split('/').pop() || this.repoUrl;

    for (const file of files) {
      const content = await this.gitFs.getFile(file.path);
      if (content.includes('secret') || content.includes('password')) {
        const artifactName = `${this.taskTitle}: Secret found in ${file.path}`;
        await this.taskFs.saveArtifact(this.taskId, repoName, this.branch, artifactName, content);
        findings.push(artifactName);
      }
    }
    
    if (findings.length === 0) {
      const artifactName = `${this.taskTitle}: No secrets found`;
      await this.taskFs.saveArtifact(this.taskId, repoName, this.branch, artifactName, "No secrets found.");
      findings.push(artifactName);
    }

    return findings;
  }
}
