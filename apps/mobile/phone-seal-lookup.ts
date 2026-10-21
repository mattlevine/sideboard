import type { SealLookup, SealMaterial } from '../../packages/core/src/remote/phone-e2ee';

export type SealRow = {
  deviceId: string;
  sessionToken: string;
  hostPublicKey?: string;
  phoneToken?: string;
};

/**
 * Keys for the Mac the phone is connecting to. A pairing-line pin is only for
 * an in-progress pair. Resume uses the saved desktop — the pending session
 * (or the paired hint) wins over the previously open Mac.
 */
export function lookupSealMaterial(
  pinned: SealMaterial | null,
  rows: SealRow[],
  activeId: string | null,
  pendingToken: string | null,
  hint?: SealLookup | null,
): SealMaterial | null {
  if (pinned?.hostPublicKey && pinned.phoneToken) return pinned;
  const token = hint?.sessionToken || pendingToken;
  const id = hint?.deviceId || activeId;
  const row =
    (token ? rows.find((item) => item.sessionToken === token) : undefined) ??
    (id ? rows.find((item) => item.deviceId === id) : undefined);
  if (!row?.hostPublicKey || !row.phoneToken) return null;
  return { hostPublicKey: row.hostPublicKey, phoneToken: row.phoneToken };
}
