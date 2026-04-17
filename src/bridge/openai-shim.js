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

// Extract XML tool calls from LLM text output.
// Handles patterns like:
//   [tool_call]bash[arg_name]command[/arg_name][arg_value]ls[/arg_value][/tool_call]
// Also handles multiline tags. Tools are typically at the end of the response.
var _callId = 0;
var _skipTags = ['p','br','hr','div','span','a','img','code','pre','em','strong','b','i','u','li','ul','ol','h1','h2','h3','h4','h5','h6','table','tr','td','th','blockquote','details','summary','section','article','header','footer','nav','tool_call'];

// Dynamic known tools — updated from agent-bootstrap via setKnownToolNames()
var _dynamicKnownTools = [];

function setKnownToolNames(names) {
  _dynamicKnownTools = names || [];
}

function isKnownToolOrDynamic(name) {
  return isKnownTool(name) || _dynamicKnownTools.indexOf(name) >= 0;
}

function extractToolCalls(text) {
  var calls = [];
  var cleaned = text;

  // --- Pass 1: JS function call extraction ---
  // Matches: toolname({...}) — bare function calls with JSON object args
  // e.g. glob({"pattern": "**/*"}) or file_read({"path": "src/main.ts"})
  var allTools = _dynamicKnownTools.length > 0
    ? _dynamicKnownTools
    : ['bash', 'glob', 'grep', 'file_read', 'file_write', 'file_edit',
       'shell_exec', 'git_ops', 'test_run', 'code_search', 'security_scan',
       'web_search', 'parallel_web_search', 'task_complete', 'spawn_sub_agent'];

  // Build alternation: glob|file_read|file_edit|...
  var toolAlt = allTools.map(function(n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
  // Match: toolname({ ... }) with balanced braces
  var jsCallRe = new RegExp('(' + toolAlt + ')\\s*\\((\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})\\s*\\)', 'gm');
  var m;
  while ((m = jsCallRe.exec(text)) !== null) {
    var jsName = m[1];
    var jsJson = m[2];
    try {
      var jsArgs = JSON.parse(jsJson);
      _callId++;
      calls.push({
        id: 'call_js_' + _callId,
        type: 'function',
        function: { name: jsName, arguments: JSON.stringify(jsArgs) }
      });
      cleaned = cleaned.replace(m[0], '');
    } catch(e) {
      // Broken JSON — try to fix common issues (trailing commas, unquoted keys)
      try {
        var fixed = jsJson.replace(/,\s*}/g, '}').replace(/(\w+)\s*:/g, '"$1":');
        var jsArgs2 = JSON.parse(fixed);
        _callId++;
        calls.push({
          id: 'call_js_' + _callId,
          type: 'function',
          function: { name: jsName, arguments: JSON.stringify(jsArgs2) }
        });
        cleaned = cleaned.replace(m[0], '');
      } catch(e2) {
        // Really broken — skip
      }
    }
  }

  // --- Pass 1b: [tool_call]NAME[arg_name]ARG[/arg_name][arg_value]VAL[/arg_value]...[/tool_call] ---
  // Handles both [] and <> bracket types, mixed brackets in args, arg_name/arg_key, dots in tool names.
  var _ao = '(?:\\\\[|<)';   // matches [ or <
  var _ac = '(?:\\\\]|>)';   // matches ] or >
  var bracketPairs = [
    { o: '\\[', c: '\\]' },
    { o: '<', c: '>' }
  ];
  for (var bp = 0; bp < bracketPairs.length; bp++) {
    var bo = bracketPairs[bp].o;
    var bc = bracketPairs[bp].c;
    var tcRe = new RegExp(bo + 'tool_call' + bc + '\\s*([\\w.]+)\\s*((?:' + _ao + 'arg_\\w+' + _ac + '[\\s\\S]*?' + _ao + '/arg_\\w+' + _ac + _ao + 'arg_value' + _ac + '[\\s\\S]*?' + _ao + '/arg_value' + _ac + ')+)\\s*' + bo + '/tool_call' + bc, 'gm');
    while ((m = tcRe.exec(text)) !== null) {
      var tcName = m[1];
      var tcBody = m[2];
      var tcArgs = {};
      var pairRe = new RegExp(_ao + 'arg_(\\w+)' + _ac + '([\\s\\S]*?)' + _ao + '/arg_\\w+' + _ac + _ao + 'arg_value' + _ac + '([\\s\\S]*?)' + _ao + '/arg_value' + _ac, 'gm');
      var pm;
      while ((pm = pairRe.exec(tcBody)) !== null) {
        tcArgs[pm[1].trim()] = pm[2].trim();
      }
      _callId++;
      calls.push({
        id: 'call_tc_' + _callId,
        type: 'function',
        function: { name: tcName, arguments: JSON.stringify(tcArgs) }
      });
      cleaned = cleaned.replace(m[0], '');
    }
  }

  // --- Pass 1c: [toolname][arg_name]ARG[/arg_name][arg_value]VAL[/arg_value][/toolname] ---
  // Bare tool-name-as-tag with [] brackets (LLM follows [] example literally)
  var bareBrRe = /\[(\w+)((?:\[arg_name\][\s\S]*?\[\/arg_name\]\[arg_value\][\s\S]*?\[\/arg_value\])+)\[\/\1\]/gm;
  while ((m = bareBrRe.exec(text)) !== null) {
    var bbName = m[1];
    var bbBody = m[2];
    if (_skipTags.indexOf(bbName) >= 0) continue;
    var bbArgs = {};
    var bbPairRe = /\[arg_name\]([\s\S]*?)\[\/arg_name\]\[arg_value\]([\s\S]*?)\[\/arg_value\]/gm;
    var bbm;
    while ((bbm = bbPairRe.exec(bbBody)) !== null) {
      bbArgs[bbm[1].trim()] = bbm[2].trim();
    }
    if (Object.keys(bbArgs).length > 0 || isKnownToolOrDynamic(bbName)) {
      _callId++;
      calls.push({
        id: 'call_bb_' + _callId,
        type: 'function',
        function: { name: bbName, arguments: JSON.stringify(bbArgs) }
      });
      cleaned = cleaned.replace(m[0], '');
    }
  }

  // --- Pass 2: Legacy XML fallback (for LLMs that still produce XML) ---
  // Pattern 0: <name{JSON} — bare JSON after tag
  var bareJsonRe = /<([\w.]+)\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})\s*>?\s*/g;
  while ((m = bareJsonRe.exec(text)) !== null) {
    var tag0 = m[1];
    var json0 = m[2];
    if (_skipTags.indexOf(tag0) >= 0) continue;
    if (!isKnownToolOrDynamic(tag0)) continue;
    try {
      var args0 = JSON.parse(json0);
      _callId++;
      calls.push({
        id: 'call_xml_' + _callId,
        type: 'function',
        function: { name: tag0, arguments: JSON.stringify(args0) }
      });
      cleaned = cleaned.replace(m[0], '');
    } catch(e) {}
  }

  // Pattern 1: self-closing XML: <name attr="val" />
  var selfClosingRe = /<([\w.]+)((?:\s+[^>]*?)*)\s*\/>/gs;
  while ((m = selfClosingRe.exec(text)) !== null) {
    var tagName = m[1];
    var attrsStr = m[2];
    if (_skipTags.indexOf(tagName) >= 0) continue;
    var args = parseXmlAttrs(attrsStr);
    if (Object.keys(args).length > 0 || isKnownTool(tagName)) {
      _callId++;
      calls.push({
        id: 'call_xml_' + _callId,
        type: 'function',
        function: { name: tagName, arguments: JSON.stringify(args) }
      });
      cleaned = cleaned.replace(m[0], '');
    }
  }

  // Pattern 2: open/close XML: <name>JSON</name>
  var openCloseRe = /<([\w.]+)((?:\s+[^>]*?)*)>([\s\S]*?)<\/\1\s*>/g;
  while ((m = openCloseRe.exec(text)) !== null) {
    var tagName2 = m[1];
    var attrsStr2 = m[2];
    var body = m[3].trim();
    if (_skipTags.indexOf(tagName2) >= 0) continue;
    var args2 = {};
    if (body) {
      try { args2 = JSON.parse(body); } catch(e) {
        args2 = parseXmlAttrs(attrsStr2);
        if (!body.match(/^\s*{/) && !body.match(/^\s*\[/)) {
          args2._text = body;
        }
      }
    }
    if (attrsStr2) {
      var extraAttrs = parseXmlAttrs(attrsStr2);
      for (var k in extraAttrs) args2[k] = extraAttrs[k];
    }
    if (Object.keys(args2).length > 0 || isKnownTool(tagName2)) {
      _callId++;
      calls.push({
        id: 'call_xml_' + _callId,
        type: 'function',
        function: { name: tagName2, arguments: JSON.stringify(args2) }
      });
      cleaned = cleaned.replace(m[0], '');
    }
  }

  // Pattern 3: <tool_call name="...">JSON</tool_call >
  var toolCallRe = /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*tool_call\s*>/g;
  while ((m = toolCallRe.exec(text)) !== null) {
    var toolName = m[1];
    var toolBody = m[2].trim();
    var toolArgs = {};
    if (toolBody) {
      try { toolArgs = JSON.parse(toolBody); } catch(e) { toolArgs = { raw: toolBody }; }
    }
    _callId++;
    calls.push({
      id: 'call_xml_' + _callId,
      type: 'function',
      function: { name: toolName, arguments: JSON.stringify(toolArgs) }
    });
    cleaned = cleaned.replace(m[0], '');
  }

  // Deduplicate: if JS pass already caught a tool, skip XML duplicates for same tool+args
  var seen = new Set();
  var dedupedCalls = [];
  for (var ci = 0; ci < calls.length; ci++) {
    var sig = calls[ci].function.name + ':' + calls[ci].function.arguments;
    if (!seen.has(sig)) {
      seen.add(sig);
      dedupedCalls.push(calls[ci]);
    }
  }
  return { calls: dedupedCalls, cleaned: cleaned.trim() };
}

function parseXmlAttrs(str) {
  var attrs = {};
  if (!str) return attrs;
  // Match attr="value" or attr='value'
  var re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  var m;
  while ((m = re.exec(str)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  // Match bare boolean attrs (no value) — simple approach
  var parts = str.trim().split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].indexOf('=') < 0 && !attrs.hasOwnProperty(parts[i]) && /^[\w-]+$/.test(parts[i])) {
      attrs[parts[i]] = true;
    }
  }
  return attrs;
}

function isKnownTool(name) {
  var known = ['bash', 'glob', 'grep', 'file_read', 'file_write', 'file_edit',
    'shell_exec', 'git_ops', 'test_run', 'code_search', 'security_scan',
    'web_search', 'parallel_web_search', 'task_complete', 'spawn_sub_agent'];
  return known.indexOf(name) >= 0;
}

Completions.prototype.create = async function (params) {
  var req = {
    model: params.model || 'default',
    messages: params.messages || [],
    temperature: params.temperature,
    tools: params.tools,
    tool_choice: params.tool_choice,
    stream: false,
  };

  // ─── REQUEST LOG (compact) ───
  console.log('[openai-shim] → model:', req.model, 'tools:', (req.tools || []).length, 'msgs:', req.messages.length);
  if (req.tools && req.tools.length > 0) {
    var _g = req.tools.find(function(t) { return t.function && t.function.name === 'glob'; });
    if (_g) console.log('[openai-shim] glob schema:', JSON.stringify(_g.function.parameters).substring(0, 500));
  }

  var boardVM = globalThis.boardVM;
  if (!boardVM || !boardVM.llmfs) {
    throw new Error('boardVM.llmfs not available');
  }
  var resultJSON = await boardVM.llmfs.sendRequest(JSON.stringify(req));
  var result = JSON.parse(resultJSON);

  // ─── RESPONSE LOG (compact) ───
  var choice0 = result.choices && result.choices[0];
  if (choice0 && choice0.message) {
    console.log('[openai-shim] ← finish:', choice0.finish_reason, 'content_len:', (choice0.message.content || '').length, 'tool_calls:', (choice0.message.tool_calls || []).length);
    if (choice0.message.tool_calls && choice0.message.tool_calls.length > 0) {
      for (var _tci = 0; _tci < choice0.message.tool_calls.length; _tci++) {
        var _tc = choice0.message.tool_calls[_tci];
        console.log('[openai-shim] tool_call:', _tc.function && _tc.function.name, 'args:', (_tc.function && _tc.function.arguments) || '(none)');
      }
    }
  }

  // Extract XML tool calls from content — always check, even if structured tool_calls exist
  var choice = result.choices && result.choices[0];
  if (choice && choice.message) {
    var content = choice.message.content || '';
    if (content) {
      var extracted = extractToolCalls(content);
      if (extracted.calls.length > 0) {
        if (!choice.message.tool_calls) choice.message.tool_calls = [];
        // Append XML-extracted calls to any existing structured calls
        for (var i = 0; i < extracted.calls.length; i++) {
          choice.message.tool_calls.push(extracted.calls[i]);
        }
        choice.message.content = extracted.cleaned || null;
        console.log('[openai-shim] extracted', extracted.calls.length, 'tool calls from text:', extracted.calls.map(function(c) { return c.function.name; }).join(', '));
      }
    }
    console.log('[openai-shim] final: tool_calls=' + (choice.message.tool_calls?.length || 0));
  }

  // If the caller expects streaming, return async iterable of SSE-style delta chunks.
  // BYOKClient.chatStream expects: choices[0].delta.content for text,
  // choices[0].delta.tool_calls[] for tool calls (with index, id, function.name, function.arguments).
  if (params && params.stream) {
    var choice0 = result.choices && result.choices[0];
    var msg = choice0 && choice0.message;
    var chunks = [];

    // Text delta chunk
    if (msg && typeof msg.content === 'string' && msg.content.length > 0) {
      chunks.push({
        id: result.id,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: msg.content }, finish_reason: null }],
      });
    }

    // Tool call delta chunks — one per tool call, each with full args (single-chunk)
    if (msg && Array.isArray(msg.tool_calls)) {
      for (var tci = 0; tci < msg.tool_calls.length; tci++) {
        var tc = msg.tool_calls[tci];
        chunks.push({
          id: result.id,
          object: 'chat.completion.chunk',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: tci,
                id: tc.id || ('call_' + tci),
                type: 'function',
                function: {
                  name: (tc.function && tc.function.name) || tc.name || '',
                  arguments: (tc.function && tc.function.arguments) || (tc.arguments ? JSON.stringify(tc.arguments) : '{}'),
                },
              }],
            },
            finish_reason: null,
          }],
        });
      }
    }

    // Role chunk (first chunk in OpenAI streams has role)
    chunks.unshift({
      id: result.id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    });

    // Usage chunk (final)
    chunks.push({
      id: result.id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: choice0 ? choice0.finish_reason : 'stop' }],
      usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });

    var chunkIdx = 0;
    var streamResult = {
      response: result,
      [Symbol.asyncIterator]: function() {
        return {
          next: function() {
            if (chunkIdx >= chunks.length) return Promise.resolve({ done: true });
            return Promise.resolve({ value: chunks[chunkIdx++], done: false });
          }
        };
      }
    };
    return streamResult;
  }

  return result;
};

function Chat(client) {
  this.completions = new Completions(client);
}

// Error classes that @yuaone/core may check with instanceof
function APIError(message, status, headers, error) {
  this.name = 'APIError';
  this.message = message || '';
  this.status = status;
  this.headers = headers;
  this.error = error;
}
APIError.prototype = Object.create(Error.prototype);
APIError.prototype.constructor = APIError;

function APIConnectionError(message) {
  this.name = 'APIConnectionError';
  this.message = message || '';
}
APIConnectionError.prototype = Object.create(Error.prototype);
APIConnectionError.prototype.constructor = APIConnectionError;

function RateLimitError(message, status, headers) {
  this.name = 'RateLimitError';
  this.message = message || '';
  this.status = status;
  this.headers = headers;
}
RateLimitError.prototype = Object.create(Error.prototype);
RateLimitError.prototype.constructor = RateLimitError;

function NotFoundError(message, status, headers) {
  this.name = 'NotFoundError';
  this.message = message || '';
}
NotFoundError.prototype = Object.create(Error.prototype);
NotFoundError.prototype.constructor = NotFoundError;

function AuthenticationError(message, status, headers) {
  this.name = 'AuthenticationError';
  this.message = message || '';
}
AuthenticationError.prototype = Object.create(Error.prototype);
AuthenticationError.prototype.constructor = AuthenticationError;

function OpenAI(opts) {
  this.apiKey = opts && opts.apiKey || '';
  this.baseURL = opts && opts.baseURL || '';
  this.chat = new Chat(this);
}

// Support both CJS and ESM import patterns:
//   const { OpenAI } = require('openai')       → named export
//   const OpenAI = require('openai').default    → ESM default import (what @yuaone/core uses)
//   const OpenAI = require('openai')            → direct require
module.exports = OpenAI;
module.exports.OpenAI = OpenAI;
module.exports.default = OpenAI;
module.exports.__esModule = true;
module.exports.APIError = APIError;
module.exports.APIConnectionError = APIConnectionError;
module.exports.RateLimitError = RateLimitError;
module.exports.NotFoundError = NotFoundError;
module.exports.AuthenticationError = AuthenticationError;
module.exports.setKnownToolNames = setKnownToolNames;
