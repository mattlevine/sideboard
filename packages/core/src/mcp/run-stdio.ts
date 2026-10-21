/**
 * Stdio entry for Claude `--mcp-config` (and other hosts).
 * Prefer this over PATH `sideboard mcp` — Electron GUI PATH often omits the CLI.
 */
import { dropNestedElectronEnvFromProcess } from '../hook/nested-electron-env.js';
import { bootstrapSystemCa } from '../http/system-ca.js';
import { startMcpServer } from './server.js';

// If this process is already Electron-as-Node, drop inherited crashpad/GPU keys
// so MCP-spawned children do not attach to the host Electron.
dropNestedElectronEnvFromProcess();

// Agent Linear uses this Node process (not Electron `net.fetch`). Load
// Keychain / OS CAs before any api.linear.app request.
bootstrapSystemCa();

startMcpServer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
