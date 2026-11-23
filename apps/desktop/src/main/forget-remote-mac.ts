/**
 * Forget one relay Mac.
 * This Mac is stopped before the relay closes its socket. That close looks like
 * a blip: the host registers again after 1s, while sign-out is still waiting on
 * logout. Logout only drops the credential, so the new row would keep the slot.
 * A different Mac stays connected here; its slot is already free on the relay.
 */
export async function runForgetRemoteMac<T>(opts: {
  self: boolean;
  stopHost: () => void;
  startHost: () => void;
  forget: () => Promise<void>;
  signOut: () => Promise<T>;
  settings: () => T;
}): Promise<T> {
  if (opts.self) opts.stopHost();
  try {
    await opts.forget();
  } catch (err) {
    if (opts.self) opts.startHost();
    throw err;
  }
  if (opts.self) return opts.signOut();
  return opts.settings();
}
