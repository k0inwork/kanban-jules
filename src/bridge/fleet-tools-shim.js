/**
 * @fleet/tools shim — written into almostnode VFS as /node_modules/@fleet/tools/index.js
 *
 * Exposes all Fleet tools as async functions callable from inside almostnode.
 * Each function calls boardVM.dispatchTool(name, args) which routes through
 * Fleet's ModuleRegistry.invokeHandler().
 *
 * Tools are discovered dynamically from boardVM.toolfs.listTools(), which
 * reads sandboxBindings from all enabled module manifests. No hardcoded list.
 *
 * Usage inside almostnode:
 *   const tools = require('@fleet/tools');
 *   const content = await tools.readFile({ path: '/src/foo.ts' });
 */

/* eslint-disable no-undef */
/* global globalThis */

var tools = {};

function registerTool(name) {
  tools[name] = async function () {
    var args = Array.prototype.slice.call(arguments);
    var boardVM = globalThis.boardVM;
    if (!boardVM || !boardVM.dispatchTool) {
      throw new Error('boardVM.dispatchTool not available');
    }
    return boardVM.dispatchTool(name, args);
  };
}

// Dynamically discover and register all tools from boardVM.toolfs.listTools()
// This is called synchronously at require() time. listTools() returns JSON
// array of { name, description } — each name is a short sandbox binding name.
var boardVM = globalThis.boardVM;
if (boardVM && boardVM.toolfs && boardVM.toolfs.listTools) {
  try {
    // listTools is async but in almostnode's sync context we need to handle it
    // Use the sync bridge: if listTools returns a promise, resolve it via callback
    var toolsJSON = boardVM.toolfs.listTools();
    // In almostnode, async functions return promises. We need sync access.
    // The agent runner will call _fleetToolsInit() after async resolution.
    if (typeof toolsJSON === 'object' && toolsJSON.then) {
      // Async — register placeholder that self-populates
      toolsJSON.then(function(json) {
        var toolList = JSON.parse(json);
        for (var i = 0; i < toolList.length; i++) {
          if (!tools[toolList[i].name]) {
            registerTool(toolList[i].name);
          }
        }
      });
    } else {
      // Sync (unlikely but safe)
      var toolList = JSON.parse(toolsJSON);
      for (var i = 0; i < toolList.length; i++) {
        registerTool(toolList[i].name);
      }
    }
  } catch (e) {
    console.error('[@fleet/tools] dynamic discovery failed, falling back:', e);
  }
} else {
  console.warn('[@fleet/tools] boardVM.toolfs not available at load time');
}

// Expose a function the agent runner can call to ensure tools are ready
tools._ensureLoaded = function() {
  return Promise.resolve(tools);
};

module.exports = tools;
