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
 * Decision harvest — event-driven listener.
 *
 * Two paths, same event:
 *   executor-jules  → fetch GitHub commits → extract decisions
 *   executor-local  → read moduleLogs     → extract decisions
 *
 * No explicit recordDecision() calls needed in agent code.
 * The dreamer analyzes traces in a separate LLM context focused on decisions.
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

  try {
    const task = await db.tasks.get(data.taskId);
    if (!task) return;

    let extracted: KBEntry[] = [];

    if (data.executor === 'executor-jules') {
      const commits = await fetchCommitsFromGitHub(data.startedAt || task.createdAt);
      if (commits.length > 0) {
        extracted = await extractFromCommits(task.id, task.title, task.description, commits);
      }
    } else if (data.executor === 'executor-local') {
      const logs = task.moduleLogs || {};
      const logText = Object.entries(logs).map(([mod, text]) => `--- ${mod} ---\n${text}`).join('\n\n');
      if (logText.length > 50) {
        extracted = await extractFromLogs(task.id, task.title, task.description, logText);
      }
    }

    for (const decision of extracted) {
      await db.kbLog.add(decision);
    }

    if (extracted.length > 0) {
      eventBus.emit('module:log', {
        taskId: data.taskId,
        moduleId: 'dream:decision-harvest',
        message: `Extracted ${extracted.length} decisions from ${data.executor}`,
      });
    }
  } catch (e: any) {
    console.error(`[decision-harvest] Error for task ${data.taskId}:`, e);
  }
}

// --- Jules path: GitHub commits ---

function parseRepoUrl(repoUrl: string): [string, string] {
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Cannot parse repo URL: ${repoUrl}`);
  return [match[1], match[2]];
}

async function fetchCommitsFromGitHub(startedAt: number): Promise<CommitData[]> {
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
    console.error(`[decision-harvest] GitHub API error: ${resp.status}`);
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
        patch: patch.substring(0, 4000),
      });
    } catch {
      // Skip individual commit fetch failures
    }
  }

  return results;
}

async function extractFromCommits(
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  commits: CommitData[]
): Promise<KBEntry[]> {
  if (!_llmCall) return [];

  const commitTexts = commits.map(c =>
    `--- Commit ${c.sha.slice(0, 8)} by ${c.author} ---\n${c.message}\n\nDiff:\n${c.patch.substring(0, 2000)}`
  ).join('\n\n');

  const prompt = buildExtractionPrompt(taskTitle, taskDescription, commitTexts, 'external coding agent (Jules) via its git commits');

  return runExtraction(prompt, taskId, 'external-agent');
}

// --- Local executor path: moduleLogs ---

async function extractFromLogs(
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  logText: string
): Promise<KBEntry[]> {
  if (!_llmCall) return [];

  // Cap log text to avoid blowing up LLM context
  const cappedLog = logText.substring(0, 8000);
  const prompt = buildExtractionPrompt(taskTitle, taskDescription, cappedLog, 'local coding agent (Yuan) via its execution logs');

  return runExtraction(prompt, taskId, 'internal-agent');
}

// --- Shared extraction logic ---

function buildExtractionPrompt(taskTitle: string, taskDescription: string, sourceText: string, sourceLabel: string): string {
  return `Analyze the output from an ${sourceLabel} and extract NON-OBVIOUS architectural decisions.

Task: ${taskTitle}
${taskDescription || ''}

Output:
${sourceText}

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
}

async function runExtraction(prompt: string, taskId: string, agentTag: string): Promise<KBEntry[]> {
  if (!_llmCall) return [];

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
        tags: [...(d.tags || []), taskId, agentTag],
        source: 'dream:micro',
        active: true,
        project: 'target' as const,
      }));
  } catch (e) {
    console.error('[decision-harvest] LLM extraction error:', e);
    return [];
  }
}
