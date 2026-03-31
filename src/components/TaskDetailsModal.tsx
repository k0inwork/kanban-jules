import React, { useEffect, useRef, useState } from 'react';
import { Task } from '../types';
import { X, Terminal, Paperclip, Check } from 'lucide-react';
import { TaskFs } from '../services/TaskFs';
import { Artifact } from '../services/db';

interface TaskDetailsModalProps {
  task: Task | null;
  onClose: () => void;
}

export default function TaskDetailsModal({ task, onClose }: TaskDetailsModalProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [availableArtifacts, setAvailableArtifacts] = useState<Artifact[]>([]);
  const [taskArtifacts, setTaskArtifacts] = useState<Artifact[]>([]);
  const [showAttach, setShowAttach] = useState(false);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task?.logs]);

  useEffect(() => {
    if (task) {
      const taskFs = new TaskFs();
      taskFs.getAllArtifacts().then(setAvailableArtifacts);
      taskFs.getArtifacts(task.id).then(setTaskArtifacts);
    }
  }, [task]);

  if (!task) return null;

  const handleAttach = async (artifactId: number) => {
    const taskFs = new TaskFs();
    await taskFs.attachArtifact(task.id, artifactId);
    // Refresh artifacts
    taskFs.getArtifacts(task.id).then(setTaskArtifacts);
    setShowAttach(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-8">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-4xl max-h-full flex flex-col shadow-2xl overflow-hidden">
        
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/50">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-semibold text-neutral-100">{task.title}</h2>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
              {task.status}
            </span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left Panel: Details */}
          <div className="w-full md:w-1/3 p-4 border-b md:border-b-0 md:border-r border-neutral-800 bg-neutral-900/50 overflow-y-auto custom-scrollbar">
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-mono text-neutral-500 uppercase tracking-wider mb-2">Description</h4>
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {task.description}
                </p>
              </div>
              
              <div>
                <h4 className="text-xs font-mono text-neutral-500 uppercase tracking-wider mb-2">Assignee</h4>
                <div className="flex items-center space-x-2">
                  {task.agentId ? (
                    <span className="flex items-center text-sm font-mono text-blue-400 bg-blue-400/10 px-3 py-1.5 rounded-md border border-blue-500/20">
                      {task.agentId}
                    </span>
                  ) : (
                    <span className="text-sm text-neutral-500 italic">Unassigned</span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-mono text-neutral-500 uppercase tracking-wider">Artifacts</h4>
                  <button onClick={() => setShowAttach(!showAttach)} className="text-blue-400 hover:text-blue-300">
                    <Paperclip className="w-4 h-4" />
                  </button>
                </div>
                
                {showAttach && (
                  <div className="mb-4 bg-neutral-950 p-2 rounded border border-neutral-800 space-y-1">
                    {availableArtifacts.map(a => (
                      <button key={a.id} onClick={() => handleAttach(a.id!)} className="w-full text-left text-xs p-1 hover:bg-neutral-800 rounded text-neutral-300">
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}

                <ul className="space-y-2">
                  {taskArtifacts.map((artifact, index) => (
                    <li key={index} className="text-sm text-neutral-300 bg-neutral-800 p-2 rounded border border-neutral-700">
                      {artifact.name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          
          {/* Right Panel: Terminal Logs */}
          <div className="w-full md:w-2/3 flex flex-col bg-[#0d1117]">
            <div className="flex items-center px-4 py-2 border-b border-neutral-800 bg-[#161b22]">
              <Terminal className="w-4 h-4 text-neutral-400 mr-2" />
              <span className="text-xs font-mono text-neutral-400">Agent Supervisor & Logs</span>
            </div>
            <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-neutral-300 custom-scrollbar">
              {task.logs ? (
                <pre className="whitespace-pre-wrap break-words leading-relaxed">
                  {task.logs}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-neutral-600 italic">
                  Waiting for agent to start processing...
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
