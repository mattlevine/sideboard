/**
 * Composer / plan / approve send must not start a second turn while usage
 * confirm is still in flight (second Enter overwrites the first resolve).
 */
export function createUsageSendGate(): {
  tryBegin(): boolean;
  end(): void;
  shareConfirm(run: () => Promise<boolean>): Promise<boolean>;
} {
  let sending = false;
  let confirm: Promise<boolean> | null = null;

  return {
    tryBegin() {
      if (sending) return false;
      sending = true;
      return true;
    },
    end() {
      sending = false;
    },
    shareConfirm(run) {
      if (confirm) return confirm;
      try {
        const pending = Promise.resolve(run()).finally(() => {
          if (confirm === pending) confirm = null;
        });
        confirm = pending;
        return pending;
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}
