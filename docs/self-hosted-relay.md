# Self-hosted phone relay

The phone app talks to the Mac through a relay. The phone and this Mac encrypt the session. The relay forwards ciphertext. Agents, repos, and secrets stay on the Mac.

Sideboard hosts a relay at `wss://relay.sideboard.cloud/remote`. This page is how to run your own and point the desktop and the phone at it.

The process you deploy is the relay only. It accepts the phone and desktop WebSocket, GitHub sign-in, and the account database. It does not serve the Sideboard website. The website stays on [www.sideboard.cloud](https://www.sideboard.cloud/), which is a separate setting on Sideboard’s own Fly app ([deploy.md](system/deploy.md)).

## What you need

- A host with a public HTTPS name. Phones connect with `wss://`.
- A GitHub OAuth App that you control. The relay holds the client secret.
- One machine. The account database and the live sockets belong to that process.
- A disk volume for the account file. On Linux in production the process refuses to keep accounts on the container’s root filesystem.

## GitHub OAuth App

In GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.

| Field | Value |
|-------|--------|
| Homepage URL | `https://relay.example.com` |
| Authorization callback URL | `https://relay.example.com/remote/oauth/callback` |

Use your relay’s public origin in both places. Copy the client id and generate a client secret. They stay in the relay’s environment. Do not put them in the desktop app or the phone.

Cursor sign-in uses an Origin app id in `SIDEBOARD_RELAY_CURSOR_APP_ID`. Register the same callback on that app. There is no client secret.

Entire sign-in uses a public OIDC client. `SIDEBOARD_RELAY_ENTIRE_CLIENT_ID` is the HTTPS URL of a Client ID Metadata Document you host. Entire fetches that URL during sign-in and does not follow redirects. The document’s `client_id` is that same URL, `redirect_uris` contains this relay’s `https://…/remote/oauth/callback`, `response_types` is `code`, and `token_endpoint_auth_method` is `none`. Sideboard’s relay uses `https://www.sideboard.cloud/oauth/entire-client.json`. Leave `SIDEBOARD_RELAY_ENTIRE_CLIENT_SECRET` unset. The relay sends PKCE to `https://auth.entire.io/authorize` and exchanges the code at the regional issuer Entire returns. Each project still uses its own `origin` remote.

## Run

From a checkout of this repo, with the public origin and OAuth app set:

```bash
export SIDEBOARD_RELAY_PUBLIC_ORIGIN=https://relay.example.com
export SIDEBOARD_RELAY_GITHUB_CLIENT_ID=your-client-id
export SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET=your-client-secret
export SIDEBOARD_RELAY_CURSOR_APP_ID=app_your-origin-app-id
export SIDEBOARD_RELAY_ENTIRE_CLIENT_ID=https://example.com/oauth/entire-client.json
docker compose -f apps/relay/docker-compose.yml up --build -d
```

`apps/relay/Dockerfile.relay` is the image. It does not copy `site/`. Compose publishes port 8080 and stores accounts on a volume at `/data/relay-accounts.sqlite`.

`SIDEBOARD_RELAY_PUBLIC_ORIGIN` is the public `https://` origin with no path. Put TLS in front of port 8080 so that origin is real. A Caddy snippet:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Check `https://relay.example.com/health`. The body is JSON with `"service": "sideboard-relay"`. `/` on this host is that same JSON, not a website.

Leave `SIDEBOARD_SITE_ROOT` unset. Setting it is how Sideboard’s own app serves the marketing site, and this image does not contain those files.

Keep a single copy running. A second machine will not see the sockets or the account file on the first.

## Point Sideboard at it

On each Mac, open **Settings → Remote → Relay**. Paste:

```
wss://relay.example.com/remote
```

Save. Sideboard signs this Mac out of whichever relay it was using. **Sign in with GitHub, Cursor, or Entire** (the OAuth client on this relay, not a git token), name the Mac, then **Show pairing code**.

On the phone, open **Pair a Mac** and set **Relay** to that same `wss://` address, then scan the QR code. The phone remembers the address. Paste the line under the code if you can’t scan.

`https://relay.example.com` and `https://relay.example.com/remote` are accepted and stored as the `wss://` URL.

Leave the Mac field blank, and the phone on the prefilled Sideboard address, to use Sideboard’s relay again. Sign in again after switching. A credential from one relay does not work on another.

When the Settings field is empty, `SIDEBOARD_REMOTE_RELAY_URL` still selects the relay (the default is `wss://relay.sideboard.cloud/remote`). A URL saved in Settings wins.

## What this relay stores

The GitHub identity used to sign the Mac in, the Mac’s name, and the phone’s pairing token. Not prompts, repos, or secrets.
