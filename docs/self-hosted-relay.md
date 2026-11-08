# Self-hosted phone relay

The phone app talks to the Mac through a relay. The phone and this Mac encrypt the session. The relay forwards ciphertext. Agents, repos, and secrets stay on the Mac.

Sideboard hosts a relay at `wss://relay.sideboard.build/remote`. This page is how to run your own and point the desktop and the phone at it.

The process you deploy is the relay only. It accepts the phone and desktop WebSocket, GitHub sign-in, and the account database. It does not serve the Sideboard website. The website stays on [www.sideboard.build](https://www.sideboard.build/), which is a separate setting on Sideboard’s own Fly app ([deploy.md](system/deploy.md)).

**Settings → Remote** changes the phone only. Slack sign-in and Listen stay on Sideboard’s relay (`wss://relay.sideboard.build/slack/desktop`). Leave Slack env vars unset on this process. Running Slack on a relay you operate is a separate Slack app (client id, client secret, signing secret, and an app-level token for Listen). It is not these steps, and it is not a pasted bot token. Teams are added in the desktop with **Add via browser**.

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

Use your relay’s public origin in both places. Copy the client id and generate a client secret. They stay in the relay’s environment. Do not put them in the desktop app or the phone. The authorize request asks for `user:email`.

Cursor sign-in uses an Origin app id in `SIDEBOARD_RELAY_CURSOR_APP_ID`. Register the same callback on that app. There is no client secret.

Entire sign-in uses a public OIDC client. `SIDEBOARD_RELAY_ENTIRE_CLIENT_ID` is the HTTPS URL of a Client ID Metadata Document you host. Entire fetches that URL during sign-in and does not follow redirects. The document’s `client_id` is that same URL, `redirect_uris` contains this relay’s `https://…/remote/oauth/callback`, `response_types` is `code`, and `token_endpoint_auth_method` is `none`. Sideboard’s relay uses `https://www.sideboard.cloud/oauth/entire-client.json`. Leave `SIDEBOARD_RELAY_ENTIRE_CLIENT_SECRET` unset. The relay sends PKCE to `https://auth.entire.io/authorize` and exchanges the code at the regional issuer Entire returns. Each project still uses its own `origin` remote.

## Run

You need Docker Compose, a DNS name such as `relay.example.com` that points at this machine, and ports 80 and 443 open for the TLS proxy. Leave port 8080 reachable from that proxy only.

From a checkout of this repo, at the repo root (`git clone https://github.com/mattlevine/sideboard.git`):

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

`apps/relay/Dockerfile.relay` is the image. It does not copy `site/`. Compose publishes port 8080 on this host and stores accounts on a volume at `/data/relay-accounts.sqlite`. The image still installs the full Sideboard core package and runs as root. A slimmer image is not required to run the relay.

Confirm the process before TLS:

```bash
curl -fsS http://127.0.0.1:8080/health
```

`SIDEBOARD_RELAY_PUBLIC_ORIGIN` is the public `https://` origin with no path. Put TLS in front of port 8080 so that origin is real. A Caddy snippet:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Caddy forwards the WebSocket upgrade and appends the client address to `X-Forwarded-For`. Compose sets `SIDEBOARD_RELAY_TRUST_PROXY=1`, so this process uses that last hop as the client address. A client-sent `Fly-Client-IP` is ignored.

The desktop sends a JSON ping every 20 seconds. Keep the proxy idle timeout above that. Caddy’s `reverse_proxy` does. A shorter timeout drops a quiet Mac. One Nginx example is `proxy_read_timeout 3600s` together with the `Upgrade` and `Connection` headers.

Run one process. A second copy will not see the sockets or the sign-in that is in progress on the first. Do not round-robin a load balancer across replicas.

Leave `SIDEBOARD_SITE_ROOT` unset. Setting it is how Sideboard’s own app serves the marketing site, and this image does not contain those files.

## Point Sideboard at it

On each Mac, open **Settings → Remote → Relay**. Paste:

```
wss://relay.example.com/remote
```

Save. Sideboard signs this Mac out of whichever relay it was using. **Sign in with GitHub, Cursor, or Entire** (the OAuth client on this relay, not a git token), name the Mac, then **Show pairing code**.

On the phone, open **Pair a Mac** and set **Relay** to that same `wss://` address, then scan the QR code. The phone remembers the address. Paste the line under the code if you can’t scan.

`https://relay.example.com` and `https://relay.example.com/remote` are accepted and stored as the `wss://` URL.

Leave the Mac field blank, and the phone on the prefilled Sideboard address, to use Sideboard’s relay again. Sign in again after switching. A credential from one relay does not work on another.

When the Settings field is empty, `SIDEBOARD_REMOTE_RELAY_URL` still selects the phone relay (the default is `wss://relay.sideboard.build/remote`). A URL saved in Settings wins. Slack does not follow this field.

## What this relay stores

The account file holds the git-host subject, a verified email when the provider sent one, the Mac’s name, and hashes of the Mac credential, the host secret, and the phone session token. The host secret authenticates the Mac to the relay. The phone encryption key stays on the Mac. During sign-in the process sees the provider token in memory and does not write that token down. Prompts, repos, and project secrets are not stored.

A restart drops live sockets, pairing codes, and a sign-in that has not finished. The Mac and phone reconnect. Pairings resume from the account file. Finish sign-in again if the browser step was still open. That step lives in memory for 10 minutes.

Each account can register 3 Macs. A slot stays after you reinstall Sideboard or replace that Mac. There is no forget control yet. The fourth Mac gets `This account already has the maximum number of Macs.` Replacing the account file is the reset.

## Backup and upgrade

Stop the relay, then archive the Docker volume whose name ends in `relay-accounts` (`docker volume ls`). With this Compose file the project name is `relay`, so the volume is `relay_relay-accounts`. It holds `relay-accounts.sqlite` and the `-wal` and `-shm` files beside it. Copying the main file while the process is running can drop the latest writes.

```bash
docker compose -f apps/relay/docker-compose.yml stop relay
docker run --rm -v relay_relay-accounts:/data -v "$PWD":/backup alpine tar czf /backup/relay-accounts.tgz -C /data .
docker compose -f apps/relay/docker-compose.yml start relay
```

To upgrade, back up that volume, update the checkout (`git pull`), then run the same `docker compose … up --build -d`. The named volume stays. The process applies table updates on boot. There is no down migration.

## Check

`https://relay.example.com/health` and `/` are the same JSON. A healthy phone relay looks like:

```json
{
  "ok": true,
  "service": "sideboard-relay",
  "phoneSockets": 0,
  "accounts": true,
  "providers": { "github": true, "cursor": false, "entire": false }
}
```

`phoneSockets` is open `/remote` connections. `accounts` is true when the account file opened. `providers` names the sign-in clients configured on this process. `sessions` and `oauth` describe Slack Listen, not the phone.

Logs:

```bash
docker compose -f apps/relay/docker-compose.yml logs -f relay
```

| What you see | What to do |
|---|---|
| Process exits: `SIDEBOARD_RELAY_PUBLIC_ORIGIN is required` | Set the public `https://` origin and start again. |
| Process exits: accounts are on the machine root filesystem | Keep the Compose volume at `/data`. |
| `sign in required` | Sign in on this relay. A credential from another relay does not work. |
| `host secret rejected` | This Mac’s device id is already registered with a different secret. |
| `This account already has the maximum number of Macs.` | This account already has 3 Macs. There is no forget control yet. |
| `This Mac is registered to another account.` | That device id belongs to a different sign-in. |
| `remote rate limit` and the socket closes with `too many connections` | 20 phone sockets are open for that client address, or 4000 on the process. |
| The phone drops while idle | Raise the proxy idle timeout above 20 seconds. |
| The Mac reports a corporate CA error | Install your private CA where Node on the Mac, and the phone, will trust it. |
