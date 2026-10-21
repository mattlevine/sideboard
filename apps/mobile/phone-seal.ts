import * as ExpoCrypto from 'expo-crypto';
import { PhoneChannel, setPhoneE2EERandom, type SealMaterial } from '../../packages/core/src/remote/phone-e2ee';

export function lookupSealMaterial(
  pinned: SealMaterial | null,
  rows: Array<{ deviceId: string; sessionToken: string; hostPublicKey?: string; phoneToken?: string }>,
  activeId: string | null,
  pendingToken: string | null,
): SealMaterial | null {
  if (pinned?.hostPublicKey && pinned.phoneToken) return pinned;
  const row =
    (activeId ? rows.find((item) => item.deviceId === activeId) : undefined) ??
    rows.find((item) => item.sessionToken === pendingToken);
  if (!row?.hostPublicKey || !row.phoneToken) return null;
  return { hostPublicKey: row.hostPublicKey, phoneToken: row.phoneToken };
}
import { createRelayLink, type RelayLink } from './relay-link';

setPhoneE2EERandom((length) => ExpoCrypto.getRandomBytes(length));

/**
 * Phone socket that encrypts prompts. Pairing, resume, and host list stay
 * in the clear so the relay can route; the Mac's key is pinned from the
 * pairing line.
 */
export function createSealedRelayLink(opts: Parameters<typeof createRelayLink>[0] & {
  material: () => SealMaterial | null;
}): RelayLink {
  const channel = new PhoneChannel(opts.material);
  let inner: RelayLink | null = null;
  const sendRaw = (payload: object) => inner?.send(payload);
  const link = createRelayLink({
    ...opts,
    onMessage: (raw) => {
      const step = channel.onRelayMessage(raw);
      for (const payload of step.send) sendRaw(payload);
      if (step.forward) opts.onMessage(step.forward);
    },
    onClose: () => {
      channel.reset();
      opts.onClose();
    },
  });
  inner = link;
  return {
    ...link,
    send(payload) {
      const next = channel.wrap(payload);
      if (next) link.send(next);
    },
  };
}
