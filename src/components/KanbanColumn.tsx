import React from 'react';
import { Task, WorkflowStatus } from '../types';
import TaskCard from './TaskCard';

interface KanbanColumnProps {
  key?: string | number;
  title: string;
  status: WorkflowStatus;
  tasks: Task[];
  onDrop: (taskId: string, newStatus: WorkflowStatus) => void;
  onTaskClick: (task: Task) => void;
  onStartTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
  onAttachArtifact?: (taskId: string, artifactId: number) => void;
}

export default function KanbanColumn({ title, status, tasks, onDrop, onTaskClick, onStartTask, onDeleteTask, onAttachArtifact }: KanbanColumnProps) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('taskId')) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) {
      onDrop(taskId, status);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('taskId', id);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex-1 flex flex-col bg-neutral-900/40 rounded-xl border border-neutral-800/60 overflow-hidden min-w-[280px] h-full"
    >
      <div className="p-4 border-b border-neutral-800/60 bg-neutral-900/80 flex items-center justify-between">
        <h3 className="font-mono text-sm font-semibold text-neutral-300 uppercase tracking-wider">
          {title}
        </h3>
        <span className="bg-neutral-800 text-neutral-400 text-xs py-0.5 px-2 rounded-full font-mono">
          {tasks.length}
        </span>
      </div>
      
      <div className="flex-1 p-3 overflow-y-auto space-y-3 custom-scrollbar min-h-0">
        {tasks.map((task) => (
          <TaskCard 
            key={task.id} 
            task={task} 
            onDragStart={handleDragStart}
            onClick={onTaskClick}
            onStartTask={onStartTask}
            onDelete={onDeleteTask}
            onAttachArtifact={onAttachArtifact}
          />
        ))}
        {tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm font-mono border-2 border-dashed border-neutral-800 rounded-lg py-12">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}
