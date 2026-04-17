import { db, KBEntry } from '../../services/db';
import { eventBus } from '../../core/event-bus';
import { HostConfig } from '../../core/types';

let _config: HostConfig | null = null;
let _llmCall: ((prompt: string, jsonMode?: boolean) => Promise<string>) | null = null;

interface CommitData {
  sha: string;
  message: string;
  author: string;
  patch: string;
}

/**
 * Initialize commit harvest listener.
 * Call once at app startup with HostConfig + llmCall.
 */
export function initCommitHarvest(
  config: HostConfig,
  llmCall: (prompt: string, jsonMode?: boolean) => Promise<string>
) {
  _config = config;
  _llmCall = llmCall;
  eventBus.on('executor:completed', handleExecutorCompleted);
}

export function destroyCommitHarvest() {
  eventBus.off('executor:completed', handleExecutorCompleted);
  _config = null;
  _llmCall = null;
}

async function handleExecutorCompleted(data: { taskId: string; executor: string; sessionName?: string; startedAt?: number }) {
  if (!_config || !_llmCall) return;
  if (data.executor !== 'executor-jules') return;

  try {
    const task = await db.tasks.get(data.taskId);
    if (!task) return;

    const commits = await fetchCommitsFromGitHub(task.id, data.startedAt || task.createdAt);
    if (commits.length === 0) return;

    const extracted = await extractDecisionsFromCommits(task.id, task.title, task.description, commits);
    for (const decision of extracted) {
      await db.kbLog.add(decision);
    }

    eventBus.emit('module:log', {
      taskId: data.taskId,
      moduleId: 'dream:commit-harvest',
      message: `Extracted ${extracted.length} decisions from ${commits.length} commits`,
    });
  } catch (e: any) {
    console.error(`[commit-harvest] Error processing executor:completed for task ${data.taskId}:`, e);
  }
}

function parseRepoUrl(repoUrl: string): [string, string] {
  // https://github.com/owner/repo → ['owner', 'repo']
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Cannot parse repo URL: ${repoUrl}`);
  return [match[1], match[2]];
}

async function fetchCommitsFromGitHub(_taskId: string, startedAt: number): Promise<CommitData[]> {
  if (!_config?.githubToken || !_config?.repoUrl) return [];

  const [owner, repo] = parseRepoUrl(_config.repoUrl);
  const since = new Date(startedAt).toISOString();
  const branch = _config.repoBranch || 'main';

  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&since=${since}&per_page=30`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${_config.githubToken}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!resp.ok) {
    console.error(`[commit-harvest] GitHub API error: ${resp.status}`);
    return [];
  }

  const commits = await resp.json();
  const results: CommitData[] = [];

  for (const c of commits.slice(0, 15)) {
    try {
      const detailResp = await fetch(c.url, {
        headers: {
          Authorization: `Bearer ${_config.githubToken}`,
          Accept: 'application/vnd.github.v3.diff',
        },
      });
      const patch = await detailResp.text();
      results.push({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author?.name || 'unknown',
        patch: patch.substring(0, 4000), // cap patch size for LLM context
      });
    } catch {
      // Skip individual commit fetch failures
    }
  }

  return results;
}

async function extractDecisionsFromCommits(
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  commits: CommitData[]
): Promise<KBEntry[]> {
  if (!_llmCall) return [];

  const commitTexts = commits.map(c =>
    `--- Commit ${c.sha.slice(0, 8)} by ${c.author} ---\n${c.message}\n\nDiff:\n${c.patch.substring(0, 2000)}`
  ).join('\n\n');

  const prompt = `Analyze these git commits from an external coding agent (Jules) and extract NON-OBVIOUS architectural decisions.

Task: ${taskTitle}
${taskDescription || ''}

Commits:
${commitTexts}

A decision must have: what was chosen + why (or a clear choice between alternatives).
Do NOT extract: style choices, following existing patterns, default values, obvious implementations, typo fixes.

For each decision found, output a JSON array:
[{
  "text": "What was chosen and why",
  "tags": ["classification", "specific_tags"],
  "confidence": "high" | "medium" | "low"
}]

Classification tags must be one of: architectural, api, dependency, pattern, local, infra, security

If no decisions found, output: []

Output ONLY the JSON array, no other text.`;

  try {
    const response = await _llmCall(prompt, true);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((d: any) => d.confidence !== 'low')
      .map((d: any) => ({
        timestamp: Date.now(),
        text: d.text,
        category: 'decision' as const,
        abstraction: 4,
        layer: ['L0', 'L1'] as string[],
        tags: [...(d.tags || []), taskId, 'external-agent'],
        source: 'dream:micro',
        active: true,
        project: 'target' as const,
      }));
  } catch (e) {
    console.error('[commit-harvest] LLM extraction error:', e);
    return [];
  }
}
