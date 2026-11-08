# Run your own relay

The phone app talks to the Mac through a relay. The phone and this Mac encrypt the session. The relay forwards ciphertext. Agents, repos, and secrets stay on the Mac.

Sideboard hosts a relay at `wss://relay.sideboard.build/remote`. You can run your own and point the desktop and the phone at it. That service is the relay only: the phone and desktop connection, GitHub sign-in, and the account database. It does not serve this website.

**Settings → Remote** changes the phone only. Slack sign-in and Listen stay on Sideboard’s relay. Running Slack on a relay you operate is a separate Slack app, not these steps, and not a pasted bot token. Add a team with **Add via browser**.

## What you need

- A host with a public HTTPS name. Phones connect with `wss://`.
- A GitHub OAuth App that you control. The relay holds the client secret. Cursor and Entire are optional.
- One machine. The account database, the live sockets, and an in-progress sign-in belong to that process.
- A disk volume for the account file. On Linux in production the process refuses to keep accounts on the container’s root filesystem.

## GitHub OAuth App

In GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.

| Field | Value |
|-------|--------|
| Homepage URL | `https://relay.example.com` |
| Authorization callback URL | `https://relay.example.com/remote/oauth/callback` |

Use your relay’s public origin. Copy the client id and generate a client secret. Keep them on the relay. Do not put them in the desktop app or the phone.

Cursor sign-in uses an Origin app id in `SIDEBOARD_RELAY_CURSOR_APP_ID`. Register the same callback on that app. There is no client secret.

Entire sign-in uses a public OIDC client. `SIDEBOARD_RELAY_ENTIRE_CLIENT_ID` is the HTTPS URL of a Client ID Metadata Document you host (Entire fetches it and does not follow redirects). The document’s `client_id` is that URL, and `redirect_uris` contains this relay’s callback. Sideboard’s own relay uses `https://www.sideboard.cloud/oauth/entire-client.json`. Leave the client secret unset. Each project still uses its own `origin` remote, so GitHub, Cursor, and Entire repos can sit on the same Mac.

## Run

You need Docker Compose, a DNS name such as `relay.example.com` that points at this machine, and ports 80 and 443 open for the TLS proxy. Leave port 8080 reachable from that proxy only.

From the repo root (`git clone https://github.com/mattlevine/sideboard.git`):

```bash
export SIDEBOARD_RELAY_PUBLIC_ORIGIN=https://relay.example.com
export SIDEBOARD_RELAY_GITHUB_CLIENT_ID=your-client-id
export SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET=your-client-secret
# optional:
# export SIDEBOARD_RELAY_CURSOR_APP_ID=app_your-origin-app-id
# export SIDEBOARD_RELAY_ENTIRE_CLIENT_ID=https://example.com/oauth/entire-client.json
docker compose -f apps/relay/docker-compose.yml up --build -d
```

Compose refuses to start when the public origin or the GitHub client id or secret is missing. In production the process also exits when `SIDEBOARD_RELAY_PUBLIC_ORIGIN` is unset.

The image is `apps/relay/Dockerfile.relay`. It does not include the website. Compose publishes port 8080 and stores accounts on a volume at `/data/relay-accounts.sqlite`.

Confirm the process before TLS with `curl -fsS http://127.0.0.1:8080/health`.

`SIDEBOARD_RELAY_PUBLIC_ORIGIN` is the public `https://` origin with no path. Put TLS in front of port 8080. With Caddy:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Caddy forwards the WebSocket upgrade. Compose sets `SIDEBOARD_RELAY_TRUST_PROXY=1`, so the relay uses the client address Caddy appends. A client-sent `Fly-Client-IP` is ignored. The desktop sends a JSON ping every 20 seconds. Keep the proxy idle timeout above that. Caddy’s `reverse_proxy` does.

Run one copy. A second machine will not see the sockets or the sign-in in progress on the first.

## Use it

On each Mac, open **Settings → Remote → Relay** and paste:

```
wss://relay.example.com/remote
```

Save. Sideboard signs this Mac out of the previous relay. **Sign in with GitHub, Cursor, or Entire**, name the Mac, then **Show pairing code**.

On the phone, open **Pair a Mac**, set **Relay** to that same address, and scan the QR code. The phone remembers it. Paste the line under the code if you can’t scan.

Leave the Mac field blank, and the phone on the prefilled Sideboard address, to use Sideboard’s relay again. Sign in again after you switch. Slack does not follow this address.

Each account can register 3 Macs. A slot stays after you reinstall or replace that Mac. There is no forget control yet.

## What it stores

The account file holds the git-host identity, the Mac’s name, and hashes of the Mac credential and the phone session token. Message text stays encrypted between the phone and the Mac. Prompts, repos, and secrets are not stored.

A restart drops live sockets and a sign-in that has not finished. Pairings resume from the account file.

Stop the relay, then archive the Docker volume whose name ends in `relay-accounts` (`docker volume ls`; with this file it is `relay_relay-accounts`). It holds `relay-accounts.sqlite` and the `-wal` and `-shm` files. Copying the database while the process is running can drop the latest writes.

```bash
docker compose -f apps/relay/docker-compose.yml stop relay
docker run --rm -v relay_relay-accounts:/data -v "$PWD":/backup alpine tar czf /backup/relay-accounts.tgz -C /data .
docker compose -f apps/relay/docker-compose.yml start relay
```

To upgrade, back up that volume, `git pull`, then run the same `docker compose` command. The volume stays.

## Check

Open `https://relay.example.com/health`. You should see JSON with `"service": "sideboard-relay"`, `"accounts": true`, and `"providers": { "github": true }`. `phoneSockets` counts open phone connections. `/` on this host is that same JSON.

Logs:

```bash
docker compose -f apps/relay/docker-compose.yml logs -f relay
```

`sign in required` means sign in on this relay again. `host secret rejected` means this Mac’s device id is already registered with a different secret. `This account already has the maximum number of Macs.` means the 3-Mac limit. `remote rate limit` means 20 phone sockets are already open for that client address. A phone that drops while idle needs a longer proxy timeout.

See [Phone](/docs/remote/) for pairing, and [Support](/support/) for product questions.
