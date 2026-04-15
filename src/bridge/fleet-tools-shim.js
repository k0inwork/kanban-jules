/**
 * @fleet/tools shim — written into almostnode VFS as /node_modules/@fleet/tools/index.js
 *
 * Exposes all Fleet tools as async functions callable from inside almostnode.
 * Each function calls boardVM.dispatchTool(name, args) which routes through
 * Fleet's ModuleRegistry.invokeHandler().
 *
 * Usage inside almostnode:
 *   const tools = require('@fleet/tools');
 *   const content = await tools.readFile({ path: '/src/foo.ts' });
 */

/* eslint-disable no-undef */
/* global globalThis */

var tools = {};
var boardVM = globalThis.boardVM;

function registerTool(name) {
  tools[name] = async function () {
    var args = Array.prototype.slice.call(arguments);
    if (!boardVM) boardVM = globalThis.boardVM;
    if (!boardVM || !boardVM.dispatchTool) {
      throw new Error('boardVM.dispatchTool not available');
    }
    return boardVM.dispatchTool(name, args);
  };
}

// File operations (knowledge-repo-browser)
registerTool('readFile');
registerTool('writeFile');
registerTool('listFiles');
registerTool('headFile');

// Artifacts (knowledge-artifacts)
registerTool('saveArtifact');
registerTool('listArtifacts');
registerTool('readArtifact');

// User interaction (channel-user-negotiator)
registerTool('askUser');

// Jules executor (executor-jules)
registerTool('askJules');

// GitHub executor (executor-github)
registerTool('runWorkflow');
registerTool('getRunStatus');
registerTool('fetchArtifacts');

// Local analyzer (knowledge-local-analyzer)
registerTool('scan');

// Host tools
registerTool('analyze');
registerTool('addToContext');
registerTool('globalVarsGet');
registerTool('globalVarsSet');

// Bash/shell (executor-wasm)
registerTool('bash');

module.exports = tools;
