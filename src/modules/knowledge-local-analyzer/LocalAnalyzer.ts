import { RequestContext } from '../../core/types';
import { GitFs } from '../../services/GitFs';
import { TaskFs } from '../../services/TaskFs';
import { db } from '../../services/db';

export class LocalAnalyzer {
  static async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    if (toolName === 'knowledge-local-analyzer.scan') {
      const { patterns } = args[0] || {};
      return this.scan(patterns, context);
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  private static async scan(patterns: string[] = ['secret', 'password'], context: RequestContext): Promise<string[]> {
    const { taskId, repoUrl, repoBranch } = context;
    const token = import.meta.env.VITE_GITHUB_TOKEN || '';
    
    const gitFs = new GitFs(repoUrl, repoBranch, token);
    const taskFs = new TaskFs();
    
    const task = await db.tasks.get(taskId);
    const taskTitle = task?.title || 'Task Analysis';
    
    const items = await gitFs.listFiles();
    const files = items.filter(i => i.type === 'file');
    const findings: string[] = [];
    
    const repoName = repoUrl.split('/').pop() || repoUrl;

    for (const file of files) {
      const content = await gitFs.getFile(file.path);
      const found = patterns.some(p => content.toLowerCase().includes(p.toLowerCase()));
      
      if (found) {
        const artifactName = `${taskTitle}: Pattern found in ${file.path}`;
        await taskFs.saveArtifact(taskId, repoName, repoBranch, artifactName, content);
        findings.push(artifactName);
      }
    }
    
    if (findings.length === 0) {
      const artifactName = `${taskTitle}: No patterns found`;
      await taskFs.saveArtifact(taskId, repoName, repoBranch, artifactName, "No patterns found.");
      findings.push(artifactName);
    }

    return findings;
  }
}
