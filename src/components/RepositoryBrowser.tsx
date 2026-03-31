import React, { useState, useEffect } from 'react';
import { GitFs } from '../services/GitFs';
import { Folder, FileText, RefreshCw } from 'lucide-react';

interface RepositoryBrowserProps {
  repoUrl: string;
  branch: string;
  token: string;
}

export default function RepositoryBrowser({ repoUrl, branch, token }: RepositoryBrowserProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchFiles = async () => {
    if (!repoUrl || !token) return;
    setIsLoading(true);
    setError('');
    try {
      const gitFs = new GitFs(repoUrl, branch, token);
      const fileList = await gitFs.listFiles('');
      setFiles(fileList);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repository structure');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [repoUrl, branch, token]);

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-200">Repository Browser</h3>
        <button onClick={fetchFiles} disabled={isLoading} className="text-neutral-400 hover:text-white">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
        {error && <div className="text-xs text-red-400 p-2">{error}</div>}
        {files.map(file => (
          <div key={file} className="flex items-center space-x-2 p-2 hover:bg-neutral-800 rounded text-sm text-neutral-300">
            {file.endsWith('/') ? <Folder className="w-4 h-4 text-blue-400" /> : <FileText className="w-4 h-4 text-neutral-500" />}
            <span>{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
