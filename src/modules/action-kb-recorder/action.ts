import { ActionContext } from '../../core/action-dispatcher';

export const action = {
  // Only fire when task moves to DONE (manifestFilter handles this, but keep explicit)
  filter: ({ to }: { to: string }) => to === 'DONE',

  blocking: false,

  async execute({ event, registry, eventBus }: ActionContext) {
    const { task } = event.payload;
    const log = (msg: string) => eventBus.emit('module:log', { taskId: task.id, moduleId: 'actions', message: `[kb-recorder] ${msg}\n` });

    log('Recording task completion...');

    // Record task completion to KB
    await registry.invoke('knowledge-kb.recordEntry', {
      text: `Task ${task.id} completed successfully: ${task.title}`,
      category: 'observation',
      abstraction: 1,
      layer: ['L1'],
      tags: [task.id, 'execution', 'completion'],
      source: 'execution',
      projectId: task.projectId,
    });

    // Save architect's declared decisions to KB
    const protocol = task.protocol;
    if (protocol?.decisions && Array.isArray(protocol.decisions)) {
      for (const decision of protocol.decisions) {
        if (decision.text) {
          await registry.invoke('knowledge-kb.recordEntry', {
            text: decision.text,
            category: 'decision',
            abstraction: 4,
            layer: ['L0', 'L1'],
            tags: [...(decision.tags || []), task.id, 'architect-declared'],
            source: 'decision',
            projectId: task.projectId,
          });
        }
      }
    }

    // Emit executor:completed for commit-harvest (triggers decision extraction from git)
    log('Emitting executor:completed for commit-harvest');
    eventBus.emit('executor:completed', {
      taskId: task.id,
      executor: 'executor-local',
      startedAt: task.createdAt,
    });

    // Trigger microDream for consolidation
    log('Triggering microDream');
    await registry.invoke('process-dream.microDream', { taskId: task.id });
    log('Done');
  },
};
