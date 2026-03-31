import React, { useState, useEffect } from 'react';
import { GitFs, GitFile } from '../services/GitFs';
import { Folder, FileText, RefreshCw, ChevronLeft } from 'lucide-react';

interface RepositoryBrowserProps {
  repoUrl: string;
  branch: string;
  token: string;
}

export default function RepositoryBrowser({ repoUrl, branch, token }: RepositoryBrowserProps) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchFiles = async (path: string) => {
    if (!repoUrl || !token) return;
    setIsLoading(true);
    setError('');
    try {
      const gitFs = new GitFs(repoUrl, branch, token);
      const fileList = await gitFs.listFiles(path);
      setFiles(fileList);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repository structure');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPath('');
    fetchFiles('');
  }, [repoUrl, branch, token]);

  const handleFolderClick = (path: string) => {
    fetchFiles(path);
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
            onClick={() => file.type === 'dir' ? handleFolderClick(file.path) : null}
            className={`flex items-center space-x-2 p-2 hover:bg-neutral-800 rounded text-sm text-neutral-300 ${file.type === 'dir' ? 'cursor-pointer' : ''}`}
          >
            {file.type === 'dir' ? <Folder className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-neutral-500" />}
            <span className="truncate">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
