#!/usr/bin/env node
/**
 * Mark MCP bin entrypoints executable. Shebang is emitted by tsup (see tsup.mcp.config.ts) —
 * do not rewrite file contents here (electron-builder asar packing races on size vs hash).
 */
const fs = require('fs');
const path = require('path');

const files = ['dist/mcp/run-stdio.js', 'dist/mcp/run-stdio.cjs'];
for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  if (!fs.existsSync(file)) continue;
  fs.chmodSync(file, 0o755);
}
