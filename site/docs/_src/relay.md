# Run your own relay

The phone app talks to the Mac through a relay. The phone and this Mac encrypt the session. The relay forwards ciphertext. Agents, repos, and secrets stay on the Mac.

Sideboard hosts a relay at `wss://relay.sideboard.cloud/remote`. You can run your own and point the desktop and the phone at it. That service is the relay only: the phone and desktop connection, GitHub sign-in, and the account database. It does not serve this website.

## What you need

- A host with a public HTTPS name. Phones connect with `wss://`.
- A GitHub OAuth App that you control. The relay holds the client secret.
- One machine. The account database and the live sockets belong to that process.
- A disk volume for the account file.

## GitHub OAuth App

In GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.

| Field | Value |
|-------|--------|
| Homepage URL | `https://relay.example.com` |
| Authorization callback URL | `https://relay.example.com/remote/oauth/callback` |

Use your relay’s public origin. Copy the client id and generate a client secret. Keep them on the relay. Do not put them in the desktop app or the phone.

## Run

From a checkout of the Sideboard repo:

```bash
export SIDEBOARD_RELAY_PUBLIC_ORIGIN=https://relay.example.com
export SIDEBOARD_RELAY_GITHUB_CLIENT_ID=your-client-id
export SIDEBOARD_RELAY_GITHUB_CLIENT_SECRET=your-client-secret
docker compose -f apps/relay/docker-compose.yml up --build -d
```

The image is `apps/relay/Dockerfile.relay`. It does not include the website. Compose publishes port 8080 and stores accounts on a volume at `/data`.

`SIDEBOARD_RELAY_PUBLIC_ORIGIN` is the public `https://` origin with no path. Put TLS in front of port 8080. With Caddy:

```
relay.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Open `https://relay.example.com/health`. You should see JSON with `"service": "sideboard-relay"`. `/` on this host is that same JSON.

Run one copy. A second machine will not see the sockets or the accounts on the first.

## Use it

On each Mac, open **Settings → Remote → Relay** and paste:

```
wss://relay.example.com/remote
```

Save. Sideboard signs this Mac out of the previous relay. **Sign in with GitHub**, name the Mac, then **Show pairing code**.

On the phone, open **Pair a Mac**, set **Relay** to that same address, and scan the QR code. The phone remembers it. Paste the line under the code if you can’t scan.

Leave the Mac field blank, and the phone on the prefilled Sideboard address, to use Sideboard’s relay again. Sign in again after you switch.

See [Phone](/docs/remote/) for pairing, and [Support](/support/) for product questions.
