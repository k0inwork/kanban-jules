import React, { useState, useEffect, useCallback } from 'react';
import { db, Project } from '../services/db';
import { v4 as uuidv4 } from 'uuid';
import { CONSTITUTION_TEMPLATES, TEMPLATE_KEYS } from '../lib/constitution-templates';
import { julesApi } from '../lib/julesApi';
import { X, FolderGit2, RefreshCw, Search, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  project?: Project; // undefined = create, defined = edit
  onSave: (project: Project) => void;
  onClose: () => void;
  githubToken?: string;
  julesApiKey?: string;
}

interface RepoEntry {
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
  branches: string[];
  isPrivate: boolean;
}

export default function ProjectFormModal({ project, onSave, onClose, githubToken, julesApiKey }: Props) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || '');
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl || '');
  const [repoBranch, setRepoBranch] = useState(project?.repoBranch || 'main');
  const [constitution, setConstitution] = useState(project?.constitution || '');
  const [selectedTemplate, setSelectedTemplate] = useState('');

  // Repo browser state
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRepos, setShowRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    const entries: RepoEntry[] = [];

    // Fetch from Jules API (listSources)
    if (julesApiKey) {
      try {
        const res = await julesApi.listSources(julesApiKey, 100);
        for (const s of res.sources) {
          if (s.githubRepo) {
            entries.push({
              owner: s.githubRepo.owner,
              repo: s.githubRepo.repo,
              url: `${s.githubRepo.owner}/${s.githubRepo.repo}`,
              defaultBranch: s.githubRepo.defaultBranch?.displayName || 'main',
              branches: s.githubRepo.branches?.map(b => b.displayName) || [s.githubRepo.defaultBranch?.displayName || 'main'],
              isPrivate: s.githubRepo.isPrivate,
            });
          }
        }
      } catch (e: any) {
        console.warn('[ProjectForm] Jules listSources failed:', e.message);
      }
    }

    // Fetch from GitHub API (user/repos)
    if (githubToken) {
      try {
        const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
          headers: { Authorization: `token ${githubToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          for (const r of data) {
            // Deduplicate with Jules results
            const fullUrl = `${r.full_name}`;
            if (!entries.some(e => e.url === fullUrl)) {
              entries.push({
                owner: r.owner.login,
                repo: r.name,
                url: fullUrl,
                defaultBranch: r.default_branch || 'main',
                branches: [], // GitHub list doesn't return branches; user can type manually
                isPrivate: r.private,
              });
            }
          }
        }
      } catch (e: any) {
        console.warn('[ProjectForm] GitHub user/repos failed:', e.message);
      }
    }

    if (entries.length === 0 && !julesApiKey && !githubToken) {
      setError('No API key configured. Add a Jules API key or GitHub token in Settings.');
    }

    setRepos(entries);
    setLoading(false);
  }, [julesApiKey, githubToken]);

  useEffect(() => {
    if (showRepos && repos.length === 0 && !loading) {
      fetchRepos();
    }
  }, [showRepos, repos.length, loading, fetchRepos]);

  const handleSelectRepo = (repo: RepoEntry) => {
    setRepoUrl(repo.url);
    setRepoBranch(repo.defaultBranch);
    if (!name.trim()) {
      setName(repo.repo);
    }
    setShowRepos(false);
  };

  const handleTemplateChange = (key: string) => {
    setSelectedTemplate(key);
    setConstitution(CONSTITUTION_TEMPLATES[key].text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoUrl.trim()) return;

    const now = Date.now();
    const saved: Project = {
      id: project?.id || uuidv4(),
      name: name.trim(),
      repoUrl: repoUrl.trim(),
      repoBranch: repoBranch.trim() || 'main',
      constitution,
      createdAt: project?.createdAt || now,
      updatedAt: now,
    };

    await db.projects.put(saved);
    onSave(saved);
  };

  const filteredRepos = repoSearch
    ? repos.filter(r =>
        r.url.toLowerCase().includes(repoSearch.toLowerCase()) ||
        r.repo.toLowerCase().includes(repoSearch.toLowerCase())
      )
    : repos;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <h3 className="text-lg font-semibold text-white">
            {isEdit ? 'Edit Project' : 'Create Project'}
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Fleet MVP"
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-neutral-300">Repo</label>
              <button
                type="button"
                onClick={() => setShowRepos(!showRepos)}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                {showRepos ? 'Hide repos' : 'Browse repos'}
                <ChevronDown className={cn("w-3 h-3 transition-transform", showRepos && "rotate-180")} />
              </button>
            </div>

            {showRepos && (
              <div className="mb-3 border border-neutral-700 rounded-md overflow-hidden">
                <div className="flex items-center border-b border-neutral-700">
                  <Search className="w-3.5 h-3.5 text-neutral-500 ml-2 shrink-0" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={e => setRepoSearch(e.target.value)}
                    placeholder="Search repos..."
                    className="flex-1 px-2 py-1.5 bg-transparent text-white text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={fetchRepos}
                    className="px-2 py-1 text-neutral-400 hover:text-white transition-colors"
                    disabled={loading}
                  >
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto custom-scrollbar">
                  {loading && (
                    <div className="px-3 py-2 text-xs text-neutral-500">Loading repos...</div>
                  )}
                  {error && (
                    <div className="px-3 py-2 text-xs text-amber-400">{error}</div>
                  )}
                  {!loading && !error && filteredRepos.length === 0 && (
                    <div className="px-3 py-2 text-xs text-neutral-500">No repos found</div>
                  )}
                  {filteredRepos.map(r => (
                    <button
                      key={r.url}
                      type="button"
                      onClick={() => handleSelectRepo(r)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 transition-colors flex items-center justify-between",
                        repoUrl === r.url && "bg-blue-500/10 text-blue-400"
                      )}
                    >
                      <span className="truncate">
                        <span className="text-neutral-400">{r.owner}/</span>
                        <span className="text-white">{r.repo}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 ml-2">
                        {r.isPrivate && <span className="text-neutral-500 text-[10px]">private</span>}
                        <span className="text-neutral-500 text-[10px]">{r.defaultBranch}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="owner/repo"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
                required
              />
              <input
                type="text"
                value={repoBranch}
                onChange={e => setRepoBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-neutral-300">Constitution</label>
              <select
                value={selectedTemplate}
                onChange={e => handleTemplateChange(e.target.value)}
                className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
              >
                <option value="">Templates...</option>
                {TEMPLATE_KEYS.map(key => (
                  <option key={key} value={key}>{CONSTITUTION_TEMPLATES[key].label}</option>
                ))}
              </select>
            </div>
            <textarea
              value={constitution}
              onChange={e => setConstitution(e.target.value)}
              placeholder="## Objective&#10;Describe what this project should accomplish...&#10;&#10;## Rules&#10;- Rule 1&#10;- Rule 2"
              rows={12}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
            >
              {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
