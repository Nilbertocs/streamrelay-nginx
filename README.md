# StreamRelay

Self-hosted live stream relay with automatic fallback, web panel, and multi-platform support. Built as a lightweight alternative to Oryx/SRS for the specific use case of replicating a single live stream to multiple platforms simultaneously.

## Features

- **Multi-platform relay** — push one stream to YouTube, Twitch, Facebook, Kick, TikTok, Instagram, or any custom RTMP endpoint
- **Automatic fallback** — plays a looping MP4 video or static image when the encoder disconnects
- **Real-time fallback swap** — change the active fallback file without interrupting the stream
- **Web panel** — manage everything through a browser, no SSH required after first deploy
- **Multi-user** — admin and viewer roles
- **HTTPS via Traefik** — automatic TLS certificate provisioning
- **Portainer-ready** — deploy as a Docker Swarm stack with a single YAML

## Architecture

```
OBS / Encoder
     │
     ▼ RTMP :1935/ingest/{key}
┌──────────────┐
│  nginx-rtmp  │ → on_publish  → Panel validates key → starts FFmpeg relay
│              │ → on_publish_done → Panel kills relay → starts FFmpeg fallback
└──────────────┘
     │ FFmpeg relay (copy)
     ▼ RTMP internal /live/stream
┌──────────────┐
│  nginx-rtmp  │ → push → YouTube
│   /live      │ → push → Twitch
│              │ → push → Facebook / Kick / TikTok / …
└──────────────┘
     ▲
     │ FFmpeg fallback (MP4 loop or static image)
     │ (kicks in automatically when OBS disconnects)

┌──────────────┐
│  Panel       │ Node.js + Express + SQLite
│  :3000       │ → manages FFmpeg processes
│              │ → generates rtmp-push.conf
│              │ → reloads nginx via Docker socket (SIGHUP)
└──────────────┘
     ▲
Traefik → HTTPS → Panel (web UI)
```

## Docker Images

Images are automatically built and published to GitHub Container Registry on every push to `main`:

| Image | Description |
|---|---|
| `ghcr.io/nilbertocs/streamrelay-nginx:latest` | nginx compiled with nginx-rtmp-module |
| `ghcr.io/nilbertocs/streamrelay-panel:latest` | Node.js panel + FFmpeg |

Both images are built for `linux/amd64` and `linux/arm64`.

## Quick Start (Portainer / Docker Swarm)

### 1. Prerequisites

- Docker Swarm initialized on the VPS
- Traefik running with `traefik_public` external network and `websecure` entrypoint with a Let's Encrypt resolver named `le`
- Portainer installed

### 2. Deploy the stack

In Portainer → **Stacks → Add Stack**, paste the contents of [`stack.yml`](stack.yml) and set the following environment variables:

| Variable | Description | Example |
|---|---|---|
| `SESSION_SECRET` | Random string for session signing | `openssl rand -hex 32` |
| `HOOK_SECRET` | Shared secret between nginx and panel | `openssl rand -hex 16` |
| `ADMIN_EMAIL` | Admin account email (created on first boot) | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | Admin account password | `StrongPassword123!` |
| `DOMAIN` | Panel domain (Traefik will provision HTTPS) | `stream.yourdomain.com` |

Click **Deploy the stack**. The panel will be available at `https://DOMAIN` within a minute.

### 3. Configure OBS (or any encoder)

In OBS → Settings → Stream:

| Field | Value |
|---|---|
| Service | Custom |
| Server | `rtmp://YOUR_VPS_IP:1935/ingest` |
| Stream Key | *(shown in the panel under Configurações)* |

> Port 1935 must be open in your VPS firewall.

## Local Development

```bash
cp .env.example .env
# Edit .env with your values

docker compose up --build
```

The panel will be available at `http://localhost:3000` (no Traefik needed for local dev).

## Supported Platforms

Pre-configured RTMP presets (the URL is auto-filled when you select a platform):

| Platform | RTMP URL |
|---|---|
| YouTube | `rtmp://a.rtmp.youtube.com/live2/` |
| Twitch | `rtmp://live.twitch.tv/app/` |
| Facebook | `rtmps://live-api-s.facebook.com:443/rtmp/` |
| Kick | `rtmp://fa723fc1b171.global-contribute.live-video.net/app/` |
| TikTok | `rtmps://live.tiktok.com/live/` |
| Instagram | `rtmps://live-upload.instagram.com:443/rtmp/` |
| Custom | *(any RTMP/RTMPS URL)* |

> **Note:** `rtmps://` (RTMP over TLS) requires nginx to be compiled with SSL support. Facebook and TikTok may need an alternative `rtmp://` ingest URL for compatibility.

## Fallback Media

The panel supports multiple fallback files. Supported formats:

- **MP4** — looped indefinitely with FFmpeg (`-stream_loop -1`)
- **JPEG / PNG** — displayed as a static full-screen image with silent audio (scaled to 1920×1080)

Only one file can be active at a time. You can switch the active file in real time — the panel will restart FFmpeg with the new file immediately.

## Panel Pages

| Page | Description |
|---|---|
| **Dashboard** | Live status (AO VIVO / FALLBACK / OFFLINE), platform list, RTMP ingest URL, event log |
| **Destinos** | Add, edit, enable/disable, and remove stream destinations |
| **Fallback** | Upload and manage fallback media, toggle auto-fallback, manual start/stop |
| **Configurações** | Ingest key, user management, change password |

## How Nginx Reload Works

The panel manages nginx configuration without a terminal:

1. When destinations change, the panel writes a new `rtmp-push.conf` to a shared Docker volume
2. The panel sends `SIGHUP` to the nginx container via the Docker socket (`/var/run/docker.sock`)
3. nginx gracefully reloads its config without dropping active streams

The nginx container is identified by the label `streamrelay.service=nginx`.

## Project Structure

```
streamrelay/
├── .github/workflows/docker.yml   # CI: builds and pushes images to GHCR
├── nginx/
│   ├── Dockerfile                 # Multi-stage Alpine build with nginx-rtmp-module
│   ├── nginx.conf                 # RTMP server config (template, HOOK_SECRET injected)
│   └── entrypoint.sh
├── panel/
│   ├── Dockerfile                 # Node 20 Alpine + FFmpeg
│   ├── package.json
│   └── src/
│       ├── index.js               # Express entry point
│       ├── db.js                  # SQLite schema + seeding
│       ├── auth.js                # Session auth middleware
│       ├── ffmpeg.js              # FFmpeg process manager
│       ├── docker-reload.js       # nginx SIGHUP via Docker socket
│       ├── routes/
│       │   ├── hooks.js           # nginx on_publish / on_publish_done
│       │   ├── streams.js         # Stream destination CRUD
│       │   ├── fallback.js        # Fallback file management
│       │   ├── status.js          # Real-time status API
│       │   ├── users.js           # User management
│       │   └── settings.js        # Ingest key, settings
│       └── public/                # Frontend (Bootstrap 5, no build step)
├── docker-compose.yml             # Local development (builds from source)
├── stack.yml                      # Portainer / Docker Swarm (uses GHCR images)
└── .env.example
```

## License

MIT
