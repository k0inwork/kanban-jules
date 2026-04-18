/**
 * fs-bridge-shim — replaces node:fs/promises and node:fs in almostnode
 * so Yuan file tools operate on the real v86 filesystem via boardVM.fsBridge.
 *
 * boardVM.fsBridge methods return Promises (Go WASM runs IDB ops in goroutines
 * to avoid deadlocking the JS event loop).
 */

function getBridge() {
  var b = globalThis.boardVM && globalThis.boardVM.fsBridge;
  if (!b) throw new Error('boardVM.fsBridge not available');
  return b;
}

// --- node:fs/promises shim (all async) ---

async function stat(path) {
  var b = getBridge();
  var info = await b.stat(path);
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

async function readFile(path, encoding) {
  var b = getBridge();
  var result = await b.readFile(path);
  if (result instanceof Error) throw result;
  if (encoding === 'utf-8' || encoding === 'utf8') {
    return result;
  }
  return result;
}

async function writeFile(path, data, opts) {
  var b = getBridge();
  var content = typeof data === 'string' ? data : String(data);
  var result = await b.writeFile(path, content);
  if (result instanceof Error) throw result;
  return;
}

async function mkdir(path, opts) {
  var b = getBridge();
  var result = await b.mkdir(path);
  if (result instanceof Error) {
    if (opts && opts.recursive && result.message && result.message.indexOf('exists') >= 0) {
      return;
    }
    throw result;
  }
  return;
}

async function readdir(path) {
  var b = getBridge();
  var result = await b.readdir(path);
  if (result instanceof Error) throw result;
  var arr = [];
  for (var i = 0; i < result.length; i++) {
    arr.push(result[i]);
  }
  return arr;
}

async function copyFile(src, dst) {
  var content = await readFile(src);
  await writeFile(dst, content);
  return;
}

async function open(path, flags, mode) {
  var b = getBridge();
  var content = await b.readFile(path);
  if (content instanceof Error) throw content;
  return {
    _path: path,
    readFile: async function() {
      var r = await b.readFile(path);
      if (r instanceof Error) throw r;
      return { toString: function() { return r; }, length: r.length };
    },
    writeFile: async function(data) {
      var c = typeof data === 'string' ? data : String(data);
      var r = await b.writeFile(path, c);
      if (r instanceof Error) throw r;
    },
    close: function() {},
  };
}

// --- node:fs sync shim (uses internal cache, falls back to sync bridge if available) ---

// Sync variants: these try the bridge synchronously. If the bridge is async-only,
// they throw. Yuan's tools mostly use the async API, but some internal code
// may call sync variants.
function readFileSync(path, encoding) {
  // Sync not supported with async bridge — tools should use async readFile
  throw new Error('readFileSync not supported: use fs.promises.readFile (async)');
}

function writeFileSync(path, data, opts) {
  throw new Error('writeFileSync not supported: use fs.promises.writeFile (async)');
}

function readdirSync(path) {
  throw new Error('readdirSync not supported: use fs.promises.readdir (async)');
}

function statSync(path) {
  throw new Error('statSync not supported: use fs.promises.stat (async)');
}

function existsSync(path) {
  // Best-effort: try async exists (won't block, just returns promise)
  // Sync callers should migrate to async
  throw new Error('existsSync not supported: use fs.promises.stat (async)');
}

function mkdirSync(path, opts) {
  throw new Error('mkdirSync not supported: use fs.promises.mkdir (async)');
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
  // Sync stubs
  readFileSync: readFileSync,
  writeFileSync: writeFileSync,
  readdirSync: readdirSync,
  statSync: statSync,
  existsSync: existsSync,
  mkdirSync: mkdirSync,
  // Promise-based access
  promises: {
    stat: stat,
    readFile: readFile,
    writeFile: writeFile,
    mkdir: mkdir,
    readdir: readdir,
    copyFile: copyFile,
    open: open,
  },
};

module.exports.constants = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_TRUNC: 512,
  O_NOFOLLOW: 131072,
};
