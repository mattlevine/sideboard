import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { copyProductionDeps, resolvePkgJson, LOAD_FAILURE_RE } = require('./stage-node-deps.js');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const corePkgJson = join(repoRoot, 'packages/core/package.json');

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe('stage-node-deps', () => {
  it('resolves execa’s get-stream@9, not the hoisted CJS 5.2.0', () => {
    const execaPkg = resolvePkgJson('execa', corePkgJson);
    const getStreamPkg = resolvePkgJson('get-stream', execaPkg);
    const pkg = JSON.parse(readFileSync(getStreamPkg, 'utf8')) as { version: string; type?: string };
    expect(pkg.version).toMatch(/^9\./);
    expect(pkg.type).toBe('module');
    const hoisted = JSON.parse(
      readFileSync(join(repoRoot, 'node_modules/get-stream/package.json'), 'utf8'),
    ) as { version: string };
    expect(hoisted.version).toMatch(/^5\./);
    expect(pkg.version).not.toBe(hoisted.version);
  });

  it('nests a second major of the same package so ESM named exports still resolve', () => {
    const root = mkdtempSync(join(tmpdir(), 'stage-node-deps-'));
    try {
      const src = join(root, 'src');
      const destNm = join(root, 'dest', 'node_modules');
      mkdirSync(destNm, { recursive: true });

      writeJson(join(src, 'package.json'), {
        name: 'fake-root',
        private: true,
        dependencies: { alpha: '1.0.0', beta: '1.0.0' },
      });

      writeJson(join(src, 'node_modules/alpha/package.json'), {
        name: 'alpha',
        version: '1.0.0',
        type: 'module',
        exports: { default: './index.js' },
        dependencies: { 'get-stream': '9.0.1' },
      });
      writeFileSync(
        join(src, 'node_modules/alpha/index.js'),
        "import { getStreamAsArray } from 'get-stream';\nexport const marker = getStreamAsArray();\n",
      );
      writeJson(join(src, 'node_modules/alpha/node_modules/get-stream/package.json'), {
        name: 'get-stream',
        version: '9.0.1',
        type: 'module',
        exports: { default: './index.js' },
      });
      writeFileSync(
        join(src, 'node_modules/alpha/node_modules/get-stream/index.js'),
        "export function getStreamAsArray() { return 'nine'; }\n",
      );

      writeJson(join(src, 'node_modules/beta/package.json'), {
        name: 'beta',
        version: '1.0.0',
        dependencies: { 'get-stream': '5.2.0' },
      });
      writeJson(join(src, 'node_modules/get-stream/package.json'), {
        name: 'get-stream',
        version: '5.2.0',
        main: './index.js',
      });
      writeFileSync(
        join(src, 'node_modules/get-stream/index.js'),
        "module.exports = function getStream() { return 'five'; };\n",
      );

      copyProductionDeps({
        destNm,
        fromFile: join(src, 'package.json'),
        names: ['beta', 'alpha'],
      });

      const hoisted = JSON.parse(
        readFileSync(join(destNm, 'get-stream/package.json'), 'utf8'),
      ) as { version: string };
      const nested = JSON.parse(
        readFileSync(join(destNm, 'alpha/node_modules/get-stream/package.json'), 'utf8'),
      ) as { version: string; type?: string };
      expect(hoisted.version).toBe('5.2.0');
      expect(nested.version).toBe('9.0.1');
      expect(nested.type).toBe('module');
      expect(existsSync(join(destNm, 'beta/node_modules/get-stream'))).toBe(false);

      const href = pathToFileURL(join(destNm, 'alpha/index.js')).href;
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import(${JSON.stringify(href)}).then((m) => { if (m.marker !== 'nine') throw new Error(m.marker); console.log('import-ok'); })`,
        ],
        { encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_PATH: '' } },
      );
      const out = `${result.stdout || ''}${result.stderr || ''}`;
      expect(result.status).toBe(0);
      expect(out).toMatch(/import-ok/);
      expect(out).not.toMatch(LOAD_FAILURE_RE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
