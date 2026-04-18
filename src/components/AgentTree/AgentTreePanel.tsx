import React from 'react';
import { useAgentTree } from './useAgentTree';
import { AgentTreeNode, NodeState } from './types';

const STATE_STYLES: Record<NodeState, { dot: string; color: string; label: string }> = {
  idle:     { dot: '○', color: 'text-gray-400', label: 'idle' },
  pending:  { dot: '◌', color: 'text-gray-500', label: 'pending' },
  running:  { dot: '●', color: 'text-blue-400', label: 'running' },
  waiting:  { dot: '◔', color: 'text-yellow-400', label: 'waiting' },
  completed:{ dot: '✓', color: 'text-green-400', label: 'done' },
  error:    { dot: '✗', color: 'text-red-400', label: 'error' },
};

function TreeNode({ node, depth }: { node: AgentTreeNode; depth: number }) {
  const [expanded, setExpanded] = React.useState(true);
  const s = STATE_STYLES[node.state];
  const hasChildren = node.children.length > 0;

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer hover:bg-gray-700/40 ${s.color}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => hasChildren && setExpanded(e => !e)}
      >
        {hasChildren ? (
          <span className="text-[10px] w-3 text-gray-500">{expanded ? '▼' : '▶'}</span>
        ) : (
          <span className="w-3" />
        )}
        <span className="text-xs">{s.dot}</span>
        <span className="text-xs font-medium truncate">{node.name}</span>
        {node.detail && (
          <span className="text-[10px] text-gray-500 truncate ml-1">— {node.detail}</span>
        )}
        {node.durationMs != null && node.state !== 'running' && (
          <span className="text-[10px] text-gray-600 ml-auto whitespace-nowrap">
            {(node.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentTreePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAgentTree();

  if (!open) return null;

  const tasks = state.taskOrder
    .map(id => state.tasks.get(id))
    .filter(Boolean) as AgentTreeNode[];

  return (
    <div className="w-72 border-l border-gray-700 bg-gray-900 flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Agent Tree</span>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tasks.length === 0 ? (
          <div className="text-gray-600 text-xs px-3 py-4 text-center italic">
            No active tasks
          </div>
        ) : (
          tasks.map(task => <TreeNode key={task.id} node={task} depth={0} />)
        )}
      </div>
    </div>
  );
}
