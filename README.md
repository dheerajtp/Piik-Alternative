# Piik-lite

A minimal, self-hosted screen-share + chat app. The host shares their screen
(with system/tab audio and an optional microphone) from a desktop browser;
2-5 friends join through a single invite link and watch + text-chat in any
browser, desktop or phone. Screen video and audio travel **peer-to-peer** -
the server only handles signaling and chat.

- No accounts, no database, no chat history.
- Pure P2P (WebRTC). Three dependencies: `express`, `ws`, `qrcode`.
- Host must be on **desktop** (browsers can't capture a phone screen).
- Screen capture requires **HTTPS** (or `localhost`).

### Features

- Invite link with one-click **copy**, a scannable **QR code** (`/qr`), and the
  native **Share** sheet where supported.
- Optional **room password** (set it any time while hosting; new joiners need it).
- **Host pause/resume** — freezes the share for everyone (stops sending frames) with
  a "Paused by host" overlay; viewers joining mid-pause see it immediately.
- **Quality/bitrate selection** (Source / 1080p / 720p / 480p) applied live via
  `applyConstraints` + per-sender `maxBitrate`; viewers see a quality badge.
- **Emoji reactions** that float across everyone's screen (👍 ❤️ 😂 🎉 😮 👏).
- Viewers can **remember their name**, see a live **participant list** with
  per-person colors, **chat timestamps**, and an **unread** badge when scrolled up.
- **Chat niceties**: clickable links, big emoji-only messages, and **download chat
  transcript** (client-side; still no server-side history).
- Stage controls: **fullscreen** (`F`), **theater mode**, picture-in-picture, and a
  **volume slider up to 200%** (WebAudio boost).
- Auto / dark / light **themes** (persisted).
- **Host moderation**: remove (kick) or chat-mute any viewer from the participant
  list. A removed name cannot rejoin; a muted name stays muted across reconnects.
  Both match on the name (case-insensitive), so they are soft controls.
- **Join approval** (optional, off by default): tick "Require approval to join" and
  each new viewer waits until the host clicks Allow or Deny. Up to 10 requests can
  wait at once. Viewers who were already admitted rejoin automatically.
- **Auto-reconnect**: a viewer whose connection drops retries with backoff (1s up to
  30s) and rejoins without a refresh. It stops if they were removed, declined, the
  room closed, or the password is wrong.
- **Recording** (host, desktop Chrome/Firefox): saves the shared stream as `.webm`.
  Viewers see a "Host is recording" notice. The mic is only included if it was
  switched on before recording started.

## Run locally

```sh
npm install
npm start
# open http://localhost:8787
```

`localhost` counts as a secure context, so capture works without HTTPS. Click
**Start sharing**, pick a screen/window/tab (tick "share audio"), then copy the
invite link. Open it in another tab, window, or device to join.

## Where can I host it for free?

Pick by what the app needs: a **long-lived Node process**, **WebSocket** support and
**HTTPS**. Media is peer-to-peer, so bandwidth and CPU needs are tiny.

| Option | Works? | Notes |
| --- | --- | --- |
| Your own PC/laptop + a Cloudflare Tunnel | Yes | Free, no open ports, HTTPS included. Only up while the machine is on. Cloudflare labels quick tunnels as for testing/development, and the URL changes every run. WebSockets appear to work but are not explicitly documented, so test once. |
| Oracle Cloud Always Free VM (guide below) | Yes | Always on. Needs a card at signup (no virtual or prepaid cards); free shapes are sometimes out of capacity in a region. Idle instances can be reclaimed. |
| Render free web service | Risky | Spins down after 15 minutes with no HTTP request or incoming WebSocket message, and takes about a minute to wake. It can also restart at any time, which drops every room. |
| Railway, Fly.io | Not really free | Railway gives a small monthly credit after a one-time trial. Fly.io appears to offer only a short trial to new accounts. Terms change often, so check their pricing pages. |
| Static hosts (GitHub Pages, Netlify, Vercel static) | No | They cannot run `server.js` or hold WebSockets. |

### Quick start: your PC + a free Cloudflare tunnel

The host has to be at their desktop to share anyway, so the server only needs to be
up during a session. No account, card or open ports needed.

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Start the app: `npm start`.
3. In a second terminal: `cloudflared tunnel --url http://localhost:8787`.
4. It prints a `https://<random>.trycloudflare.com` address. **Open that address in
   your browser as the host, not `localhost`.** Invite links are built from the
   address you are on, so opening `localhost` would give friends a link that does
   not work.
5. Click **Start sharing** and send the invite link.

Caveats: the address changes every time you restart the tunnel; Cloudflare labels
quick tunnels as for testing; and WebSockets are not explicitly documented for them,
so try one session with a friend first. For a stable address, use a named tunnel
(needs a free Cloudflare account and a domain) or the Oracle VM below.

## Deploy to a free always-on VM

This walkthrough uses an **Oracle Cloud Always Free** VM (Ubuntu), a free
**DuckDNS** subdomain, and **Caddy** for automatic HTTPS. HTTPS is required
because browser screen capture (`getDisplayMedia`) refuses insecure origins.

The steps are distro-agnostic in spirit; only the firewall and package commands
differ. Commands assume the default `ubuntu` user and the directory
`/home/ubuntu/piik-lite`. **`piik-lite.service` hardcodes both** (`User=` and
`WorkingDirectory=`); if your username or path differs, edit the unit before
enabling it or the service will fail to start.

### 1. Create the VM and note its public IP

- In the Oracle Cloud console, create a **Compute instance**. The **Always Free**
  ARM (Ampere) or AMD shape both work - Node.js is architecture-independent -
  and 1 vCPU / 1 GB RAM is plenty for signaling.
- Save the **public IP** shown on the instance details page.

### 2. Open ports 80 and 443 in the cloud firewall

Browser HTTPS needs inbound TCP 80 (redirect + ACME challenge) and TCP 443.

- **VCN → Security Lists → (your subnet's list) → Add Ingress Rules**, one each
  for TCP `80` and `443`, source `0.0.0.0/0`.
- If you use Network Security Groups, add the same two rules there instead.

### 3. Open ports 80 and 443 in the VM's own firewall

Oracle images ship with a restrictive host firewall, so cloud rules alone are
not enough.

Ubuntu (iptables + `netfilter-persistent`):

```sh
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Oracle Linux (firewalld):

```sh
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

### 4. Install Node.js, git, and Caddy

```sh
sudo apt update && sudo apt install -y git curl

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Verify: `node -v` (18+) and `caddy version`.

### 5. Create the DuckDNS subdomain

- Sign in at [duckdns.org](https://www.duckdns.org), create a subdomain such as
  `your-name`, and set its IP to the VM's public IP.
- DuckDNS is free and gives you a real domain, which Let's Encrypt will issue a
  certificate for. Keep the IP current with a cron job:

  ```sh
  # every 5 minutes: your-name, your-token from the DuckDNS dashboard
  (crontab -l 2>/dev/null; echo "*/5 * * * * curl -fsS 'https://www.duckdns.org/update?domains=your-name&token=YOUR-TOKEN&ip=' >/dev/null 2>&1") | crontab -
  ```

- Confirm resolution before continuing (Caddy cannot get a cert until this
  resolves to the VM): `dig +short your-name.duckdns.org`.

### 6. Get the code onto the VM

From your local machine (replace user/IP), or `git clone` if the repo is hosted:

```sh
rsync -av --exclude node_modules --exclude .git \
  ./  ubuntu@<VM_PUBLIC_IP>:~/piik-lite/
```

Then on the VM:

```sh
cd ~/piik-lite
npm install --omit=dev
```

### 7. Run it as a service

The repo ships a ready-made `piik-lite.service`. Install it (edit the paths only
if your user or directory differ):

```sh
sudo cp ~/piik-lite/piik-lite.service /etc/systemd/system/piik-lite.service

# only if node is not at /usr/bin/node:
# node_path=$(command -v node)
# sudo sed -i "s#ExecStart=.*#ExecStart=${node_path} server.js#" /etc/systemd/system/piik-lite.service

sudo systemctl daemon-reload
sudo systemctl enable --now piik-lite
systemctl status piik-lite --no-pager
```

This keeps the server on port 8787, reachable only via Caddy, and restarts it
after reboots or crashes. The unit contents:

```ini
[Unit]
Description=Piik-lite screen share + chat
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/piik-lite
Environment=PORT=8787
ExecStart=/usr/bin/node server.js
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

### 8. Put Caddy in front

Copy the repo's `Caddyfile` to `/etc/caddy/Caddyfile`, replacing
`your-name.duckdns.org` with your DuckDNS name:

```sh
sudo nano /etc/caddy/Caddyfile   # or: sudo cp ~/piik-lite/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy listens on 80/443, obtains and renews the Let's Encrypt certificate
automatically, and proxies HTTP + WebSocket traffic to `127.0.0.1:8787`.

### 9. Verify

```sh
curl https://your-name.duckdns.org/healthz   # -> {"status":"ok"}
```

Open `https://your-name.duckdns.org` in a desktop browser, click **Start
sharing**, pick a screen (tick "share audio"), and send the invite link. Test a
phone viewer too.

### Updating

```sh
cd ~/piik-lite
# copy new files (rsync / git pull), then:
npm install --omit=dev
sudo systemctl restart piik-lite
```

### Notes

- **Signup and capacity.** Oracle asks for a card at signup (Always Free resources
  are not charged), and some regions have no free capacity at times. Retry later or
  try another availability domain.
- **Idle reclamation.** Oracle may reclaim idle Always-Free instances: per Oracle's docs, one whose CPU, network (and memory on A1 shapes) stay under a threshold (currently 20%) at the 95th percentile over 7 days. A mostly idle signaling server can meet that. Check Oracle's Always Free page for the current rule. Signaling
  is low-traffic when nobody is streaming, so if the site goes down, check the
  instance is still running and re-point DuckDNS if the IP changed.
- **TLS timing.** If Caddy cannot get a certificate, confirm ports 80/443 are
  open end-to-end and `your-name.duckdns.org` resolves to the VM's public IP.
- **No inbound UDP needed (today).** Media is P2P; only STUN (a public server) is used
  for discovery, so no extra ports beyond 80/443. If you add a TURN server later,
  you must also open UDP 3478 and its relay port range, in both firewalls.
- **`.env.example`.** Only `PORT` is read by the app. `PUBLIC_URL` is informational;
  invite links are built from the browser's own address.
- **Open to anyone with the URL.** There is no host login and no limit on creating
  rooms: anyone who finds your site can start sharing. Keep the address private,
  or put it behind Caddy basic auth / Cloudflare Access if that matters.

## Architecture

```
Host browser ──getDisplayMedia──► WebRTC (P2P, screen + audio) ──► each viewer
     │                                                               ▲
     └──────── JSON over WSS (signaling + chat) ──► Node server ──────┘
```

`server.js` keeps rooms in memory (`roomId -> { host, viewers, password, quality,
paused, recording, banned, muted, approval, pending, tokens }`). It relays SDP
offers/answers, ICE candidates, chat messages, reactions, quality, pause, recording
and microphone state, and handles kick/mute and join approval. It never sees media. Rooms are removed
when the host disconnects. A `GET /qr?text=` route renders a QR code SVG (no external
service); `GET /healthz` returns `{ "status": "ok" }`. Quality, pause, recording, kick, mute and approval are
**host-only** (enforced server-side); reactions are validated against an allowlist and
rate-limited.

## Known limitations

- **No TURN server.** Symmetric NAT / very restrictive networks may fail to
  connect. Adding a `coturn` relay is the next step if that happens.
- **Moderation is name-based.** A removed viewer can come back under a different
  name; use join approval or a room password for stronger control.
- **Recording** is `.webm` only and unavailable where `MediaRecorder` is missing
  (e.g. some Safari versions).
- **Desktop host only.** iOS/Android browsers cannot capture the screen.
- **No chat history.** Messages are relayed live and not stored.
- **Host must stay awake.** The app requests a Screen Wake Lock, but disabling
  OS sleep for long sessions is recommended.
