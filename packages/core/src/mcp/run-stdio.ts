/**
 * Stdio entry for Claude `--mcp-config` (and other hosts).
 * Prefer this over PATH `sideboard mcp` — Electron GUI PATH often omits the CLI.
 */
import { dropNestedElectronEnvFromProcess } from '../hook/nested-electron-env.js';
import {
  applySystemCaEnv,
  materializeSystemCaBundle,
  trustSystemCertificates,
} from '../http/system-ca.js';
import { startMcpServer } from './server.js';

// If this process is already Electron-as-Node, drop inherited crashpad/GPU keys
// so MCP-spawned children do not attach to the host Electron.
dropNestedElectronEnvFromProcess();

// Agent Linear uses this Node process (not Electron `net.fetch`). Load
// Keychain / OS CAs before any api.linear.app request.
const systemCaBundle = materializeSystemCaBundle();
if (systemCaBundle && !process.env.NODE_EXTRA_CA_CERTS?.trim()) {
  process.env.NODE_EXTRA_CA_CERTS = systemCaBundle;
}
applySystemCaEnv(process.env);
trustSystemCertificates();

startMcpServer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
