import React, { useState, useEffect } from 'react';
import { GitBranch, GitCommit, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface GithubWorkflowMonitorProps {
  repoUrl: string;
  branch: string;
  token: string;
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  html_url: string;
  created_at: string;
}

export default function GithubWorkflowMonitor({ repoUrl, branch, token }: GithubWorkflowMonitorProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflowRuns = async () => {
    if (!repoUrl || !token) return;
    setLoading(true);
    setError(null);
    try {
      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) throw new Error("Invalid GitHub URL");
      const [_, owner, repo] = match;
      const url = `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}/actions/runs?branch=${branch}&per_page=5`;
      
      const res = await fetch(url, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);
      const data = await res.json();
      setRuns(data.workflow_runs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflowRuns();
    const interval = setInterval(fetchWorkflowRuns, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [repoUrl, branch, token]);

  const getStatusIcon = (status: string, conclusion: string) => {
    if (status === 'completed') {
      return conclusion === 'success' 
        ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> 
        : <XCircle className="w-3 h-3 text-red-400" />;
    }
    return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
  };

  if (!repoUrl) return <div className="p-4 text-xs text-neutral-500 font-mono italic">Select a repository to monitor workflows.</div>;

  return (
    <div className="flex flex-col space-y-1 p-2">
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <div className="flex items-center space-x-2 text-[10px] font-mono text-neutral-500">
          <GitBranch className="w-3 h-3" />
          <span>{branch}</span>
        </div>
        <button 
          onClick={fetchWorkflowRuns}
          disabled={loading}
          className="text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </button>
      </div>

      {error && <div className="p-2 text-[10px] text-red-400 font-mono bg-red-400/10 rounded">{error}</div>}
      
      {runs.length === 0 && !loading && !error && (
        <div className="p-2 text-xs text-neutral-500 font-mono italic">No workflow runs found.</div>
      )}

      {runs.map(run => (
        <a 
          key={run.id}
          href={run.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col p-2 rounded-md hover:bg-neutral-800/50 border border-transparent hover:border-neutral-700/50 transition-all group"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-2 truncate">
              <GitCommit className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-300 transition-colors" />
              <span className="text-xs font-medium text-neutral-300 truncate">{run.name}</span>
            </div>
            {getStatusIcon(run.status, run.conclusion)}
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
            <span>#{run.id.toString().slice(-6)}</span>
            <span>{new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
