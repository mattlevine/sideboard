/**
 * Stdio entry for Claude `--mcp-config` (and other hosts).
 * Prefer this over PATH `sideboard mcp` — Electron GUI PATH often omits the CLI.
 */
import { startMcpServer } from './server.js';

startMcpServer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
