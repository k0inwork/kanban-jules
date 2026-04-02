import React from 'react';
import { Task, TaskStatus } from '../types';
import KanbanColumn from './KanbanColumn';

interface KanbanBoardProps {
  tasks: Task[];
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onTaskClick: (task: Task) => void;
  onStartTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
  onAttachArtifact?: (taskId: string, artifactId: number) => void;
}

export default function KanbanBoard({ tasks, onMoveTask, onTaskClick, onStartTask, onDeleteTask, onAttachArtifact }: KanbanBoardProps) {
  const columns: { title: string; status: TaskStatus }[] = [
    { title: 'Initiated', status: 'INITIATED' },
    { title: 'Working', status: 'WORKING' },
    { title: 'Paused', status: 'PAUSED' },
    { title: 'Polling', status: 'POLLING' },
    { title: 'Review', status: 'REVIEW' },
    { title: 'Done', status: 'DONE' },
  ];

  return (
    <div className="flex-1 flex h-full space-x-4 p-4 overflow-x-auto custom-scrollbar">
      {columns.map((col) => (
        <KanbanColumn
          key={col.status}
          title={col.title}
          status={col.status}
          tasks={tasks.filter((t) => t.status === col.status)}
          onDrop={onMoveTask}
          onTaskClick={onTaskClick}
          onStartTask={onStartTask}
          onDeleteTask={onDeleteTask}
          onAttachArtifact={onAttachArtifact}
        />
      ))}
    </div>
  );
}
