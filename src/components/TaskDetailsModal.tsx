import React, { useEffect, useRef, useState } from 'react';
import { Task } from '../types';
import { X, Terminal, Paperclip, Trash2, Eye, Brain, Edit2, Save, Download, Play, BrainCircuit, HelpCircle, MessageSquare, Cpu, Globe, Bot, UserCircle, Zap, Shield, Database, Settings, Info, Code2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TaskFs } from '../services/TaskFs';
import { Artifact, db } from '../services/db';
import ArtifactTree from './ArtifactTree';
import { cn } from '../lib/utils';
import { GoogleGenAI } from '@google/genai';
import { HELP_CONTENT } from '../core/constitution';
import { registry } from '../core/registry';
import { ModuleIcon } from './ModuleIcon';

import { useSettings } from '../contexts/SettingsContext';

const COMMON_TOOLS = [
  { name: 'askUser(prompt)', description: 'Asks the user for input or clarification. Pauses execution.' },
  { name: 'sendUser(message)', description: 'Sends a message to the user without waiting for a reply.' },
  { name: 'analyze(data, options?)', description: 'Analyzes data using an LLM and adds summary to context.' },
  { name: 'addToContext(key, value)', description: 'Directly adds a key-value pair to the AgentContext.' }
];

interface TaskDetailsModalProps {
  task: Task | null;
  onClose: () => void;
  tasks: Task[];
  onDeleteTask?: (taskId: string) => void;
  onUpdateTask?: (task: Task) => void;
  onSendMessage?: (taskId: string, message: string) => void;
  onAnalyzeArtifact?: (artifactId: number) => void;
}

export default function TaskDetailsModal({ 
  task, onClose, tasks, onDeleteTask, onUpdateTask, onSendMessage, onAnalyzeArtifact
}: TaskDetailsModalProps) {
  const { settings } = useSettings();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('protocol');
  const [userMessage, setUserMessage] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const selectedArtifact = useLiveQuery(() => 
    selectedArtifactId ? db.taskArtifacts.get(selectedArtifactId) : Promise.resolve(null)
  , [selectedArtifactId]);

  const availableArtifacts = useLiveQuery(async () => {
    const all = await db.taskArtifacts.toArray();
    return all.filter(a => typeof a.name !== 'string' || !a.name.startsWith('_') || a.taskId === task?.id);
  }, [task?.id]) || [];
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
  }, [task?.moduleLogs]);

  if (!task) return null;

  const LogLine = ({ log }: { log: any }) => {
    return (
      <div className="flex items-start py-0.5 border-b border-white/5 last:border-0 leading-relaxed text-[11px] font-mono">
        <span className="text-neutral-500 mr-2 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
        <span className="inline-flex items-center space-x-1 text-blue-400 font-bold px-0.5 mr-2 shrink-0">
          <span>[</span>
          <span className="shrink-0"><ModuleIcon moduleId={log.module} className="w-3 h-3" /></span>
          <span className="ml-1">{log.module.replace('executor-', '').replace('channel-', '')}</span>
          <span>]</span>
        </span>
        <span className="text-neutral-300 break-all">{log.text}</span>
      </div>
    );
  };

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

  const handleDownloadDebugInfo = async () => {
    if (!task) return;
    const debugInfo = {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        workflowStatus: task.workflowStatus,
        agentState: task.agentState,
        protocol: task.protocol,
        chat: task.chat,
        moduleLogs: task.moduleLogs,
      },
      artifacts: taskArtifacts.map(a => ({
        name: a.name,
        content: a.content,
      })),
    };
    const blob = new Blob([JSON.stringify(debugInfo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-task-${task.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getCurrentAgentName = (task: Task) => {
    if (task.workflowStatus === 'TODO' && !task.protocol && !task.agentId) {
      return null;
    }
    if (task.protocol && task.protocol.steps) {
      const activeStep = task.protocol.steps.find(s => s.status === 'in_progress');
      if (activeStep) return activeStep.executor;
      
      const nextStep = task.protocol.steps.find(s => s.status === 'pending');
      if (nextStep) return nextStep.executor;
      
      const lastStep = [...task.protocol.steps].reverse().find(s => s.status === 'completed');
      if (lastStep) return lastStep.executor;
    }
    return task.agentId || 'Architect';
  };

  const currentAgent = getCurrentAgentName(task);

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
              {task.architectModel && (
                <span className="flex items-center text-[10px] font-mono px-2 py-1 rounded-full bg-neutral-800 text-neutral-400 border border-neutral-700 shrink-0" title={`Architect: ${task.architectModel}`}>
                  <BrainCircuit className="w-3 h-3 mr-1" />
                  {task.architectModel.replace('models/', '')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {task.agentState === 'WAITING_FOR_USER' && (
              <button
                onClick={() => {
                  if (onUpdateTask) {
                    onUpdateTask({
                      ...task,
                      workflowStatus: 'IN_PROGRESS',
                      agentState: 'IDLE'
                    });
                  }
                }}
                className="flex items-center px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-md text-sm font-medium transition-colors border border-blue-500/30 mr-2"
                title="Continue to next step"
              >
                <Play className="w-4 h-4 mr-1.5" />
                Continue
              </button>
            )}
            <button 
              onClick={handleDownloadDebugInfo}
              className="p-2 text-neutral-400 hover:text-blue-400 transition-colors"
              title="Download Debug Info"
            >
              <Download className="w-5 h-5" />
            </button>
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
                  {currentAgent ? (
                    <span className="flex items-center text-sm font-mono text-blue-400 bg-blue-400/10 px-3 py-1.5 rounded-md border border-blue-500/20">
                      {currentAgent}
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

                    {/* Removed AI Analysis as requested */}
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
                onClick={() => setActiveTab('protocol')}
                className={cn("flex items-center space-x-1.5 text-xs font-mono uppercase transition-colors", activeTab === 'protocol' ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
              >
                <Terminal className="w-3 h-3" />
                <span>Protocol</span>
              </button>
              <button 
                onClick={() => setActiveTab('chat')}
                className={cn("flex items-center space-x-1.5 text-xs font-mono uppercase transition-colors", activeTab === 'chat' ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
              >
                <MessageSquare className="w-3 h-3" />
                <span>Chat</span>
              </button>
              {Object.keys(task.moduleLogs || {}).map(moduleName => (
                <button 
                  key={moduleName}
                  onClick={() => setActiveTab(moduleName)}
                  className={cn("flex items-center space-x-1.5 text-xs font-mono uppercase transition-colors", activeTab === moduleName ? "text-white" : "text-neutral-500 hover:text-neutral-300")}
                >
                  <ModuleIcon moduleId={moduleName} className="w-3 h-3" />
                  <span>{moduleName.replace('executor-', '').replace('channel-', '')}</span>
                </button>
              ))}
            </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-neutral-300 custom-scrollbar">
              {activeTab === 'protocol' ? (
                <div className="space-y-4 font-sans">
                  {task.protocol ? (
                    task.protocol.steps.map((step, idx) => (
                      <div key={step.id} className="bg-neutral-900 border border-neutral-800 rounded p-3 flex flex-col gap-2 relative">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="bg-neutral-800 text-neutral-400 text-xs px-2 py-0.5 rounded-full font-mono">Step {idx + 1}</span>
                            <span className="text-sm font-semibold text-white">{step.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border",
                              step.executor === 'executor-jules' ? "bg-purple-900/30 text-purple-400 border-purple-800/50" : "bg-blue-900/30 text-blue-400 border-blue-800/50"
                            )}>
                              <ModuleIcon moduleId={step.executor || 'executor-local'} className="w-3 h-3" />
                              <span>{step.executor === 'executor-jules' ? 'Jules' : step.executor?.replace('executor-', '') || 'local'}</span>
                            </div>
                            <span className={cn(
                              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border",
                              step.status === 'completed' ? "bg-green-900/30 text-green-400 border-green-800/50" : 
                              step.status === 'in_progress' ? "bg-blue-900/30 text-blue-400 border-blue-800/50" : 
                              "bg-neutral-800 text-neutral-400 border-neutral-700"
                            )}>
                              {step.status.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-neutral-400">{step.description}</p>
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex items-center justify-center text-neutral-600 italic">
                      No protocol generated yet.
                    </div>
                  )}
                </div>
              ) : activeTab === 'chat' ? (
                <div className="space-y-1 font-mono text-xs text-neutral-400">
                  <div className="flex items-center space-x-2 mb-4 pb-2 border-b border-neutral-800">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Agent Chat</span>
                  </div>
                  {task.chat ? (
                    task.chat.split(/\r?\n/).map((line, i) => (
                      <LogLine key={i} log={{ timestamp: task.createdAt, module: 'user', text: line }} />
                    ))
                  ) : (
                    <div className="text-neutral-600 italic">No chat messages yet.</div>
                  )}
                </div>
              ) : (
                <div className="space-y-1 font-mono text-xs text-neutral-400">
                  <div className="flex items-center space-x-2 mb-4 pb-2 border-b border-neutral-800">
                    <ModuleIcon moduleId={activeTab} className="w-3 h-3" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">{activeTab.replace('executor-', '').replace('channel-', '')} Logs</span>
                  </div>
                  {task.structuredLogs ? (
                    task.structuredLogs
                      .filter(log => log.module === activeTab)
                      .map((log, i) => (
                        <LogLine key={i} log={log} />
                      ))
                  ) : (
                    <div className="text-neutral-600 italic">No logs for {activeTab} yet.</div>
                  )}
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
