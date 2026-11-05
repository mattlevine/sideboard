/**
 * Whether the desktop host or `sideboard serve` should run `caffeinate -dimsu`.
 * A connected phone always holds it, so the lid can close on AC power without
 * a cloud sandbox. The phone-remote setting also holds it while the remote is
 * armed and no phone has joined. Chat holds are a separate detached process.
 */
export function hostKeepsMacAwake(input: {
  phoneConnected: boolean;
  /** Remote host or Slack listen is up, even if no phone has joined. */
  phoneRemoteArmed: boolean;
  caffeinateWhilePhoneRemote: boolean;
  agentsRunning: number;
  caffeinateWhileRunning: boolean;
  schedulesEnabled: boolean;
  caffeinateWhileSchedules: boolean;
}): boolean {
  if (input.phoneConnected) return true;
  if (input.caffeinateWhilePhoneRemote && input.phoneRemoteArmed) return true;
  if (input.caffeinateWhileRunning && input.agentsRunning > 0) return true;
  if (input.caffeinateWhileSchedules && input.schedulesEnabled) return true;
  return false;
}
