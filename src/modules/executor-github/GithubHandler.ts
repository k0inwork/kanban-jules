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
    const workflowYaml = obj ? obj.workflowYaml : args[0];
    const workflowName = obj ? obj.workflowName : args[1];
    const targetRepoUrl = (obj ? obj.repoUrl : args[2]) || context.repoUrl;
    const targetBranch = (obj ? obj.branch : args[3]) || context.repoBranch;

    const { githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor. Please configure it in Settings.");
    }

    const [owner, repo] = targetRepoUrl.split('/');
    const workflowPath = `.github/workflows/${workflowName}`;

    // 1. Create/Update the workflow file
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}?ref=${targetBranch}`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha: string | undefined;
    if (fileRes.ok) {
      const fileData = await fileRes.json();
      sha = fileData.sha;
    }

    const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        message: `Fleet: Update workflow ${workflowName}`,
        content: btoa(workflowYaml),
        branch: targetBranch,
        sha
      })
    });

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      throw new Error(`Failed to update workflow file: ${errorData.message}`);
    }

    // 2. Trigger the workflow via workflow_dispatch
    const dispatchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowName}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        ref: targetBranch
      })
    });

    if (!dispatchRes.ok) {
      const errorData = await dispatchRes.json();
      throw new Error(`Failed to trigger workflow: ${errorData.message}`);
    }

    // 3. Find the run ID (polling briefly)
    let runId: number | undefined;
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${targetBranch}&event=workflow_dispatch`, {
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
    const runId = obj ? obj.runId : args[0];
    const targetRepoUrl = (obj ? obj.repoUrl : args[1]) || context.repoUrl;

    const { githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor.");
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
    const runId = obj ? obj.runId : args[0];
    const targetRepoUrl = (obj ? obj.repoUrl : args[1]) || context.repoUrl;
    const targetBranch = (obj ? obj.branch : args[2]) || context.repoBranch;

    const { taskId, githubToken: contextToken } = context;
    const githubToken = contextToken || import.meta.env.VITE_GITHUB_TOKEN;

    if (!githubToken) {
      throw new Error("GitHub Token is required for the GitHub Executor.");
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
