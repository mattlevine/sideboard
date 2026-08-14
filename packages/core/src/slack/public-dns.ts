import { lookup as systemLookup, Resolver } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

const PUBLIC_DNS = ['1.1.1.1', '8.8.8.8'];

function finishLookup(
  options: { all?: boolean },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
  address: string,
  family: number,
): void {
  if (options.all) {
    callback(null, [{ address, family }]);
    return;
  }
  callback(null, address, family);
}

/**
 * macOS/getaddrinfo can cache NXDOMAIN after a hostname is created.
 * Chrome uses its own DNS (so the Slack callback loads) while Electron's
 * fetch/ws still fail. Query public resolvers first, then the system.
 *
 * `ws` / Node Happy Eyeballs call this with `{ all: true }` and expect
 * `LookupAddress[]`, not a single string.
 */
export const lookupPreferPublicDns: LookupFunction = (hostname, options, callback) => {
  if (options.family === 6) {
    systemLookup(hostname, options, (err, address, family) => {
      callback(err, address, family);
    });
    return;
  }
  const resolver = new Resolver();
  resolver.setServers(PUBLIC_DNS);
  resolver.resolve4(hostname, (err, addresses) => {
    if (!err && addresses[0]) {
      finishLookup(options, callback, addresses[0], 4);
      return;
    }
    systemLookup(hostname, options, (sysErr, address, family) => {
      callback(sysErr, address, family);
    });
  });
};

/** GET that resolves the host via {@link lookupPreferPublicDns} (Node fetch cannot). */
export function fetchPreferPublicDns(url: string): Promise<Response> {
  const u = new URL(url);
  const lib = u.protocol === 'http:' ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    const req = lib(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        servername: u.hostname,
        lookup: lookupPreferPublicDns,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
