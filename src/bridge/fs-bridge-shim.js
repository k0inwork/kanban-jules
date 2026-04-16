/**
 * fs-bridge-shim — replaces node:fs/promises and node:fs in almostnode
 * so Yuan file tools operate on the real v86 filesystem via boardVM.fsBridge.
 *
 * boardVM.fsBridge is registered by Go WASM (fsbridge.go) and exposes:
 *   readFile(path)        → string
 *   stat(path)            → {exists, isDir, size, mtime, mode}
 *   writeFile(path, data) → true | throws
 *   mkdir(path)           → true | throws
 *   readdir(path)         → [string]
 *   readdirWithInfo(path) → [{name, isDir, size}]
 *   exists(path)          → boolean
 */

function getBridge() {
  var b = globalThis.boardVM && globalThis.boardVM.fsBridge;
  if (!b) throw new Error('boardVM.fsBridge not available');
  return b;
}

function isErr(v) {
  return v instanceof Error;
}

// --- node:fs/promises shim ---

function stat(path) {
  var b = getBridge();
  var info = b.stat(path);
  if (!info.exists) {
    var err = new Error('ENOENT: no such file or directory, stat \'' + path + '\'');
    err.code = 'ENOENT';
    err.path = path;
    throw err;
  }
  return {
    isFile: function() { return !info.isDir; },
    isDirectory: function() { return info.isDir; },
    size: info.size,
    mode: info.mode,
    mtime: new Date(info.mtime),
  };
}

function readFile(path, encoding) {
  var b = getBridge();
  var result = b.readFile(path);
  if (isErr(result)) throw result;
  if (encoding === 'utf-8' || encoding === 'utf8') {
    return result;
  }
  // Return as Buffer-like string for binary compatibility
  return result;
}

function writeFile(path, data, opts) {
  var b = getBridge();
  var content = typeof data === 'string' ? data : String(data);
  var result = b.writeFile(path, content);
  if (isErr(result)) throw result;
  return;
}

function mkdir(path, opts) {
  var b = getBridge();
  var result = b.mkdir(path);
  if (isErr(result)) {
    // If recursive and already exists, that's ok
    if (opts && opts.recursive && result.message && result.message.indexOf('exists') >= 0) {
      return;
    }
    throw result;
  }
  return;
}

function readdir(path) {
  var b = getBridge();
  var result = b.readdir(path);
  if (isErr(result)) throw result;
  // Convert JS array to regular array
  var arr = [];
  for (var i = 0; i < result.length; i++) {
    arr.push(result[i]);
  }
  return arr;
}

function copyFile(src, dst) {
  // Best-effort: read then write
  var content = readFile(src);
  writeFile(dst, content);
  return;
}

function open(path, flags, mode) {
  // Return a file handle object that the tools use
  var b = getBridge();
  return {
    _path: path,
    _flags: flags,
    _content: null,
    _dirty: false,
    readFile: function() {
      var result = b.readFile(path);
      if (isErr(result)) throw result;
      // Return Buffer-like object
      var str = result;
      // Simulate Buffer from string
      return { toString: function(enc) { return str; }, length: str.length };
    },
    writeFile: function(data, enc) {
      var content = typeof data === 'string' ? data : String(data);
      var result = b.writeFile(path, content);
      if (isErr(result)) throw result;
      return;
    },
    close: function() {
      return;
    },
  };
}

// Export as node:fs/promises
module.exports = {
  stat: stat,
  readFile: readFile,
  writeFile: writeFile,
  mkdir: mkdir,
  readdir: readdir,
  copyFile: copyFile,
  open: open,
};

// Also export node:fs constants and sync variants
module.exports.constants = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_TRUNC: 512,
  O_NOFOLLOW: 131072,
};
