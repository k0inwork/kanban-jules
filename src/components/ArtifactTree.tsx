import React, { useState, useEffect } from 'react';
import { Folder, ChevronRight, ChevronDown, Paperclip, Check, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Artifact, db } from '../services/db';
import { Task } from '../types';
import { cn } from '../lib/utils';

interface TreeNode {
  name: string;
  type: 'folder' | 'file';
  children?: TreeNode[];
  artifact?: Artifact;
  isLink?: boolean;
}

interface ArtifactTreeProps {
  artifacts: Artifact[];
  tasks: Task[];
  selectedIds?: number[];
  onToggle?: (ids: number[]) => void;
  onSelect?: (artifact: Artifact) => void;
  onDelete?: (id: number) => void;
  className?: string;
  showCheckboxes?: boolean;
}

export default function ArtifactTree({ 
  artifacts, 
  tasks, 
  selectedIds = [], 
  onToggle, 
  onSelect,
  onDelete,
  className,
  showCheckboxes = false
}: ArtifactTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const links = useLiveQuery(() => db.taskArtifactLinks.toArray()) || [];

  const buildTree = (artifacts: Artifact[], links: any[]): TreeNode[] => {
    const root: TreeNode[] = [];

    const addArtifactToTree = (artifact: Artifact, targetTaskId: string) => {
      const { repoName, branchName, name } = artifact;
      const task = tasks.find(t => t.id === targetTaskId);
      const taskName = task ? task.title : targetTaskId;
      const isLink = artifact.taskId !== targetTaskId;
      
      const path = [repoName || 'Unknown Repo', branchName || 'Unknown Branch', taskName].filter(Boolean);
      let currentLevel = root;

      path.forEach(part => {
        let node = currentLevel.find(n => n.name === part && n.type === 'folder');
        if (!node) {
          node = { name: part, type: 'folder', children: [] };
          currentLevel.push(node);
        }
        currentLevel = node.children!;
      });

      const existingFile = currentLevel.find(n => n.type === 'file' && n.artifact?.id === artifact.id);
      if (!existingFile) {
        currentLevel.push({ name, type: 'file', artifact, isLink });
      }
    };

    artifacts.forEach(artifact => addArtifactToTree(artifact, artifact.taskId));
    
    return root;
  };

  useEffect(() => {
    if (artifacts.length > 0) {
      setTree(buildTree(artifacts, links));
    }
  }, [artifacts, tasks, links]);

  const toggleExpand = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const getArtifactIdsUnderNode = (node: TreeNode): number[] => {
    let ids: number[] = [];
    if (node.artifact?.id) ids.push(node.artifact.id);
    if (node.children) {
      node.children.forEach(child => {
        ids = [...ids, ...getArtifactIdsUnderNode(child)];
      });
    }
    return ids;
  };

  const renderNode = (node: TreeNode, path: string = '') => {
    const currentPath = path ? `${path}/${node.name}` : node.name;
    const nodeKey = node.artifact ? `${currentPath}-${node.artifact.id}` : currentPath;
    const isExpanded = expanded.has(currentPath);
    
    const nodeArtifactIds = getArtifactIdsUnderNode(node);
    const isSelected = node.type === 'file' 
      ? node.artifact && selectedIds.includes(node.artifact.id!)
      : nodeArtifactIds.length > 0 && nodeArtifactIds.every(id => selectedIds.includes(id));
    const isPartiallySelected = node.type === 'folder' && !isSelected && nodeArtifactIds.some(id => selectedIds.includes(id));

    return (
      <div key={nodeKey} className="select-none">
        <div 
          draggable={node.type === 'file'}
          onDragStart={(e) => {
            if (node.type === 'file' && node.artifact) {
              e.dataTransfer.setData('artifactId', node.artifact.id!.toString());
              e.dataTransfer.effectAllowed = 'link';
            }
          }}
          className={cn(
            "flex items-center py-1 px-2 hover:bg-neutral-800 rounded-md cursor-pointer transition-colors text-sm group",
            node.type === 'file' ? "text-neutral-300" : "text-neutral-400 font-medium",
            isSelected && "bg-blue-500/10 text-blue-300"
          )}
          onClick={(e) => {
            if (node.type === 'folder') {
              if (showCheckboxes && onToggle) {
                // If all selected, unselect all. Otherwise, select all.
                onToggle(nodeArtifactIds);
              } else {
                toggleExpand(currentPath);
              }
            } else if (node.artifact) {
              if (onToggle) onToggle([node.artifact.id!]);
              if (onSelect) onSelect(node.artifact);
            }
          }}
        >
          {node.type === 'folder' && (
            <span 
              className="mr-1 p-1 hover:bg-neutral-700 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(currentPath);
              }}
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
          {node.type === 'folder' ? (
            <Folder className={cn("w-4 h-4 mr-2", isSelected ? "text-blue-400" : "text-blue-400/70")} />
          ) : (
            <Paperclip className="w-4 h-4 mr-2 text-neutral-500" />
          )}
          <span className="truncate flex-1">{node.name}</span>
          {node.artifact && node.isLink && (
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1 rounded ml-1 font-mono uppercase">Ref</span>
          )}
          {showCheckboxes && (isSelected || isPartiallySelected) && (
            <div className={cn(
              "w-3 h-3 ml-2 rounded-sm flex items-center justify-center",
              isSelected ? "bg-blue-500" : "bg-blue-500/50"
            )}>
              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
              {isPartiallySelected && <div className="w-1.5 h-0.5 bg-white rounded-full" />}
            </div>
          )}
          {onDelete && node.type === 'file' && node.artifact && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.artifact!.id!);
              }}
              title="Delete artifact"
              className="ml-2 p-1 hover:bg-red-500/20 text-neutral-500 hover:text-red-400 rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {node.type === 'folder' && isExpanded && node.children && (
          <div className="ml-4 border-l border-neutral-800 pl-2 mt-1 space-y-1">
            {node.children.map(child => renderNode(child, currentPath))}
          </div>
        )}
      </div>
    );
  };

  if (tree.length === 0) return <div className="text-xs text-neutral-500 font-mono p-2 italic">No artifacts found.</div>;

  return (
    <div className={cn("space-y-1", className)}>
      {tree.map(node => renderNode(node))}
    </div>
  );
}
