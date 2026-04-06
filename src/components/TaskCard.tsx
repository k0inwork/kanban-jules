import React from 'react';
import { Task, WorkflowStatus, AgentState } from '../types';
import { cn } from '../lib/utils';
import { Bot, Clock, AlertCircle, CheckCircle2, Play, Trash2, Zap, User, Loader2 } from 'lucide-react';

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
  const [isOver, setIsOver] = React.useState(false);
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

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onClick(task)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "p-4 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing transition-all hover:bg-neutral-800 relative group",
        statusColors[task.workflowStatus],
        isOver && "ring-2 ring-blue-500 ring-offset-2 ring-offset-neutral-950 scale-[1.02]"
      )}
    >
      <h4 className="font-medium text-neutral-100 mb-2 truncate pr-12">{task.title}</h4>
      
      <div className="absolute top-3 right-3 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.workflowStatus === 'TODO' && onStartTask && (
          <button 
            onClick={handleStartClick}
            className="p-1.5 bg-blue-600/20 text-blue-400 rounded-md hover:bg-blue-600 hover:text-white transition-colors"
            title="Assign to Agent"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-xs text-neutral-400 line-clamp-2 mb-4">
        {task.description}
      </p>
      
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-neutral-800">
        <div className="flex items-center space-x-2">
          {task.agentId ? (
            <span className={cn(
              "flex items-center text-[10px] font-mono px-2 py-1 rounded-full",
              agentStateColors[task.agentState]
            )}>
              <Bot className="w-3 h-3 mr-1" />
              {task.agentId}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-neutral-500 px-2 py-1 rounded-full bg-neutral-800">
              Unassigned
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
  );
}
