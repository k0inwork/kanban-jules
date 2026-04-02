import React, { useEffect, useRef, useState } from 'react';
import { Task } from '../types';
import { X, Terminal, Paperclip, Trash2, Eye, Brain, Edit2, Save } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TaskFs } from '../services/TaskFs';
import { Artifact, db } from '../services/db';
import ArtifactTree from './ArtifactTree';
import { cn } from '../lib/utils';
import { GoogleGenAI } from '@google/genai';

interface TaskDetailsModalProps {
  task: Task | null;
  onClose: () => void;
  tasks: Task[];
  onDeleteTask?: (taskId: string) => void;
  onUpdateTask?: (task: Task) => void;
  onSendMessage?: (taskId: string, message: string) => void;
  onAnalyzeArtifact?: (artifactId: number) => void;
}

export default function TaskDetailsModal({ task, onClose, tasks, onDeleteTask, onUpdateTask, onSendMessage, onAnalyzeArtifact }: TaskDetailsModalProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'chat' | 'actions'>('chat');
  const [userMessage, setUserMessage] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const selectedArtifact = useLiveQuery(() => 
    selectedArtifactId ? db.taskArtifacts.get(selectedArtifactId) : Promise.resolve(null)
  , [selectedArtifactId]);

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

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userMessage.trim() || !onSendMessage || !task) return;

    onSendMessage(task.id, userMessage);
    setUserMessage('');
  };

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

  const handleAnalyze = async () => {
    if (!selectedArtifact) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analyze the following artifact content from a software task. 
        Task: ${task.title}
        Artifact Name: ${selectedArtifact.name}
        Content:
        ${selectedArtifact.content}
        
        Provide a concise summary of what this artifact is and how it relates to the task.`,
      });
      setAnalysisResult(response.text || "No analysis generated.");
    } catch (err: any) {
      setAnalysisResult(`Error analyzing artifact: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-8">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-4xl max-h-full flex flex-col shadow-2xl overflow-hidden">
        
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/50">
          <div className="flex items-center space-x-3 flex-1 mr-4">
            <h2 className="text-lg font-semibold text-neutral-100">{task.title}</h2>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700 shrink-0">
                {task.workflowStatus}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/50 shrink-0">
                {task.agentState}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
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
                    onSelect={(a) => setSelectedArtifactId(a.id!)}
                  />
                </div>

                {selectedArtifact && (
                  <div className="mt-4 space-y-4">
                    <div className="bg-neutral-950 rounded-md border border-neutral-800 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border-b border-neutral-800">
                        <span className="text-[10px] font-mono text-neutral-400 truncate">{selectedArtifact.name}</span>
                        <div className="flex items-center space-x-2">
                          <button 
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
                            title="Analyze with AI"
                          >
                            <Brain className={cn("w-3.5 h-3.5", isAnalyzing && "animate-pulse")} />
                          </button>
                          <button onClick={() => setSelectedArtifactId(null)} className="text-neutral-500 hover:text-neutral-300">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3 max-h-64 overflow-y-auto custom-scrollbar bg-neutral-950">
                        <pre className="text-[11px] font-mono text-neutral-400 whitespace-pre-wrap leading-relaxed">
                          {selectedArtifact.content}
                        </pre>
                      </div>
                    </div>

                    {analysisResult && (
                      <div className="bg-blue-400/5 border border-blue-400/20 rounded-md p-3">
                        <div className="flex items-center space-x-2 mb-2">
                          <Brain className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">AI Analysis</span>
                        </div>
                        <p className="text-xs text-neutral-300 leading-relaxed italic">
                          {analysisResult}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Right Panel: Terminal Logs & Chat */}
          <div className="w-full md:w-2/3 flex flex-col bg-[#0d1117]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-[#161b22]">
              <div className="flex items-center space-x-4">
                <button 
                  onClick={() => setActiveTab('logs')}
                  className={cn("text-xs font-mono uppercase transition-colors", activeTab === 'logs' ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
                >
                  Logs
                </button>
                <button 
                  onClick={() => setActiveTab('chat')}
                  className={cn("text-xs font-mono uppercase transition-colors", activeTab === 'chat' ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
                >
                  Chat
                </button>
                <button 
                  onClick={() => setActiveTab('actions')}
                  className={cn("text-xs font-mono uppercase transition-colors", activeTab === 'actions' ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
                >
                  Actions
                </button>
              </div>
              {activeTab === 'logs' && (
                <button 
                  onClick={() => setShowLogs(!showLogs)}
                  className="text-[10px] font-mono text-blue-400 hover:text-blue-300 transition-colors uppercase"
                >
                  {showLogs ? 'Hide Logs' : 'Show Logs'}
                </button>
              )}
            </div>
            <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-neutral-300 custom-scrollbar">
              {activeTab === 'logs' ? (
                !showLogs ? (
                  <div className="h-full flex items-center justify-center text-neutral-600 italic">
                    Logs are hidden. Click "Show Logs" to view.
                  </div>
                ) : task.logs ? (
                  <pre className="whitespace-pre-wrap break-words leading-relaxed">
                    {task.logs}
                  </pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-neutral-600 italic">
                    Waiting for agent to start processing...
                  </div>
                )
              ) : activeTab === 'chat' ? (
                <div className="whitespace-pre-wrap break-words leading-relaxed font-sans">
                  {task.chat || <div className="text-neutral-600 italic">No chat messages yet.</div>}
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words leading-relaxed font-mono text-xs text-neutral-400">
                  {task.actionLog || <div className="text-neutral-600 italic">No actions recorded yet.</div>}
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
            
            <div className="p-3 border-t border-neutral-800 bg-[#161b22]">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  placeholder={`Send a message to the agent ${activeTab}...`}
                  className="flex-1 bg-[#0d1117] border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="submit"
                  disabled={!userMessage.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
