import * as ExpoCrypto from 'expo-crypto';
import { PhoneChannel, setPhoneE2EERandom, type SealLookup, type SealMaterial } from '../../packages/core/src/remote/phone-e2ee';
import { lookupSealMaterial } from './phone-seal-lookup';
import { createRelayLink, type RelayLink } from './relay-link';

export { lookupSealMaterial };

setPhoneE2EERandom((length) => ExpoCrypto.getRandomBytes(length));

/**
 * Phone socket that encrypts prompts. Pairing, resume, and host list stay
 * in the clear so the relay can route; the Mac's key is pinned from the
 * pairing line.
 */
export function createSealedRelayLink(opts: Parameters<typeof createRelayLink>[0] & {
  material: (hint?: SealLookup) => SealMaterial | null;
  wanted?: () => SealLookup | null;
}): RelayLink {
  const channel = new PhoneChannel(opts.material, opts.wanted);
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
