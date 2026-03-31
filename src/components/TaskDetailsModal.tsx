import React, { useEffect, useRef, useState } from 'react';
import { Task } from '../types';
import { X, Terminal, Paperclip, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TaskFs } from '../services/TaskFs';
import { Artifact, db } from '../services/db';
import ArtifactTree from './ArtifactTree';

interface TaskDetailsModalProps {
  task: Task | null;
  onClose: () => void;
  tasks: Task[];
  onDeleteTask?: (taskId: string) => void;
}

export default function TaskDetailsModal({ task, onClose, tasks, onDeleteTask }: TaskDetailsModalProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [showAttach, setShowAttach] = useState(false);

  const availableArtifacts = useLiveQuery(() => db.taskArtifacts.toArray()) || [];
  const taskArtifacts = useLiveQuery(async () => {
    if (!task) return [];
    const direct = await db.taskArtifacts.where('taskId').equals(task.id).toArray();
    const links = await db.taskArtifactLinks.where('taskId').equals(task.id).toArray();
    const artifactIds = links.map(l => l.artifactId);
    const linked = artifactIds.length > 0 
      ? await db.taskArtifacts.where('id').anyOf(artifactIds).toArray()
      : [];
    return [...direct, ...linked];
  }, [task?.id]) || [];

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task?.logs]);

  if (!task) return null;

  const handleAttach = async (artifactIds: number[]) => {
    const taskFs = new TaskFs();
    const currentIds = taskArtifacts.map(a => a.id!);
    
    for (const id of artifactIds) {
      if (currentIds.includes(id)) {
        // Already attached, remove it
        await handleRemoveLink(id);
      } else {
        // Not attached, add it
        await taskFs.attachArtifact(task.id, id);
      }
    }
    // Don't close automatically so user can toggle multiple
  };

  const handleRemoveLink = async (artifactId: number) => {
    const taskFs = new TaskFs();
    // Check if it's a direct artifact or a linked one
    const artifact = await db.taskArtifacts.get(artifactId);
    if (artifact?.taskId === task.id) {
      // Direct artifact - delete it
      await taskFs.deleteArtifact(artifactId);
    } else {
      // Linked artifact - just remove the link
      await taskFs.removeArtifactLink(task.id, artifactId);
    }
  };

  const handleDeleteTask = () => {
    if (onDeleteTask) {
      onDeleteTask(task.id);
      onClose();
    }
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
          <div className="flex items-center space-x-2">
            {onDeleteTask && (
              <button 
                onClick={handleDeleteTask}
                className="p-2 text-neutral-400 hover:text-red-400 transition-colors"
                title="Delete Task"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
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
                  <div className="mb-4 bg-neutral-950 p-2 rounded border border-neutral-800 max-h-64 overflow-y-auto custom-scrollbar">
                    <div className="text-[10px] font-mono text-neutral-500 uppercase mb-2 px-2">Select to Attach/Detach</div>
                    <ArtifactTree 
                      artifacts={availableArtifacts} 
                      tasks={tasks} 
                      selectedIds={taskArtifacts.map(a => a.id!)}
                      onToggle={handleAttach}
                      showCheckboxes={true}
                    />
                  </div>
                )}

                <div className="bg-neutral-800/50 rounded-md border border-neutral-700 p-2">
                  <ArtifactTree 
                    artifacts={taskArtifacts} 
                    tasks={tasks} 
                    onDelete={handleRemoveLink}
                  />
                </div>
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
