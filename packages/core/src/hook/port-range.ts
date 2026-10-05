import { createServer } from 'node:net';

export const PORT_RANGE_SIZE = 10;
const RECLAIM_RETRY_DELAY_MS = 40;
const RECLAIM_TRIES = 8;

async function killReclaimable(
  ports: number[],
  worktreePath: string | undefined,
  signal: NodeJS.Signals,
): Promise<void> {
  const { killListenersOnPorts, killStaleWorktreeListeners } = await import('./conductor.js');
  if (worktreePath) killStaleWorktreeListeners(ports, worktreePath, signal);
  else killListenersOnPorts(ports);
}

export type PortReservation = {
  port: number;
  /** Stop holding the port so a child can bind it. Idempotent. */
  release: () => Promise<void>;
};

/**
 * Bind an ephemeral port and keep the socket open until `release()`.
 * Closing then rebinding races other worktrees / agents (TOCTOU) — especially
 * with Vite `strictPort: true`, which fails Start instead of falling back.
 */
export async function reservePort(): Promise<PortReservation> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let released = false;
    const release = (): Promise<void> =>
      new Promise((res) => {
        if (released) {
          res();
          return;
        }
        released = true;
        server.close(() => res());
      });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        void release().then(() => reject(new Error('Failed to allocate port')));
        return;
      }
      resolve({ port: addr.port, release });
    });
    server.on('error', reject);
  });
}

/** @deprecated Prefer reservePort — releasing immediately reopens the race. */
export async function allocatePort(): Promise<number> {
  const held = await reservePort();
  await held.release();
  return held.port;
}

export async function tryReservePort(port: number): Promise<PortReservation | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return new Promise((resolve) => {
    const server = createServer();
    let released = false;
    const release = (): Promise<void> =>
      new Promise((res) => {
        if (released) {
          res();
          return;
        }
        released = true;
        server.close(() => res());
      });
    server.once('error', () => {
      try {
        server.close();
      } catch {
        // never listened
      }
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({ port, release });
    });
  });
}

/** Reserve every port or none. */
export async function tryReservePorts(
  ports: number[],
): Promise<PortReservation[] | null> {
  const held: PortReservation[] = [];
  for (const port of ports) {
    const next = await tryReservePort(port);
    if (!next) {
      await Promise.all(held.map((h) => h.release()));
      return null;
    }
    held.push(next);
  }
  return held;
}

function normalizePreferredPorts(ports: number[] | undefined, size: number): number[] {
  if (!ports?.length) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of ports) {
    if (!Number.isInteger(p) || p <= 0 || p > 65535 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= size) break;
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portSet(ports: readonly number[] | undefined): Set<number> {
  const out = new Set<number>();
  for (const port of ports ?? []) {
    if (Number.isInteger(port) && port > 0 && port <= 65535) out.add(port);
  }
  return out;
}

/**
 * Ephemeral port that is not in `avoid` (another script's saved range).
 * Holds rejected ports until one sticks so the kernel does not hand the same
 * free-but-reserved port back.
 */
async function reservePortOutside(
  avoid: ReadonlySet<number>,
): Promise<PortReservation> {
  const skipped: PortReservation[] = [];
  try {
    for (let i = 0; i < 32; i++) {
      const held = await reservePort();
      if (!avoid.has(held.port)) {
        await Promise.all(skipped.map((h) => h.release()));
        return held;
      }
      skipped.push(held);
    }
  } catch (err) {
    await Promise.all(skipped.map((h) => h.release()));
    throw err;
  }
  await Promise.all(skipped.map((h) => h.release()));
  throw new Error(
    'Failed to allocate a port that is not reserved by another run script',
  );
}

async function fillPortRange(
  held: PortReservation[],
  size: number,
  avoid: ReadonlySet<number>,
): Promise<PortReservation[]> {
  if (held.length >= size) return held;
  const base = held[0]?.port;
  const taken = new Set<number>([...held.map((h) => h.port), ...avoid]);
  try {
    let offset = 0;
    while (held.length < size) {
      const candidate = base != null ? base + offset : null;
      offset += 1;
      if (candidate != null && (taken.has(candidate) || candidate > 65535)) {
        if (candidate > 65535) {
          const ephemeral = await reservePortOutside(avoid);
          held.push(ephemeral);
          taken.add(ephemeral.port);
        }
        continue;
      }
      const next =
        candidate != null ? await tryReservePort(candidate) : null;
      if (next && !avoid.has(next.port)) {
        held.push(next);
        taken.add(next.port);
      } else {
        if (next) await next.release();
        const ephemeral = await reservePortOutside(avoid);
        held.push(ephemeral);
        taken.add(ephemeral.port);
      }
    }
    return held;
  } catch (err) {
    await Promise.all(held.map((h) => h.release()));
    throw err;
  }
}

/** Reserve whatever is free. Unlike tryReservePorts, do not release on the first miss. */
async function tryReserveAvailablePorts(
  ports: number[],
): Promise<PortReservation[]> {
  const held: PortReservation[] = [];
  for (const port of ports) {
    const next = await tryReservePort(port);
    if (next) held.push(next);
  }
  return held;
}

/**
 * Reuse this worktree's last range. SIDEBOARD_PORT is preferred[0] — succeed
 * with a partial hold when a sibling already bound a later slot.
 */
async function reclaimPreferredPorts(
  ports: number[],
  worktreePath: string | undefined,
  avoid: ReadonlySet<number>,
): Promise<PortReservation[] | null> {
  const reclaimable = ports.filter((p) => !avoid.has(p));
  const primary = reclaimable[0];
  // Primary belongs to another script — allocate a fresh range instead of
  // killing that script's listener.
  if (primary == null || avoid.has(ports[0] ?? primary)) return null;

  const takePrimary = async (): Promise<PortReservation[] | null> => {
    const held = await tryReserveAvailablePorts(reclaimable);
    if (held.some((h) => h.port === primary)) return held;
    await Promise.all(held.map((h) => h.release()));
    return null;
  };

  let held = await takePrimary();
  if (held) return held;
  await killReclaimable(reclaimable, worktreePath, 'SIGTERM');
  for (let i = 0; i < RECLAIM_TRIES; i++) {
    await delay(RECLAIM_RETRY_DELAY_MS);
    held = await takePrimary();
    if (held) return held;
    if (i === 2 && worktreePath) {
      await killReclaimable(reclaimable, worktreePath, 'SIGKILL');
    }
  }
  return null;
}

export type ReservePortRangeOpts = {
  /** Reuse this worktree's last assignment when still free (or reclaimable). */
  preferred?: number[];
  /** When preferred ports are busy, kill leftovers whose cwd is this worktree. */
  worktreePath?: string;
  /**
   * Ports saved for other run scripts in this worktree. Never bind or kill
   * them — desktop and mobile (or any pair) stay up together.
   */
  avoid?: number[];
};

/**
 * Hold a block of ports (Conductor: CONDUCTOR_PORT … +9) until release.
 * Callers must `release()` immediately before spawning the child that binds them.
 * When `preferred` is set, reuse those ports — reclaim a leftover Dev instance
 * on them instead of allocating a new range. SIDEBOARD_PORT is preferred[0];
 * a sibling holding a later slot must not force a new block.
 */
export async function reservePortRange(
  size = PORT_RANGE_SIZE,
  opts?: ReservePortRangeOpts,
): Promise<PortReservation[]> {
  const avoid = portSet(opts?.avoid);
  const preferred = normalizePreferredPorts(opts?.preferred, size);
  const primary = preferred[0];
  if (preferred.length && (primary == null || !avoid.has(primary))) {
    const reused = await reclaimPreferredPorts(
      preferred,
      opts?.worktreePath,
      avoid,
    );
    if (reused) return fillPortRange(reused, size, avoid);
  }

  const held: PortReservation[] = [await reservePortOutside(avoid)];
  return fillPortRange(held, size, avoid);
}

/** Allocate a contiguous block, releasing holds immediately (legacy / tests). */
export async function allocatePortRange(
  size = PORT_RANGE_SIZE,
): Promise<number[]> {
  const held = await reservePortRange(size);
  const ports = held.map((h) => h.port);
  await Promise.all(held.map((h) => h.release()));
  return ports;
}
