import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { TaskFs } from '../services/TaskFs';
import { Artifact } from '../services/db';

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, description: string, artifactIds: number[]) => void;
}

export default function NewTaskModal({ isOpen, onClose, onSubmit }: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<number[]>([]);

  useEffect(() => {
    if (isOpen) {
      const taskFs = new TaskFs();
      taskFs.getAllArtifacts().then(setArtifacts);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    onSubmit(title, description, selectedArtifactIds);
    setTitle('');
    setDescription('');
    setSelectedArtifactIds([]);
    onClose();
  };

  const toggleArtifact = (id: number) => {
    setSelectedArtifactIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-neutral-100 font-mono">New Task</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              placeholder="e.g., Refactor database schema"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Description (Agent Instructions)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all h-32 resize-none custom-scrollbar"
              placeholder="Provide detailed instructions for the Agent Supervisor..."
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-neutral-400 mb-1 uppercase tracking-wider">Attach Artifacts</label>
            <div className="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
              {artifacts.map(artifact => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => toggleArtifact(artifact.id!)}
                  className={`w-full flex items-center justify-between p-2 rounded text-sm text-left border ${
                    selectedArtifactIds.includes(artifact.id!) 
                      ? 'bg-blue-500/10 border-blue-500/50 text-blue-300' 
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                  }`}
                >
                  {artifact.name}
                  {selectedArtifactIds.includes(artifact.id!) && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          
          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !description.trim()}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
