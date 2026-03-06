# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Railway deployment wrapper for **OpenClaw** (an AI coding assistant platform). It provides:

- A web-based setup wizard at `/setup` (protected by `SETUP_PASSWORD`)
- Automatic reverse proxy from public URL → internal OpenClaw gateway
- Persistent state via Railway Volume at `/data`

The wrapper manages the OpenClaw lifecycle: onboarding → gateway startup → traffic proxying.

## Development Commands

```bash
# Local development (requires OpenClaw installed globally or OPENCLAW_ENTRY set)
npm run dev

# Production start
npm start

# Syntax check
npm run lint
```

## Docker Build & Local Testing

```bash
# Build the container
docker build -t openclaw-railway-template .

# Run locally with volume
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# Access setup wizard
open http://localhost:8080/setup  # password: test
```

## Architecture

### Request Flow

1. **User → Railway → Wrapper (Express on PORT)** → routes to:
   - `/setup/*` → setup wizard (auth: Basic with `SETUP_PASSWORD`)
   - All other routes → proxied to internal gateway

2. **Wrapper → Gateway** (localhost:18789 by default)
   - HTTP/WebSocket reverse proxy via `http-proxy`
   - Automatically injects `Authorization: Bearer <token>` header

### Lifecycle States

1. **Unconfigured**: No `openclaw.json` exists
   - All non-`/setup` routes redirect to `/setup`
   - User completes setup wizard → runs `openclaw onboard --non-interactive`

2. **Configured**: `openclaw.json` exists
   - Wrapper spawns `openclaw gateway run` as child process
   - Waits for gateway to respond on multiple health endpoints
   - Proxies all traffic with injected bearer token

### Key Files

- **src/server.js** (main entry): Express wrapper, proxy setup, gateway lifecycle management, configuration persistence (server logic only - no inline HTML/CSS)
- **src/public/** (static assets for setup wizard):
  - **setup.html**: Setup wizard HTML structure
  - **styles.css**: Setup wizard styling (extracted from inline styles)
  - **setup-app.js**: Client-side JS for `/setup` wizard (vanilla JS, no build step)
- **Dockerfile**: Single-stage build (installs OpenClaw via npm, installs wrapper deps)

### Environment Variables

**Required:**
- `SETUP_PASSWORD` — protects `/setup` wizard

**Recommended (Railway template defaults):**
- `OPENCLAW_STATE_DIR=/data/.openclaw` — config + credentials
- `OPENCLAW_WORKSPACE_DIR=/data/workspace` — agent workspace

**Optional:**
- `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway (auto-generated if unset)
- `PORT` — wrapper HTTP port (default 8080)
- `INTERNAL_GATEWAY_PORT` — gateway internal port (default 18789)
- `OPENCLAW_ENTRY` — path to `entry.js` (default `/usr/local/lib/node_modules/openclaw/dist/entry.js`)

### Authentication Flow

The wrapper manages a **two-layer auth scheme**:

1. **Setup wizard auth**: Basic auth with `SETUP_PASSWORD` (src/server.js:190)
2. **Gateway auth**: Bearer token (auto-generated or from `OPENCLAW_GATEWAY_TOKEN` env)
   - Token is auto-injected into proxied requests (src/server.js:736, src/server.js:741)
   - Persisted to `${STATE_DIR}/gateway.token` if not provided via env (src/server.js:25-48)

### Onboarding Process

When the user runs setup (src/server.js:522-693):

1. Calls `openclaw onboard --non-interactive` with user-selected auth provider
2. Writes channel configs (Telegram/Discord/Slack) directly to `openclaw.json` via `openclaw config set --json`
3. Force-sets gateway config to use token auth + loopback bind + allowInsecureAuth
4. Spawns gateway process
5. Waits for gateway readiness (polls multiple endpoints)

**Important**: Channel setup bypasses `openclaw channels add` and writes config directly because `channels add` is flaky across different OpenClaw builds.

### Gateway Token Injection

The wrapper **always** injects the bearer token into proxied requests so browser clients don't need to know it:

- HTTP requests: via `proxy.on("proxyReq")` event handler (src/server.js:736)
- WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler (src/server.js:741)

**Important**: Token injection uses `http-proxy` event handlers (`proxyReq` and `proxyReqWs`) rather than direct `req.headers` modification. Direct header modification does not reliably work with WebSocket upgrades, causing intermittent `token_missing` or `token_mismatch` errors.

This allows the Control UI at `/openclaw` to work without user authentication.

## Common Development Tasks

### Testing the setup wizard

1. Delete `${STATE_DIR}/openclaw.json` (or run Reset in the UI)
2. Visit `/setup` and complete onboarding
3. Check logs for gateway startup and channel config writes

### Testing authentication

- Setup wizard: Clear browser auth, verify Basic auth challenge
- Gateway: Remove `Authorization` header injection (src/server.js:736) and verify requests fail

### Debugging gateway startup

Check logs for:
- `[gateway] starting with command: ...` (src/server.js:142)
- `[gateway] ready at <endpoint>` (src/server.js:100)
- `[gateway] failed to become ready after 20000ms` (src/server.js:109)

If gateway doesn't start:
- Verify `openclaw.json` exists and is valid JSON
- Check `STATE_DIR` and `WORKSPACE_DIR` are writable
- Ensure bearer token is set in config

### Modifying onboarding args

Edit `buildOnboardArgs()` (src/server.js:442-496) to add new CLI flags or auth providers.

### Adding new channel types

1. Add channel-specific fields to `/setup` HTML (src/public/setup.html)
2. Add config-writing logic in `/setup/api/run` handler (src/server.js)
3. Update client JS to collect the fields (src/public/setup-app.js)

## Railway Deployment Notes

- Template must mount a volume at `/data`
- Must set `SETUP_PASSWORD` in Railway Variables
- Public networking must be enabled (assigns `*.up.railway.app` domain)
- OpenClaw is installed via `npm install -g openclaw@latest` during Docker build

## Serena Semantic Coding

This project has been onboarded with **Serena** (semantic coding assistant via MCP). Comprehensive memory files are available covering:

- Project overview and architecture
- Tech stack and codebase structure
- Code style and conventions
- Development commands and task completion checklist
- Quirks and gotchas

**When working on tasks:**
1. Check `mcp__serena__check_onboarding_performed` first to see available memories
2. Read relevant memory files before diving into code (e.g., `mcp__serena__read_memory`)
3. Use Serena's semantic tools for efficient code exploration:
   - `get_symbols_overview` - Get high-level file structure without reading entire file
   - `find_symbol` - Find classes, functions, methods by name path
   - `find_referencing_symbols` - Understand dependencies and usage
4. Prefer symbolic editing (`replace_symbol_body`, `insert_after_symbol`) for precise modifications

This avoids repeatedly reading large files and provides instant context about the project.

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → persisted to volume if not in env
2. **Channels are written via `config set --json`, not `channels add`** → avoids CLI version incompatibilities
3. **Gateway readiness check polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some builds only expose certain routes (src/server.js:92)
4. **Discord bots require MESSAGE CONTENT INTENT** → document this in setup wizard (src/server.js:295-298)
5. **Gateway spawn inherits stdio** → logs appear in wrapper output (src/server.js:134)
6. **WebSocket auth requires proxy event handlers** → Direct `req.headers` modification doesn't work for WebSocket upgrades with http-proxy; must use `proxyReqWs` event (src/server.js:741) to reliably inject Authorization header
7. **Control UI requires allowInsecureAuth to bypass pairing** → Set `gateway.controlUi.allowInsecureAuth=true` during onboarding to prevent "disconnected (1008): pairing required" errors (GitHub issue #2284). Wrapper already handles bearer token auth, so device pairing is unnecessary.
8. **Control UI requires allowedOrigins for proxy access** → When accessed via Railway public URL, the browser origin differs from the gateway host. Wrapper sets `gateway.controlUi.allowedOrigins` from `RAILWAY_PUBLIC_URL` (during onboarding and before each gateway start). Local dev falls back to `http://localhost:PORT` and `http://127.0.0.1:PORT`.
