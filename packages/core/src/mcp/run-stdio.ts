/**
 * Stdio entry for Claude `--mcp-config` (and other hosts).
 * Prefer this over PATH `sideboard mcp` — Electron GUI PATH often omits the CLI.
 */
import { dropNestedElectronEnvFromProcess } from '../hook/nested-electron-env.js';
import { startMcpServer } from './server.js';

// If this process is already Electron-as-Node, drop inherited crashpad/GPU keys
// so MCP-spawned children do not attach to the host Electron.
dropNestedElectronEnvFromProcess();

startMcpServer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
