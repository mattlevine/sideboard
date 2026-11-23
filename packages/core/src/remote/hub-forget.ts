import type { RemoteSocket } from './hub.js';

type LiveHost = { socket: RemoteSocket; phone: RemoteSocket | null };

/**
 * The account forgot this Mac. Drop its sockets and the remembered secret.
 * The relay row is already gone; this only clears the process.
 */
export function dropForgottenMac<Host extends LiveHost>(
  deviceId: string,
  hosts: Map<string, Host>,
  remembered: { delete(id: string): void },
  codes: Iterable<[string, { deviceId: string }]> & { delete(code: string): void },
  phonesByToken: Iterable<[string, { deviceId: string }]> & { delete(token: string): void },
  bySocket: { delete(socket: RemoteSocket): void },
  pushTokenBySocket: { delete(socket: RemoteSocket): void },
): void {
  const id = deviceId.trim();
  if (!id) return;
  remembered.delete(id);
  for (const [code, row] of codes) {
    if (row.deviceId === id) codes.delete(code);
  }
  for (const [token, session] of phonesByToken) {
    if (session.deviceId === id) phonesByToken.delete(token);
  }
  const host = hosts.get(id);
  if (!host) return;
  const phone = host.phone;
  hosts.delete(id);
  bySocket.delete(host.socket);
  if (phone) {
    bySocket.delete(phone);
    pushTokenBySocket.delete(phone);
    send(phone, { type: 'host_offline' });
    try {
      phone.close();
    } catch {
      // ignore
    }
  }
  send(host.socket, { type: 'error', message: 'This Mac was removed from the account.' });
  try {
    host.socket.close();
  } catch {
    // ignore
  }
}

function send(socket: RemoteSocket, msg: { type: 'host_offline' } | { type: 'error'; message: string }): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // closed
  }
}
