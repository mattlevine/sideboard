#!/usr/bin/env node
/**
 * Download official Node 22 LTS (darwin-arm64) into apps/desktop/build/node.
 * extraResources ships `Contents/Resources/node/bin/node` so packaged Cursor
 * and MCP do not use Homebrew Current / shared Cellar libuv.
 *
 * Official tarball only — not Homebrew. Desktop is Apple Silicon only.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

/** Keep in lockstep with @cursor/sdk engines (>=22.13) and better-sqlite3 ABI. */
const BUNDLED_NODE_VERSION = '22.23.2';
const BUNDLED_NODE_PLATFORM = 'darwin-arm64';

const desktopRoot = path.resolve(__dirname, '..');
const destRoot = path.join(desktopRoot, 'build', 'node');
const destBin = path.join(destRoot, 'bin', 'node');
const cacheDir = path.join(desktopRoot, 'build', 'node-cache');
const tarballName = `node-v${BUNDLED_NODE_VERSION}-${BUNDLED_NODE_PLATFORM}.tar.gz`;
const distBase = `https://nodejs.org/dist/v${BUNDLED_NODE_VERSION}`;

function bundledNodeDestBin() {
  return destBin;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function expectedTarballSha(sumsText) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+(\S+)$/.exec(line.trim());
    if (match && match[2] === tarballName) return match[1];
  }
  throw new Error(`SHASUMS256.txt has no entry for ${tarballName}`);
}

function alreadyStaged() {
  if (!fs.existsSync(destBin)) return false;
  const versionFile = path.join(destRoot, 'VERSION');
  if (!fs.existsSync(versionFile)) return false;
  if (fs.readFileSync(versionFile, 'utf8').trim() !== BUNDLED_NODE_VERSION) return false;
  const probed = spawnSync(destBin, ['-v'], { encoding: 'utf8' });
  return probed.status === 0 && probed.stdout.trim() === `v${BUNDLED_NODE_VERSION}`;
}

async function stageBundledNode() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      `stage-bundled-node: official Node is darwin-arm64 only (this is ${process.platform}/${process.arch})`,
    );
  }
  if (alreadyStaged()) {
    console.log(
      `Staged bundled Node v${BUNDLED_NODE_VERSION} (cached) at ${path.relative(desktopRoot, destBin)}`,
    );
    return destBin;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const sums = (await download(`${distBase}/SHASUMS256.txt`)).toString('utf8');
  const want = expectedTarballSha(sums);
  const cachedTar = path.join(cacheDir, tarballName);
  let tarBuf;
  if (fs.existsSync(cachedTar) && sha256(fs.readFileSync(cachedTar)) === want) {
    tarBuf = fs.readFileSync(cachedTar);
  } else {
    tarBuf = await download(`${distBase}/${tarballName}`);
    if (sha256(tarBuf) !== want) {
      throw new Error(`stage-bundled-node: SHA-256 mismatch for ${tarballName}`);
    }
    fs.writeFileSync(cachedTar, tarBuf);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sideboard-node-'));
  try {
    const tarPath = path.join(tmp, tarballName);
    fs.writeFileSync(tarPath, tarBuf);
    const extract = spawnSync(
      'tar',
      ['-xzf', tarPath, '-C', tmp, `node-v${BUNDLED_NODE_VERSION}-${BUNDLED_NODE_PLATFORM}/bin/node`],
      { encoding: 'utf8' },
    );
    if (extract.status !== 0) {
      throw new Error(`stage-bundled-node: tar extract failed:\n${extract.stderr || extract.stdout}`);
    }
    const extracted = path.join(
      tmp,
      `node-v${BUNDLED_NODE_VERSION}-${BUNDLED_NODE_PLATFORM}`,
      'bin',
      'node',
    );
    if (!fs.existsSync(extracted)) {
      throw new Error(`stage-bundled-node: extracted binary missing (${extracted})`);
    }
    fs.rmSync(destRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destBin), { recursive: true });
    fs.copyFileSync(extracted, destBin);
    fs.chmodSync(destBin, 0o755);
    fs.writeFileSync(path.join(destRoot, 'VERSION'), `${BUNDLED_NODE_VERSION}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const probed = spawnSync(destBin, ['-v'], { encoding: 'utf8' });
  if (probed.status !== 0 || probed.stdout.trim() !== `v${BUNDLED_NODE_VERSION}`) {
    throw new Error(
      `stage-bundled-node: staged binary is ${JSON.stringify(probed.stdout?.trim())} (want v${BUNDLED_NODE_VERSION})`,
    );
  }
  console.log(`Staged bundled Node v${BUNDLED_NODE_VERSION} at ${path.relative(desktopRoot, destBin)}`);
  return destBin;
}

module.exports = {
  BUNDLED_NODE_VERSION,
  bundledNodeDestBin,
  stageBundledNode,
};

if (require.main === module) {
  stageBundledNode().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
