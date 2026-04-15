/**
 * Bridge module — connects almostnode (YUAN agent) to Fleet's module system.
 *
 * Usage:
 *   import { installBoardVM, registerYuanWithBoardVM } from './bridge';
 *   installBoardVM();
 *   registerYuanWithBoardVM();
 */

export { boardVM, installBoardVM, setBoardVMLLMCall, setBoardVMHostConfig } from './boardVM';
export { initYuanAgent, sendToYuanAgent, getYuanStatus, registerYuanWithBoardVM } from './agent-bootstrap';
