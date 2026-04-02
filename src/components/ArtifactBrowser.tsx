import React, { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TaskFs } from '../services/TaskFs';
import { Artifact, db } from '../services/db';
import { Task } from '../types';
import ArtifactTree from './ArtifactTree';

interface ArtifactBrowserProps {
  tasks: Task[];
  onArtifactSelect?: (artifact: Artifact) => void;
}

export default function ArtifactBrowser({ tasks, onArtifactSelect }: ArtifactBrowserProps) {
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [showLocalArtifacts, setShowLocalArtifacts] = useState(false);

  const allArtifacts = useLiveQuery(() => db.taskArtifacts.toArray()) || [];
  const artifacts = showLocalArtifacts ? allArtifacts : allArtifacts.filter(a => !a.name.startsWith('_'));
  const artifactCount = useLiveQuery(() => db.taskArtifacts.count());
  const loading = artifacts.length === 0 && !artifactCount;

  const handleDeleteArtifact = async (id: number) => {
    const taskFs = new TaskFs();
    await taskFs.deleteArtifact(id);
  };

  const handleClearAll = async () => {
    const taskFs = new TaskFs();
    await taskFs.clearAllArtifacts();
  };

  const handleSelect = (artifact: Artifact) => {
    if (onArtifactSelect) {
      onArtifactSelect(artifact);
    } else {
      setSelectedArtifact(artifact);
    }
  };

  if (loading) return <div className="text-xs text-neutral-500 font-mono p-4">Loading artifacts...</div>;
  if (artifacts.length === 0) return <div className="text-xs text-neutral-500 font-mono p-4">No artifacts found.</div>;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 py-2 mb-2 border-b border-neutral-800">
        <div className="flex items-center">
          <Paperclip className="w-4 h-4 mr-2 text-blue-400" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-400">Artifacts</h3>
          <button
            onClick={() => setShowLocalArtifacts(!showLocalArtifacts)}
            className="ml-2 text-[9px] font-mono text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Toggle local artifacts (prefixed with _)"
          >
            {showLocalArtifacts ? '[All]' : '[Global]'}
          </button>
        </div>
        <button 
          onClick={handleClearAll}
          className="text-[10px] font-mono text-red-500 hover:text-red-400 transition-colors uppercase"
        >
          Clear All
        </button>
      </div>
      <div className="custom-scrollbar overflow-y-auto max-h-[400px]">
        <ArtifactTree 
          artifacts={artifacts} 
          tasks={tasks} 
          onSelect={handleSelect} 
          onDelete={handleDeleteArtifact}
        />
      </div>

      {selectedArtifact && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <h2 className="text-lg font-semibold text-neutral-100 font-mono truncate mr-4">{selectedArtifact.name}</h2>
              <button onClick={() => setSelectedArtifact(null)} className="text-neutral-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto bg-[#0d1117] font-mono text-sm text-neutral-300 custom-scrollbar">
              <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {selectedArtifact.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
