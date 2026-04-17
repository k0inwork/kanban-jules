#!/usr/bin/env node
/**
 * bundle-yuaone.mjs — packs @yuaone/core and @yuaone/tools dist/ files
 * into JSON bundles that agent-bootstrap.ts loads into almostnode VFS.
 * Transforms ESM exports to CJS so almostnode's require() works.
 *
 * Pipeline: node_modules/@yuaone/* → ESM→CJS transform → public/assets/wasm/yuaone-bundles/*.json
 * Runtime: agent-bootstrap.ts fetches bundles → writes into almostnode VFS
 *
 * Usage: node scripts/bundle-yuaone.mjs
 * Output: public/assets/wasm/yuaone-bundles/*.json + manifest.json
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_DIR = join(ROOT, 'public/assets/wasm/yuaone-bundles');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

const PACKAGES = ['@yuaone/core', '@yuaone/tools'];

mkdirSync(OUT_DIR, { recursive: true });

// --- Load or create manifest ---
let manifest = {};
if (existsSync(MANIFEST_PATH)) {
  try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')); } catch {}
}

function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Transform ESM to CJS for almostnode's CJS-only require().
 * Handles:
 *   export { X, Y } from './mod.js'      → const ... = require('./mod.js'); module.exports = { X, Y }
 *   export { X }                          → module.exports.X = X
 *   export class Foo { ... }              → class Foo { ... }; module.exports.Foo = Foo
 *   export function bar() {}              → function bar() {}; module.exports.bar = bar
 *   export const/let/var x = ...          → const/let/var x = ...; module.exports.x = x
 *   export default X                      → module.exports.default = X
 *   import { X } from './mod.js'          → const { X } = require('./mod.js')
 *   import X from './mod.js'              → const X = require('./mod.js').default
 * Also strips .js extensions from relative imports for VFS compatibility.
 */
function esmToCJS(code) {
  const exports = [];

  // Remove sourcemap comments
  code = code.replace(/\/\/#\s*sourceMappingURL=.*$/gm, '');

  // import { X, Y } from './mod.js'  →  const { X, Y } = require('./mod')
  // import { X as Y } from './mod'   →  const { X: Y } = require('./mod')
  code = code.replace(
    /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?\s*$/gm,
    (_, names, _q, mod) => {
      const cjsNames = names.replace(/\bas\s+/g, ': ');
      return `const { ${cjsNames} } = require(${stripExt(mod)});`;
    }
  );

  // import X from './mod.js'  →  const X = require('./mod').default
  code = code.replace(
    /^import\s+(\w+)\s+from\s*(['"])([^'"]+)\2\s*;?\s*$/gm,
    (_, name, _q, mod) => {
      return `const ${name} = require(${stripExt(mod)}).default;`;
    }
  );

  // import * as X from './mod.js'  →  const X = require('./mod')
  code = code.replace(
    /^import\s*\*\s*as\s+(\w+)\s+from\s*(['"])([^'"]+)\2\s*;?\s*$/gm,
    (_, name, _q, mod) => {
      return `const ${name} = require(${stripExt(mod)});`;
    }
  );

  // export { X } from './mod.js'  →  const _X = require('./mod'); module.exports.X = _X.X
  code = code.replace(
    /^export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?\s*$/gm,
    (_full, names, _q, mod) => {
      const cjsNames = names.replace(/\bas\s+/g, ': ');
      const items = names.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        const local = parts[0].trim();
        const exported = parts[1]?.trim() || local;
        return exported;
      }).filter(Boolean);
      exports.push(...items);
      return `const { ${cjsNames} } = require(${stripExt(mod)});`;
    }
  );

  // export { X, Y }  →  module.exports.X = X; etc (collected and emitted at end)
  code = code.replace(
    /^export\s*\{([^}]*)\}\s*;?\s*$/gm,
    (_, names) => {
      const items = names.split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        const local = parts[0].trim();
        const exported = parts[1]?.trim() || local;
        return exported;
      }).filter(Boolean);
      exports.push(...items);
      return '';
    }
  );

  // export class Foo { ... }  →  class Foo { ... }; exports.push('Foo')
  code = code.replace(
    /^export\s+(class|function|const|let|var|async\s+function)\s+(\w+)/gm,
    (_, keyword, name) => {
      exports.push(name);
      return `${keyword} ${name}`;
    }
  );

  // export default X
  code = code.replace(
    /^export\s+default\s+/gm,
    () => {
      exports.push('default');
      return '';
    }
  );

  // Append module.exports
  if (exports.length > 0) {
    // Deduplicate
    const unique = [...new Set(exports)];
    code += '\n\n// Auto-converted from ESM to CJS\n';
    for (const name of unique) {
      if (name === 'default') {
        code += `module.exports.default = module.exports.default || undefined;\n`;
      } else {
        code += `if (typeof ${name} !== 'undefined') module.exports.${name} = ${name};\n`;
      }
    }
  }

  // Also fix remaining .js extensions in require() paths
  code = code.replace(/require\(\s*(['"])(\.\/[^'"]+)\.js\s*\1\s*\)/g, 'require($1$2$1)');

  return code;
}

function stripExt(modPath) {
  // Strip .js extension from relative paths for VFS
  if (modPath.startsWith('.')) {
    return `'${modPath.replace(/\.js$/, '')}'`;
  }
  return `'${modPath}'`;
}

// --- Main: bundle each package ---

let changed = false;

for (const pkg of PACKAGES) {
  const distDir = join(ROOT, 'node_modules', pkg, 'dist');
  const outName = pkg.replace('/', '_') + '.json';
  const outPath = join(OUT_DIR, outName);

  if (!statSync(distDir, { throwIfNoEntry: false })) {
    // Package not installed locally — keep existing bundle, ensure manifest entry
    if (statSync(outPath, { throwIfNoEntry: false })) {
      const existingRaw = readFileSync(outPath, 'utf-8');
      const hash = createHash('sha256').update(existingRaw).digest('hex').slice(0, 16);
      if (!manifest[pkg] || manifest[pkg].hash !== hash) {
        const parsed = JSON.parse(existingRaw);
        manifest[pkg] = {
          version: manifest[pkg]?.version || 'unknown',
          files: Object.keys(parsed).length,
          hash,
          bundledAt: manifest[pkg]?.bundledAt || new Date().toISOString(),
          bundleFile: outName,
        };
        changed = true;
      }
      console.log(`skip ${pkg}: not in node_modules, keeping existing ${outName} (hash ${hash})`);
      continue;
    }
    console.error(`ERROR: ${pkg} not found in node_modules and no pre-built bundle at ${outPath}`);
    console.error(`  Run: npm install ${pkg}`);
    process.exit(1);
  }

  // Read version from package.json
  const pkgJson = JSON.parse(readFileSync(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf-8'));

  const files = walkDir(distDir);
  const bundle = {};

  for (const absPath of files) {
    const relPath = relative(join(ROOT, 'node_modules', pkg), absPath);
    const raw = readFileSync(absPath, 'utf-8');
    bundle[relPath] = esmToCJS(raw);
  }

  const jsonStr = JSON.stringify(bundle);
  const hash = createHash('sha256').update(jsonStr).digest('hex').slice(0, 16);

  // Check if bundle actually changed
  const prev = manifest[pkg];
  if (prev && prev.hash === hash) {
    console.log(`unchanged ${pkg}: ${files.length} files, hash ${hash} (v${pkgJson.version})`);
    continue;
  }

  writeFileSync(outPath, jsonStr);
  manifest[pkg] = {
    version: pkgJson.version,
    files: files.length,
    hash,
    bundledAt: new Date().toISOString(),
    bundleFile: outName,
  };
  changed = true;
  console.log(`bundled ${pkg}: ${files.length} files → ${outName} (${(Buffer.byteLength(jsonStr) / 1024).toFixed(0)} KB, hash ${hash}, v${pkgJson.version})`);
}

// Always write manifest (even if unchanged, to keep it in sync)
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

if (changed) {
  console.log('manifest updated — bundles changed, VFS will reload on next init');
} else {
  console.log('no bundle changes detected');
}
console.log('done');
