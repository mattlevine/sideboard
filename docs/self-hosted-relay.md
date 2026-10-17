# Self-hosted phone relay

The phone app talks to the Mac through a relay. Message text is the only thing that crosses it. Agents, repos, and secrets stay on the Mac.

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

## Run

From a checkout of this repo, with those three variables set to your host and OAuth App:

```bash
export SIDEBOARD_RELAY_PUBLIC_ORIGIN=https://relay.example.com
export SIDEBOARD_RELAY_GITHUB_CLIENT_ID=your-client-id
export SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET=your-client-secret
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

Save. Sideboard signs this Mac out of whichever relay it was using. **Sign in with GitHub** (your OAuth App, not a git token), name the Mac, then **Show pairing code**.

On the phone, open **Pair a Mac** and set **Relay** to that same `wss://` address, then enter the code. The phone remembers the address.

`https://relay.example.com` and `https://relay.example.com/remote` are accepted and stored as the `wss://` URL.

Leave the Mac field blank, and the phone on the prefilled Sideboard address, to use Sideboard’s relay again. Sign in again after switching. A credential from one relay does not work on another.

When the Settings field is empty, `SIDEBOARD_REMOTE_RELAY_URL` still selects the relay (the default is `wss://relay.sideboard.cloud/remote`). A URL saved in Settings wins.

## What this relay stores

The GitHub identity used to sign the Mac in, the Mac’s name, and the phone’s pairing token. Not prompts, repos, or secrets.
