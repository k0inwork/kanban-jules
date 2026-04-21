import { useState, useEffect, useCallback } from 'react';
import { BashExecutorHandler } from '../modules/bash-executor/BashExecutorHandler';
import { Folder, FileText, RefreshCw, ChevronLeft } from 'lucide-react';

export interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

interface RepositoryBrowserProps {
  projectId?: string | null;
  onFileSelect?: (file: RepoFile) => void;
}

function getBridge(): any {
  const b = (globalThis as any).boardVM?.fsBridge;
  if (!b) throw new Error('boardVM.fsBridge not available');
  return b;
}

export default function RepositoryBrowser({ projectId, onFileSelect }: RepositoryBrowserProps) {
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const root = BashExecutorHandler.repoRootPath(projectId || '_default');

  const fetchFiles = useCallback(async (path: string) => {
    setIsLoading(true);
    setError('');
    try {
      const dirPath = path ? `${root}/${path}` : root;
      const bridge = getBridge();

      // Check if repo root exists yet (clone may still be in progress)
      if (!path) {
        const rootExists = await bridge.exists(`${root}/.git`);
        if (!rootExists) {
          setFiles([]);
          setError('Repository not yet cloned — prefetch still in progress');
          setIsLoading(false);
          return;
        }
      }

      const entries: string[] = await bridge.readdir(dirPath);

      const fileEntries: RepoFile[] = [];
      for (const entry of entries) {
        if (entry === '.git') continue;
        const fullPath = `${dirPath}/${entry}`;
        try {
          const info = await bridge.stat(fullPath);
          fileEntries.push({
            name: entry,
            path: path ? `${path}/${entry}` : entry,
            type: info.isDir ? 'dir' : 'file',
            size: info.size || 0,
          });
        } catch {
          // skip entries that can't be stat'd
        }
      }

      // Sort: dirs first, then files, alphabetically
      fileEntries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setFiles(fileEntries);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err.message || 'Failed to read repository');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [root]);

  useEffect(() => {
    setCurrentPath('');
    fetchFiles('');
  }, [fetchFiles]);

  // Auto-retry: poll until the repo clone completes
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        if (cancelled) return;
        try {
          const bridge = getBridge();
          const exists = await bridge.exists(`${root}/.git`);
          if (exists) {
            fetchFiles('');
            return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [projectId, root, fetchFiles]);

  const handleFolderClick = (path: string) => {
    fetchFiles(path);
  };

  const handleFileClick = (file: RepoFile) => {
    if (onFileSelect) {
      onFileSelect(file);
    }
  };

  const handleBack = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-neutral-800">
        <div className="flex items-center space-x-2 overflow-hidden">
          {currentPath && (
            <button onClick={handleBack} className="text-neutral-400 hover:text-white shrink-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <h3 className="text-sm font-semibold text-neutral-200 truncate">
            {currentPath || 'Root'}
          </h3>
        </div>
        <button onClick={() => fetchFiles(currentPath)} disabled={isLoading} className="text-neutral-400 hover:text-white shrink-0">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
        {error && <div className="text-xs text-red-400 p-2">{error}</div>}
        {files.length === 0 && !isLoading && !error && (
          <div className="text-xs text-neutral-500 p-4 text-center font-mono">Empty directory</div>
        )}
        {files.map(file => (
          <div
            key={file.path}
            onClick={() => file.type === 'dir' ? handleFolderClick(file.path) : handleFileClick(file)}
            className="flex items-center space-x-2 p-2 hover:bg-neutral-800 rounded text-sm text-neutral-300 cursor-pointer"
          >
            {file.type === 'dir' ? <Folder className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-neutral-500" />}
            <span className="truncate">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
