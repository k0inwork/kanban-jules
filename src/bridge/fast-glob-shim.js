/**
 * fast-glob-shim — delegates glob to Go WASM via boardVM.fsBridge.glob.
 * If Go glob not available, returns empty (fallback).
 */

function fg(patterns, options) {
  if (typeof patterns === 'string') patterns = [patterns];
  var b = globalThis.boardVM && globalThis.boardVM.fsBridge;
  if (b && b.glob) {
    try {
      return b.glob(JSON.stringify(patterns));
    } catch (e) {
      return [];
    }
  }
  return [];
}

fg.sync = function(patterns, options) {
  return fg(patterns, options);
};

fg.stream = function(patterns, options) {
  var results = fg(patterns, options);
  return {
    on: function(event, cb) {
      if (event === 'data') { for (var i = 0; i < results.length; i++) cb(results[i]); }
      if (event === 'end') cb();
      return this;
    }
  };
};

module.exports = fg;
module.exports.default = fg;
