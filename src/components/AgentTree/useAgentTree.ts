import { useState, useEffect, useRef } from 'react';
import { AgentTreeModel } from './AgentTreeModel';
import { AgentTreeState } from './types';
import { db } from '../../services/db';

const model = new AgentTreeModel();

export function useAgentTree(projectId?: string | null): AgentTreeState {
  const [, forceUpdate] = useState(0);
  const stateRef = useRef(model.getState());

  useEffect(() => {
    const unsub = model.subscribe(() => {
      stateRef.current = model.getState();
      forceUpdate(v => v + 1);
    });
    return unsub;
  }, []);

  // Prune stale task entries on mount (tasks removed from DB)
  useEffect(() => {
    (async () => {
      try {
        let tasks = await db.tasks.toArray();
        if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
        const ids = tasks.map(t => t.id);
        await model.pruneStaleTasks(ids);
      } catch { /* DB not ready yet */ }
    })();
  }, [projectId]);

  // Always read live state from model on every render
  return model.getState();
}
