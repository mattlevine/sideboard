/** Renderer entry. Keep this free of the MCP SDK and Node built-ins. */
export {
  agentTextToCallToolResult,
  embeddedMcpUiFromText,
  mcpUiContentSecurityPolicy,
  mcpUiFrameId,
  type McpUiView,
} from './meta.js';
export {
  guestBridgeEffects,
  legacyAck,
  legacyResponse,
  rpcError,
  rpcResult,
  toolInputNotification,
  toolResultNotification,
} from './bridge.js';
