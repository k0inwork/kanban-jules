import React, { useState, useRef, useEffect } from 'react';
import { Task, WorkflowStatus, AgentState } from '../types';
import { cn } from '../lib/utils';
import { Bot, Clock, AlertCircle, CheckCircle2, Play, Trash2, Zap, User, Loader2, BrainCircuit, Terminal } from 'lucide-react';
import { createPortal } from 'react-dom';

interface TaskCardProps {
  key?: string | number;
  task: Task;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: (task: Task) => void;
  onStartTask?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onAttachArtifact?: (taskId: string, artifactId: number) => void;
}

export default function TaskCard({ task, onDragStart, onClick, onStartTask, onDelete, onAttachArtifact }: TaskCardProps) {
  const [isOver, setIsOver] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const statusColors: Record<WorkflowStatus, string> = {
    'TODO': 'border-neutral-700 bg-neutral-800/50',
    'IN_PROGRESS': 'border-blue-500/50 bg-blue-950/20',
    'IN_REVIEW': 'border-amber-500/50 bg-amber-950/20',
    'DONE': 'border-emerald-500/50 bg-emerald-950/20',
  };

  const agentStateColors: Record<AgentState, string> = {
    'IDLE': 'text-neutral-500 bg-neutral-800',
    'EXECUTING': 'text-blue-400 bg-blue-400/10 animate-pulse',
    'WAITING_FOR_EXECUTOR': 'text-purple-400 bg-purple-400/10',
    'WAITING_FOR_USER': 'text-rose-400 bg-rose-400/10 ring-1 ring-rose-500/50 animate-bounce',
    'PAUSED': 'text-amber-400 bg-amber-400/10',
    'ERROR': 'text-red-400 bg-red-400/10',
  };

  const handleStartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStartTask) {
      onStartTask(task);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(task.id);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('artifactId')) {
      e.preventDefault();
      setIsOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    const artifactId = e.dataTransfer.getData('artifactId');
    if (artifactId && onAttachArtifact) {
      e.preventDefault();
      e.stopPropagation();
      onAttachArtifact(task.id, parseInt(artifactId));
      setIsOver(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 800); // 800ms delay before showing popup
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

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

  const getModuleColor = (module: string) => {
    const hardcoded: Record<string, string> = {
      'orchestrator': 'text-blue-400',
      'architect': 'text-purple-400',
      'executor-github': 'text-emerald-400',
      'executor-jules': 'text-amber-400',
      'executor-local': 'text-cyan-400',
      'channel-user-negotiator': 'text-rose-400',
    };
    if (hardcoded[module]) return hardcoded[module];

    // Generate a color based on the module name string
    const colors = [
      'text-red-400', 'text-orange-400', 'text-yellow-400', 'text-lime-400', 
      'text-green-400', 'text-teal-400', 'text-sky-400', 'text-indigo-400', 
      'text-violet-400', 'text-fuchsia-400', 'text-pink-400'
    ];
    let hash = 0;
    for (let i = 0; i < module.length; i++) {
      hash = module.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Parse and sort logs chronologically
  const getSortedLogs = () => {
    if (!task.moduleLogs) return [];
    const logEntries: { time: string, module: string, text: string }[] = [];
    
    Object.entries(task.moduleLogs).forEach(([module, logs]) => {
      // Split by the start of a new log line (e.g., "> [18:20:34]")
      const entries = logs.split(/(?=> \[\d{2}:\d{2}:\d{2}\])/);
      entries.forEach(entry => {
        if (entry.trim()) {
          const cleanEntry = entry.trim();
          const timeMatch = cleanEntry.match(/> \[(\d{2}:\d{2}:\d{2})\]/);
          const time = timeMatch ? timeMatch[1] : '';
          
          let text = cleanEntry.replace(/> \[\d{2}:\d{2}:\d{2}\]\s*/, '');
          text = text.replace(/^>\s*\[.*?\]\s*/, ''); // Remove existing module prefix if any

          // Truncate long code blocks or messages
          if (text.length > 300 || text.includes('```') || text.includes('\n')) {
            const lines = text.split('\n');
            if (lines.length > 3) {
              text = lines.slice(0, 2).join('\n') + '\n... [code truncated, view in details] ...';
            } else if (text.length > 300) {
              text = text.substring(0, 297) + '...';
            }
          }

          logEntries.push({ time, module, text });
        }
      });
    });

    // Sort lexicographically by time
    logEntries.sort((a, b) => a.time.localeCompare(b.time));

    return logEntries.slice(-100); // Show last 100 lines
  };

  const sortedLogs = isHovered ? getSortedLogs() : [];

  return (
    <>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, task.id)}
        onClick={() => onClick(task)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        className={cn(
          "p-4 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing transition-all hover:bg-neutral-800 relative group",
          statusColors[task.workflowStatus],
          isOver && "ring-2 ring-blue-500 ring-offset-2 ring-offset-neutral-950 scale-[1.02]"
        )}
      >
        <h4 className="font-medium text-neutral-100 mb-2 truncate pr-12">{task.title}</h4>
        
        <div className="absolute top-3 right-3 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(task.workflowStatus === 'TODO' || (task.workflowStatus === 'IN_PROGRESS' && task.agentState !== 'EXECUTING')) && onStartTask && (
            <button 
              onClick={handleStartClick}
              className="p-1.5 bg-blue-600/20 text-blue-400 rounded-md hover:bg-blue-600 hover:text-white transition-colors"
              title={task.workflowStatus === 'TODO' ? "Assign to Agent" : "Resume Task"}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <p className="text-xs text-neutral-400 line-clamp-2 mb-4">
          {task.description}
        </p>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-neutral-800">
          <div className="flex items-center space-x-2 overflow-hidden">
            {currentAgent ? (
              <span className={cn(
                "flex items-center text-[10px] font-mono px-2 py-1 rounded-full whitespace-nowrap",
                agentStateColors[task.agentState]
              )}>
                <Bot className="w-3 h-3 mr-1 flex-shrink-0" />
                {currentAgent}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-neutral-500 px-2 py-1 rounded-full bg-neutral-800 whitespace-nowrap">
                Unassigned
              </span>
            )}
            {task.architectModel && (
              <span className="flex items-center text-[10px] font-mono px-2 py-1 rounded-full bg-neutral-800 text-neutral-400 whitespace-nowrap truncate" title={`Architect: ${task.architectModel}`}>
                <BrainCircuit className="w-3 h-3 mr-1 flex-shrink-0" />
                <span className="truncate max-w-[80px]">{task.architectModel.replace('models/', '')}</span>
              </span>
            )}
          </div>
          
          {task.agentState === 'EXECUTING' && <Clock className="w-4 h-4 text-blue-400 animate-pulse" />}
          {task.agentState === 'WAITING_FOR_EXECUTOR' && <Zap className="w-4 h-4 text-purple-400 animate-pulse" />}
          {task.agentState === 'WAITING_FOR_USER' && <User className="w-4 h-4 text-rose-400 animate-bounce" />}
          {task.agentState === 'PAUSED' && <AlertCircle className="w-4 h-4 text-amber-400" />}
          {task.agentState === 'ERROR' && <AlertCircle className="w-4 h-4 text-red-400" />}
          {task.workflowStatus === 'DONE' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        </div>
      </div>

      {isHovered && task.moduleLogs && Object.keys(task.moduleLogs).length > 0 && createPortal(
        <div 
          className="fixed z-[100] bg-[#0d1117] border border-neutral-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
          style={{
            left: Math.min(mousePos.x + 15, window.innerWidth - 520),
            top: Math.min(mousePos.y + 15, window.innerHeight - 420),
            width: 500,
            maxHeight: 400,
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
            setIsHovered(true);
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex items-center px-3 py-1.5 bg-[#161b22] border-b border-neutral-800">
            <Terminal className="w-3.5 h-3.5 text-neutral-400 mr-2" />
            <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Live Logs</span>
          </div>
          <div className="p-3 overflow-y-auto font-mono text-[10px] leading-relaxed text-neutral-300 custom-scrollbar flex flex-col min-h-0 pointer-events-auto">
            {sortedLogs.length > 0 ? (
              sortedLogs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap break-words opacity-90 mb-1 border-l-2 border-transparent hover:border-neutral-700 pl-2 transition-colors">
                  <span className="text-neutral-500 mr-2">[{log.time}]</span>
                  <span className={cn("font-semibold mr-2", getModuleColor(log.module))}>[{log.module.replace('executor-', '').replace('channel-', '')}]</span>
                  <span className="text-neutral-300">{log.text}</span>
                </div>
              ))
            ) : (
              <div className="text-neutral-600 italic">No logs available.</div>
            )}
            <div ref={(el) => el?.scrollIntoView()} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
