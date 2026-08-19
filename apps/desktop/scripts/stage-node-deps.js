/**
 * Copy a production dependency tree onto a real filesystem `node_modules`
 * for extraResources (Sideboard MCP, Cursor runtime).
 *
 * pnpm keeps two versions of the same name (execa → get-stream@9 ESM,
 * extract-zip → get-stream@5 CJS). Flattening by package name makes
 * `import { getStreamAsArray } from 'get-stream'` throw
 * `SyntaxError: Named export 'getStreamAsArray' not found`.
 *
 * Resolve each dep with Node's algorithm from the parent package — never
 * prefer the repo-root hoist. On version conflict, nest under the parent.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const { createRequire } = require('module');
const path = require('path');
const { pathToFileURL } = require('url');

const LOAD_FAILURE_RE =
  /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module|SyntaxError|Named export|ERR_UNKNOWN_NAMED_EXPORT|ERR_REQUIRE_ESM/i;

function copyTree(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`stage-node-deps: missing ${from}`);
  }
  const real = fs.realpathSync(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(real, to, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (src) => {
      if (src === real) return true;
      const rel = path.relative(real, src);
      return !rel.split(path.sep).includes('node_modules');
    },
  });
}

function readPkg(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

function walkToPackageJson(entry, name) {
  let dir = path.dirname(entry);
  if (path.basename(entry) === 'package.json') {
    try {
      const pkg = JSON.parse(fs.readFileSync(entry, 'utf8'));
      if (pkg.name === name) return fs.realpathSync(entry);
    } catch {
      /* walk */
    }
    dir = path.dirname(entry);
  }
  for (let i = 0; i < 16; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === name) return fs.realpathSync(pkgPath);
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve `name`'s package.json as Node would from `fromFile` (the dependent). */
function resolvePkgJson(name, fromFile) {
  let dir = path.dirname(fromFile);
  for (let i = 0; i < 32; i++) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (pkg.name === name) return fs.realpathSync(candidate);
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const req = createRequire(fromFile);
  try {
    const found = walkToPackageJson(req.resolve(name), name);
    if (found) return found;
  } catch (err) {
    if (name.startsWith('@cursor/sdk-')) return null;
    throw err;
  }
  if (name.startsWith('@cursor/sdk-')) return null;
  throw new Error(`stage-node-deps: cannot find package.json for ${name} from ${fromFile}`);
}

function destForPackage(name, destNm) {
  return path.join(destNm, ...name.split('/'));
}

function copyPackageAndDeps(name, fromFile, destNm, nestNm, recursed, platformSdk) {
  const pkgJsonPath = resolvePkgJson(name, fromFile);
  if (!pkgJsonPath) return;
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const topLevelDest = destForPackage(name, destNm);
  const topPkg = readPkg(topLevelDest);

  let destPkgDir;
  if (!topPkg) {
    destPkgDir = topLevelDest;
    copyTree(pkgDir, destPkgDir);
  } else if (topPkg.version === pkg.version) {
    destPkgDir = topLevelDest;
  } else {
    destPkgDir = destForPackage(name, nestNm);
    const nestedPkg = readPkg(destPkgDir);
    if (!nestedPkg || nestedPkg.version !== pkg.version) {
      copyTree(pkgDir, destPkgDir);
    }
  }

  if (recursed.has(destPkgDir)) return;
  recursed.add(destPkgDir);

  const childNest = path.join(destPkgDir, 'node_modules');
  for (const dep of Object.keys(pkg.dependencies || {})) {
    copyPackageAndDeps(dep, pkgJsonPath, destNm, childNest, recursed, platformSdk);
  }
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    if (dep.startsWith('@cursor/sdk-') && dep !== platformSdk) continue;
    copyPackageAndDeps(dep, pkgJsonPath, destNm, childNest, recursed, platformSdk);
  }
}

/**
 * @param {{ destNm: string, fromFile: string, names: string[], platformSdk?: string }} opts
 * @returns {number} package directories placed
 */
function copyProductionDeps(opts) {
  const platformSdk =
    opts.platformSdk || `@cursor/sdk-${process.platform}-${process.arch}`;
  const recursed = new Set();
  for (const name of opts.names) {
    copyPackageAndDeps(name, opts.fromFile, opts.destNm, opts.destNm, recursed, platformSdk);
  }
  return recursed.size;
}

function assertIsolatedEsmImport(entry, label) {
  const href = pathToFileURL(entry).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import(${JSON.stringify(href)}).then(() => console.log('import-ok'))`,
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_PATH: '' },
    },
  );
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0 || !/import-ok/.test(out) || LOAD_FAILURE_RE.test(out)) {
    throw new Error(`Isolated ${label} failed to import:\n${out}`);
  }
}

module.exports = {
  LOAD_FAILURE_RE,
  assertIsolatedEsmImport,
  copyTree,
  copyProductionDeps,
  resolvePkgJson,
};
