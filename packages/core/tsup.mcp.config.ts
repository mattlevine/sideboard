import { defineConfig } from 'tsup';

/** MCP bin entry — shebang baked in at emit time (no post-write size change). */
export default defineConfig({
  entry: {
    'mcp/run-stdio': 'src/mcp/run-stdio.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: false,
  target: 'es2022',
  banner: {
    js: '#!/usr/bin/env node\n',
  },
});
