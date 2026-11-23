import type { RemoteAccountMac } from '../relay/account-login.js';
import type { PublicAppSettings } from '../store/app-settings.js';

/** Macs registered on the signed-in relay account. */
export interface RemoteAccountIpc {
  /** `thisMac` marks the computer running Sideboard. */
  listRemoteAccountMacs(): Promise<Array<RemoteAccountMac & { thisMac: boolean }>>;
  /** Forgetting this Mac also signs out. */
  forgetRemoteAccountMac(deviceId: string): Promise<PublicAppSettings>;
}
