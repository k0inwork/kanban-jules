import { useState, useEffect, useRef } from 'react';
import { AgentTreeModel } from './AgentTreeModel';
import { AgentTreeState } from './types';
import { db } from '../../services/db';

const model = new AgentTreeModel();

export function useAgentTree(): AgentTreeState {
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    const unsub = model.subscribe(() => {
      if (mounted.current) setVersion(v => v + 1);
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
        await model.pruneStaleTasks(ids);
      } catch { /* DB not ready yet */ }
    })();
  }, []);

  // Return live model state (version forces re-render on every change)
  void version;
  return model.getState();
}
