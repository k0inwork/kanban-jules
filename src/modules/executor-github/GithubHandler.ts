import { RequestContext } from '../../core/types';
import { db } from '../../services/db';
import { GitFs } from '../../services/GitFs';
import YAML from 'yaml';

export class GithubHandler {
  async handleRequest(toolName: string, args: any[], context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'executor-github.runWorkflow':
        return this.runWorkflow(args, context);
      case 'executor-github.runAndWait':
        return this.runAndWait(args, context);
      case 'executor-github.fetchLogs':
        return this.fetchLogs(args, context);
      case 'executor-github.getRunStatus':
        return this.getRunStatus(args, context);
      case 'executor-github.fetchArtifacts':
        return this.fetchArtifacts(args, context);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url, options);
      } catch (e) {
        console.error(`[GithubHandler] Network error (attempt ${i + 1}/${retries}): ${url}`, e);
        if (i === retries - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw new Error("Unreachable");
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
    let baseBranch = targetBranch;
    if (!baseBranch) {
      const url = `https://api.github.com/repos/${owner}/${repo}`;
      console.log(`[GithubHandler] Fetching repo info: ${url}`);
      let repoRes: Response;
      try {
        repoRes = await fetch(url, {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
      } catch (e) {
        console.error(`[GithubHandler] Network error fetching repo info: ${url}`, e);
        throw new Error(`Network error fetching repo info: ${e}`);
      }
      
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        baseBranch = repoData.default_branch;
      } else {
        console.warn(`[GithubHandler] Failed to fetch repo info, status: ${repoRes.status}`);
        baseBranch = 'main';
      }
    }

    // Create a temporary branch
    const tempBranch = `fleet-temp-${Date.now()}`;
    console.log(`[GithubHandler] Creating temporary branch ${tempBranch} from ${baseBranch}`);

    // Force the workflow to trigger on push to the temporary branch
    try {
      const parsedYaml = YAML.parse(workflowYaml);
      parsedYaml.on = { push: { branches: [tempBranch] } };
      workflowYaml = YAML.stringify(parsedYaml);
    } catch (e) {
      console.warn("[GithubHandler] Failed to parse and patch workflow YAML, using original:", e);
    }
    
    // 1. Get SHA of base branch
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!refRes.ok) {
      throw new Error(`Failed to get SHA for branch ${baseBranch}`);
    }
    const refData = await refRes.json();
    const sha = refData.object.sha;

    // 2. Create new branch
    const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        ref: `refs/heads/${tempBranch}`,
        sha: sha
      })
    });
    if (!createRefRes.ok) {
      throw new Error(`Failed to create temporary branch ${tempBranch}`);
    }

    const workflowPath = `.github/workflows/${finalWorkflowName}`;
    
    // 3. Create/Update the workflow file using GitFs on the TEMP branch
    // This push will automatically trigger the workflow because of the 'on: push' rule.
    try {
      const gitFs = new GitFs(targetRepoUrl, tempBranch, githubToken);
      await gitFs.writeFile(workflowPath, workflowYaml, `Fleet: Update workflow ${finalWorkflowName}`);
    } catch (e: any) {
      throw new Error(`Failed to update workflow file via Git: ${e.message}`);
    }

    // 4. Find the run ID (polling briefly)
    let runId: number | undefined;
    for (let i = 0; i < 10; i++) { // Poll up to 30 seconds for the push event to register
      await new Promise(resolve => setTimeout(resolve, 3000));
      const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${tempBranch}&event=push`, {
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
      throw new Error("Workflow file pushed but could not find the run ID. Please check GitHub Actions.");
    }

    return { runId, status: 'queued', tempBranch };
  }

  private async runAndWait(args: any[], context: RequestContext): Promise<any> {
    const unpack = (arg: any) => (arg && typeof arg === 'object' && !Array.isArray(arg)) ? arg : null;
    const obj = unpack(args[0]);
    const timeoutMs = (obj && obj.timeoutMs) || 300000; // Default 5 minutes

    // 1. Trigger the workflow
    const runResult = await this.runWorkflow(args, context);
    const runId = runResult.runId;
    const tempBranch = runResult.tempBranch;

    // Helper to delete the temporary branch
    const cleanupBranch = async () => {
      if (tempBranch) {
        try {
          const targetRepoUrl = obj?.repoUrl || context.repoUrl;
          const [owner, repo] = targetRepoUrl.split('/');
          const githubToken = context.githubToken || import.meta.env.VITE_GITHUB_TOKEN;
          await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${tempBranch}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          console.log(`[GithubHandler] Deleted temporary branch ${tempBranch}`);
        } catch (e) {
          console.warn(`[GithubHandler] Failed to delete temporary branch ${tempBranch}:`, e);
        }
      }
    };

    // 2. Poll for completion
    let executionStartTime = Date.now();
    let statusResult: any = { status: 'queued' };

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
      
      try {
        statusResult = await this.getRunStatus([{ runId, repoUrl: obj?.repoUrl }], context);
        if (statusResult.status === 'completed' || statusResult.status === 'done') {
          await cleanupBranch();
          return {
            runId,
            status: statusResult.status,
            conclusion: statusResult.conclusion,
            url: statusResult.url
          };
        }

        if (statusResult.status === 'queued') {
          // Reset the timeout clock while it's waiting in GitHub's queue
          executionStartTime = Date.now();
        } else if (Date.now() - executionStartTime > timeoutMs) {
          await cleanupBranch();
          throw new Error(`Workflow run ${runId} timed out after ${timeoutMs}ms. Last status: ${statusResult.status}`);
        }
      } catch (e) {
        console.warn(`[GithubHandler] Error polling run status for runId ${runId}:`, e);
        if (Date.now() - executionStartTime > timeoutMs) {
          await cleanupBranch();
          throw new Error(`Workflow run ${runId} timed out after ${timeoutMs}ms. Last status: ${statusResult.status}`);
        }
      }
    }
  }

  private async fetchLogs(args: any[], context: RequestContext): Promise<string> {
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

    // 1. Fetch jobs for the run
    const jobsRes = await this.fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!jobsRes.ok) {
      const errorData = await jobsRes.json();
      throw new Error(`Failed to list jobs for run ${runId}: ${errorData.message}`);
    }

    const jobsData = await jobsRes.json();
    const jobs = jobsData.jobs || [];

    let allLogs = '';

    // 2. Fetch logs for each job
    for (const job of jobs) {
      allLogs += `\n--- Logs for Job: ${job.name} (Status: ${job.status}, Conclusion: ${job.conclusion}) ---\n`;
      
      try {
        const logRes = await this.fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, {
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (logRes.ok) {
          const logText = await logRes.text();
          allLogs += logText + '\n';
        } else {
          allLogs += `[Failed to fetch logs for this job: HTTP ${logRes.status}]\n`;
        }
      } catch (e: any) {
        allLogs += `[Error fetching logs for this job: ${e.message}]\n`;
      }
    }

    return allLogs;
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
    const res = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
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
    const res = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`, {
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
      const downloadRes = await fetchWithRetry(artifact.archive_download_url, {
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
