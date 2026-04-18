import { useState, useEffect, useRef } from 'react';
import { AgentTreeModel } from './AgentTreeModel';
import { AgentTreeState } from './types';
import { db } from '../../services/db';

const model = new AgentTreeModel();

export function useAgentTree(): AgentTreeState {
  const [state, setState] = useState<AgentTreeState>(model.getState());
  const mounted = useRef(true);

  useEffect(() => {
    const unsub = model.subscribe((next) => {
      if (mounted.current) setState(next);
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, []);

  // Prune stale task entries on mount (tasks removed from DB)
  useEffect(() => {
    (async () => {
      try {
        const tasks = await db.tasks.toArray();
        const ids = tasks.map(t => t.id);
        // Keep yuan-agent entry too
        ids.push('yuan-agent');
        await model.pruneStaleTasks(ids);
      } catch { /* DB not ready yet */ }
    })();
  }, []);

  return state;
}
