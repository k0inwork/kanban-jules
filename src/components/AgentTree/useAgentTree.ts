import { useState, useEffect, useRef } from 'react';
import { AgentTreeModel } from './AgentTreeModel';
import { AgentTreeState } from './types';
import { db } from '../../services/db';

const model = new AgentTreeModel();

export function useAgentTree(): AgentTreeState {
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
        const tasks = await db.tasks.toArray();
        const ids = tasks.map(t => t.id);
        await model.pruneStaleTasks(ids);
      } catch { /* DB not ready yet */ }
    })();
  }, []);

  // Always read live state from model on every render
  return model.getState();
}
