#!/usr/bin/env node
/** Ensure published bin entrypoints have a node shebang + executable bit. */
const fs = require('fs');
const path = require('path');

const files = ['dist/mcp/run-stdio.js', 'dist/mcp/run-stdio.cjs'];
for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  if (!content.startsWith('#!')) {
    content = `#!/usr/bin/env node\n${content}`;
    fs.writeFileSync(file, content);
  }
  fs.chmodSync(file, 0o755);
}
