/**
 * openai shim — written into almostnode VFS as /node_modules/openai/index.js
 *
 * Bridges OpenAI SDK calls to boardVM.llmfs.sendRequest().
 * The agent does `const { OpenAI } = require('openai')` and gets this shim.
 *
 * This is the proven pattern from test-yuan-almostnode.html.
 */

/* eslint-disable no-undef */
/* global globalThis */

function Completions(client) {
  this.client = client;
}

Completions.prototype.create = async function (params) {
  var req = {
    model: params.model || 'default',
    messages: params.messages || [],
    temperature: params.temperature,
    tools: params.tools,
    tool_choice: params.tool_choice,
  };
  var boardVM = globalThis.boardVM;
  if (!boardVM || !boardVM.llmfs) {
    throw new Error('boardVM.llmfs not available');
  }
  var resultJSON = await boardVM.llmfs.sendRequest(JSON.stringify(req));
  return JSON.parse(resultJSON);
};

function Chat(client) {
  this.completions = new Completions(client);
}

function OpenAI(opts) {
  this.apiKey = opts && opts.apiKey || '';
  this.baseURL = opts && opts.baseURL || '';
  this.chat = new Chat(this);
}

module.exports = { OpenAI: OpenAI, default: OpenAI };
