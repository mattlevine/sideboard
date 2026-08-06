import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // CJS avoids Node ESM/CJS interop crashes with native deps (better-sqlite3).
      format: 'cjs',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: ['better-sqlite3', 'node-pty'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      format: 'cjs',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        // Pure helpers only — avoid bundling Node deps (execa) from @sideboard/core.
        '@sideboard/message-parts': resolve(
          __dirname,
          '../../packages/core/src/agents/message-parts.ts',
        ),
        '@sideboard/worktree-labels': resolve(
          __dirname,
          '../../packages/core/src/git/worktree-labels.ts',
        ),
        '@sideboard/brightsy-targets': resolve(
          __dirname,
          '../../packages/core/src/agents/brightsy-targets.ts',
        ),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
