import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveStaticPath } from './relay-static.js';
import { startSlackRelayServer } from './relay-server.js';

function request(
  port: number,
  pathName: string,
  host: string,
): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathName, headers: { host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('resolveStaticPath', () => {
  const root = '/app/site';

  it('maps / and directories onto the site tree', () => {
    expect(resolveStaticPath(root, '/')).toBe(path.resolve(root));
    expect(resolveStaticPath(root, '/docs')).toBe(path.resolve(root, 'docs'));
    expect(resolveStaticPath(root, '/docs/')).toBe(path.resolve(root, 'docs'));
    expect(resolveStaticPath(root, '/styles.css')).toBe(path.resolve(root, 'styles.css'));
  });

  it('never resolves a path outside the site root', () => {
    const resolvedRoot = path.resolve(root);
    for (const url of [
      '/../fly.toml',
      '/%2e%2e/fly.toml',
      '/docs/%2e%2e/%2e%2e/secret',
      '/foo/../../etc/passwd',
    ]) {
      const resolved = resolveStaticPath(root, url);
      expect(
        resolved === null ||
          resolved === resolvedRoot ||
          resolved.startsWith(resolvedRoot + path.sep),
      ).toBe(true);
    }
  });
});

describe('Slack relay static marketing site', () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  });

  it('serves index and docs from staticRoot and keeps /health as JSON', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sideboard-site-'));
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'index.html'), '<!DOCTYPE html><title>Home</title><h1>Sideboard</h1>');
    await writeFile(path.join(root, 'docs/index.html'), '<!DOCTYPE html><title>Docs</title><h1>Docs</h1>');
    await writeFile(path.join(root, 'styles.css'), 'body{color:#111}');

    const handle = await startSlackRelayServer({
      appToken: 'xapp-test',
      clientSecret: 'relay-secret',
      skipSocketMode: true,
      staticRoot: root,
    });
    handles.push(handle);
    const origin = `http://127.0.0.1:${handle.port}`;

    const home = await fetch(`${origin}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toMatch(/text\/html/);
    expect(await home.text()).toContain('Sideboard');

    const docs = await fetch(`${origin}/docs`);
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain('Docs');

    const css = await fetch(`${origin}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);

    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'sideboard-slack-relay' });

    const escape = await fetch(`${origin}/%2e%2e/package.json`);
    expect(escape.status).toBe(404);

    const missing = await fetch(`${origin}/nope.html`);
    expect(missing.status).toBe(404);
  });

  it('serves the site only on staticHosts and redirects the apex', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sideboard-site-'));
    await writeFile(path.join(root, 'index.html'), '<!DOCTYPE html><h1>Site</h1>');
    const handle = await startSlackRelayServer({
      appToken: 'xapp-test',
      skipSocketMode: true,
      staticRoot: root,
      staticHosts: ['www.sideboard.cloud'],
      redirectHosts: ['sideboard.cloud'],
      canonicalSiteHost: 'www.sideboard.cloud',
    });
    handles.push(handle);

    const www = await request(handle.port, '/', 'www.sideboard.cloud');
    expect(www.status).toBe(200);
    expect(www.body).toContain('Site');

    const relay = await request(handle.port, '/', 'relay.sideboard.cloud');
    expect(JSON.parse(relay.body)).toMatchObject({ ok: true, service: 'sideboard-slack-relay' });

    const apex = await request(handle.port, '/docs', 'sideboard.cloud');
    expect(apex.status).toBe(301);
    expect(apex.location).toBe('https://www.sideboard.cloud/docs');
  });

  it('keeps JSON on / when staticRoot is unset', async () => {
    const handle = await startSlackRelayServer({
      appToken: 'xapp-test',
      skipSocketMode: true,
    });
    handles.push(handle);
    const res = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(await res.json()).toMatchObject({ ok: true, service: 'sideboard-slack-relay' });
  });
});
