import React from 'react';
import { Task, TaskStatus } from '../types';
import { cn } from '../lib/utils';
import { Bot, Clock, AlertCircle, CheckCircle2, Play, Trash2, Zap } from 'lucide-react';

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
  const statusColors: Record<TaskStatus, string> = {
    'INITIATED': 'border-neutral-700 bg-neutral-800/50',
    'WORKING': 'border-blue-500/50 bg-blue-950/20',
    'PAUSED': 'border-amber-500/50 bg-amber-950/20',
    'POLLING': 'border-purple-500/50 bg-purple-950/20',
    'REVIEW': 'border-amber-500/50 bg-amber-950/20',
    'DONE': 'border-emerald-500/50 bg-emerald-950/20',
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
        statusColors[task.status],
        isOver && "ring-2 ring-blue-500 ring-offset-2 ring-offset-neutral-950 scale-[1.02]"
      )}
    >
      <h4 className="font-medium text-neutral-100 mb-2 truncate pr-12">{task.title}</h4>
      
      <div className="absolute top-3 right-3 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.status === 'INITIATED' && onStartTask && (
          <button 
            onClick={handleStartClick}
            className="p-1.5 bg-blue-600/20 text-blue-400 rounded-md hover:bg-blue-600 hover:text-white transition-colors"
            title="Assign to Agent"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && (
          <button 
            onClick={handleDeleteClick}
            className="p-1.5 bg-red-600/20 text-red-400 rounded-md hover:bg-red-600 hover:text-white transition-colors"
            title="Delete Task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-xs text-neutral-400 line-clamp-2 mb-4">
        {task.description}
      </p>
      
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-neutral-800">
        <div className="flex items-center space-x-2">
          {task.agentId ? (
            <span className="flex items-center text-[10px] font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded-full">
              <Bot className="w-3 h-3 mr-1" />
              {task.agentId}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-neutral-500 px-2 py-1 rounded-full bg-neutral-800">
              Unassigned
            </span>
          )}
        </div>
        
        {task.status === 'WORKING' && <Clock className="w-4 h-4 text-blue-400 animate-pulse" />}
        {task.status === 'POLLING' && <Zap className="w-4 h-4 text-purple-400 animate-pulse" />}
        {task.status === 'PAUSED' && <AlertCircle className="w-4 h-4 text-amber-400" />}
        {task.status === 'REVIEW' && <AlertCircle className="w-4 h-4 text-amber-400" />}
        {task.status === 'DONE' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
      </div>
    </div>
  );
}
