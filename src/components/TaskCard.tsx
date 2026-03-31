import React from 'react';
import { Task, TaskStatus } from '../types';
import { cn } from '../lib/utils';
import { Bot, Clock, AlertCircle, CheckCircle2, Play } from 'lucide-react';

interface TaskCardProps {
  task: Task;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: (task: Task) => void;
  onStartTask?: (task: Task) => void;
}

export default function TaskCard({ task, onDragStart, onClick, onStartTask }: TaskCardProps) {
  const statusColors = {
    'todo': 'border-neutral-700 bg-neutral-800/50',
    'in-progress': 'border-blue-500/50 bg-blue-950/20',
    'review': 'border-amber-500/50 bg-amber-950/20',
    'done': 'border-emerald-500/50 bg-emerald-950/20',
  };

  const handleStartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStartTask) {
      onStartTask(task);
    }
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onClick(task)}
      className={cn(
        "p-4 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing transition-colors hover:bg-neutral-800 relative group",
        statusColors[task.status]
      )}
    >
      <h4 className="font-medium text-neutral-100 mb-2 truncate pr-6">{task.title}</h4>
      
      {task.status === 'todo' && onStartTask && (
        <button 
          onClick={handleStartClick}
          className="absolute top-3 right-3 p-1.5 bg-blue-600/20 text-blue-400 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-600 hover:text-white"
          title="Assign to Agent"
        >
          <Play className="w-3.5 h-3.5" />
        </button>
      )}

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
        
        {task.status === 'in-progress' && <Clock className="w-4 h-4 text-blue-400 animate-pulse" />}
        {task.status === 'review' && <AlertCircle className="w-4 h-4 text-amber-400" />}
        {task.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
      </div>
    </div>
  );
}
