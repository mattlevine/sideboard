/** Live status of the phone remote (hosted relay). */
export interface RemoteHostStatus {
  running: boolean;
  connected: boolean;
  deviceLabel: string | null;
  phoneConnected: boolean;
  pairingCode: string | null;
  lastError: string | null;
  lastLog: string | null;
}

/** Live status of Sideboard Slack Listen (hosted relay). */
export interface SlackListenStatus {
  enabled: boolean;
  running: boolean;
  hasAppToken: boolean;
  /** Built-in Sideboard Slack app Client ID/Secret are present (not sent to renderer). */
  bakedOAuth: boolean;
  /** How inbound events arrive when listening. */
  mode: 'relay' | null;
  workspaceCount: number;
  /** This Mac’s Slack destination label (Personal / Work). */
  deviceLabel: string | null;
  lastError: string | null;
  lastLog: string | null;
}
