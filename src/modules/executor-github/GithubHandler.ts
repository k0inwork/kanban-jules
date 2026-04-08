import { RequestContext } from '../../core/types';
import { db } from '../../services/db';

export class GithubHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-github.runWorkflow':
        return this.runWorkflow(args, context);
      case 'executor-github.getRunStatus':
        return this.getRunStatus(args, context);
      case 'executor-github.fetchArtifacts':
        return this.fetchArtifacts(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async runWorkflow(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    
    // The agent often passes (repoUrl, workflowYaml) or (repoUrl, workflowName, workflowYaml)
    let workflowYaml = obj ? obj.workflowYaml : null;
    let workflowName = obj ? obj.workflowName : null;
    let targetRepoUrl = obj ? obj.repoUrl : null;
    let targetBranch = obj ? (obj.branch || obj.ref) : null;

    if (!obj) {
      // Heuristic parsing for positional arguments
      if (typeof args[0] === 'string' && args[0].includes('/')) {
        targetRepoUrl = args[0];
        if (typeof args[1] === 'string' && args[1].endsWith('.yml')) {
          workflowName = args[1];
          workflowYaml = args[2];
        } else {
          workflowYaml = args[1];
        }
      } else {
        workflowYaml = args[0];
        workflowName = args[1];
        targetRepoUrl = args[2];
      }
      targetBranch = args[3];
    }
    
    targetRepoUrl = targetRepoUrl || context.repoUrl;
    targetBranch = targetBranch || context.repoBranch;

    if (!workflowYaml) {
      throw new Error("workflowYaml is required.");
    }

    // If workflowName is not provided, generate a default one
    let finalWorkflowName = workflowName || `fleet-workflow-${Date.now()}.yml`;
    if (!finalWorkflowName.endsWith('.yml') && !finalWorkflowName.endsWith('.yaml')) {
      finalWorkflowName += '.yml';
    }
    
    if (!targetRepoUrl && obj && obj.owner && obj.repo) {
      targetRepoUrl = `${obj.owner}/${obj.repo}`;
    }

    const { githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor. Please configure it in Settings.");
    }

    if (!targetRepoUrl) {
      throw new Error("Repository URL (owner/repo) is required.");
    }

    const [owner, repo] = targetRepoUrl.split('/');

    // Detect default branch if not provided
    let branch = targetBranch;
    if (!branch) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        branch = repoData.default_branch;
      } else {
        branch = 'main';
      }
    }

    const workflowPath = `.github/workflows/${finalWorkflowName}`;
    
    // Add a longer delay to allow GitHub to index the file
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 1. Create/Update the workflow file
    let sha: string | undefined;
    let updateRes: Response | undefined;
    
    // Retry loop for file update to handle SHA conflicts
    for (let attempt = 0; attempt < 3; attempt++) {
      // Always fetch the latest SHA before attempting update
      const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}?ref=${branch}`, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      sha = fileRes.ok ? (await fileRes.json()).sha : undefined;

      updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          message: `Fleet: Update workflow ${finalWorkflowName}`,
          content: btoa(workflowYaml),
          branch: branch,
          sha
        })
      });

      if (updateRes.ok) break;
      
      // If conflict (409), wait and retry
      if (updateRes.status === 409 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      
      break;
    }

    if (!updateRes || !updateRes.ok) {
      const errorText = await updateRes?.text();
      let errorMessage = errorText || 'Unknown error';
      try {
        const errorData = JSON.parse(errorText || '{}');
        errorMessage = errorData.message || errorText;
      } catch (e) {}
      throw new Error(`Failed to update workflow file: ${errorMessage}`);
    }

    // 2. Trigger the workflow via workflow_dispatch
    let dispatchRes: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      dispatchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${finalWorkflowName}/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          ref: branch
        })
      });

      if (dispatchRes.ok) break;
      
      // If rate limited or conflict, wait and retry
      if ((dispatchRes.status === 429 || dispatchRes.status === 409) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      
      break;
    }

    if (!dispatchRes || !dispatchRes.ok) {
      const errorText = await dispatchRes?.text();
      let errorMessage = errorText || 'Unknown error';
      try {
        const errorData = JSON.parse(errorText || '{}');
        errorMessage = errorData.message || errorText;
      } catch (e) {}
      throw new Error(`Failed to trigger workflow: ${errorMessage}`);
    }

    // 3. Find the run ID (polling briefly)
    let runId: number | undefined;
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branch}&event=workflow_dispatch`, {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const latestRun = runsData.workflow_runs[0];
        if (latestRun && latestRun.status !== 'completed') {
          runId = latestRun.id;
          break;
        }
      }
    }

    if (!runId) {
      throw new Error("Workflow triggered but could not find the run ID. Please check GitHub Actions.");
    }

    return { runId, status: 'queued' };
  }

  private async getRunStatus(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    
    let runId = obj ? obj.runId : null;
    let targetRepoUrl = obj ? obj.repoUrl : null;

    if (!obj) {
      if (typeof args[0] === 'string' && args[0].includes('/')) {
        targetRepoUrl = args[0];
        runId = args[1];
      } else {
        runId = args[0];
        targetRepoUrl = args[1];
      }
    }
    
    targetRepoUrl = targetRepoUrl || context.repoUrl;

    const { githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor.");
    }

    if (!targetRepoUrl) {
      throw new Error("Repository URL (owner/repo) is required.");
    }

    const [owner, repo] = targetRepoUrl.split('/');
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(`Failed to get run status: ${errorData.message}`);
    }

    const data = await res.json();
    return {
      status: data.status,
      conclusion: data.conclusion,
      url: data.html_url
    };
  }

  private async fetchArtifacts(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    
    let runId = obj ? obj.runId : null;
    let targetRepoUrl = obj ? obj.repoUrl : null;
    let targetBranch = obj ? obj.branch : null;

    if (!obj) {
      if (typeof args[0] === 'string' && args[0].includes('/')) {
        targetRepoUrl = args[0];
        runId = args[1];
        targetBranch = args[2];
      } else {
        runId = args[0];
        targetRepoUrl = args[1];
        targetBranch = args[2];
      }
    }
    
    targetRepoUrl = targetRepoUrl || context.repoUrl;
    targetBranch = targetBranch || context.repoBranch || 'main';

    const { taskId, githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor.");
    }

    if (!targetRepoUrl) {
      throw new Error("Repository URL (owner/repo) is required.");
    }

    const [owner, repo] = targetRepoUrl.split('/');
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(`Failed to list artifacts: ${errorData.message}`);
    }

    const data = await res.json();
    const artifacts = data.artifacts || [];
    const savedArtifacts = [];

    for (const artifact of artifacts) {
      // Download the artifact (it's a zip file)
      const downloadRes = await fetch(artifact.archive_download_url, {
        headers: {
          'Authorization': `token ${githubToken}`
        }
      });

      if (downloadRes.ok) {
        const blob = await downloadRes.blob();
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });

        const newArtifact = await db.taskArtifacts.add({
          taskId,
          repoName: targetRepoUrl,
          branchName: targetBranch,
          name: artifact.name,
          type: 'file',
          content: base64,
          metadata: {
            source: 'github-actions',
            runId,
            githubUrl: artifact.url
          },
          createdAt: Date.now()
        });
        savedArtifacts.push(newArtifact);
      }
    }

    return { count: savedArtifacts.length, artifacts: savedArtifacts };
  }
}
