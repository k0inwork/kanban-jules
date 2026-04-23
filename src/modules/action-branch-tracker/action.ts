import { ActionContext } from '../../core/action-dispatcher';

export const action = {
  // Only fire when task has a branch
  filter: ({ to, task }: { to: string; task: any }) => to === 'DONE' && !!task.branchName,

  blocking: false,

  async execute({ event, registry, eventBus }: ActionContext) {
    const { task } = event.payload;
    const branchName = task.branchName;
    const commitSha = task.commitSha;
    const log = (msg: string) => eventBus.emit('module:log', { taskId: task.id, moduleId: 'actions', message: `[branch-tracker] ${msg}\n` });

    log(`Tracking branch ${branchName}${commitSha ? ` @ ${commitSha.slice(0, 7)}` : ''}`);

    // Record branch creation to KB
    await registry.invoke('knowledge-kb.recordEntry', {
      text: `Task "${task.title}" (${task.id}) completed on branch ${branchName}${commitSha ? ` at commit ${commitSha}` : ''}`,
      category: 'observation',
      abstraction: 2,
      layer: ['L0', 'L1'],
      tags: ['branch', 'git', task.id],
      source: 'action-branch-tracker',
      projectId: task.projectId,
    });

    // Update task with tracked branch info (ensures it's persisted even if executor didn't set it)
    const updates: Record<string, any> = {};
    if (branchName && !task.branchName) updates.branchName = branchName;
    if (commitSha && !task.commitSha) updates.commitSha = commitSha;
    if (Object.keys(updates).length > 0) {
      await registry.invoke('knowledge-board.updateTask', {
        task: task.id,
        updates,
      });
    }
    log('Done');
  },
};
