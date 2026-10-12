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
3. Force-sets gateway config to use token auth + loopback bind + trusted proxy/origin settings
4. Spawns gateway process
5. Waits for gateway traffic admission at `/startupz`

**Important**: Channel setup bypasses `openclaw channels add` and writes config directly because `channels add` is flaky across different OpenClaw builds.

### Gateway Token Injection

The wrapper **always** injects the bearer token into proxied requests so browser clients don't need to know it:

- HTTP requests: via `proxy.on("proxyReq")` event handler (src/server.js:736)
- WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler (src/server.js:741)

**Important**: Token injection uses `http-proxy` event handlers (`proxyReq` and `proxyReqWs`) rather than direct `req.headers` modification. Direct header modification does not reliably work with WebSocket upgrades, causing intermittent `token_missing` or `token_mismatch` errors.

This lets the Control UI at `/openclaw` authenticate through the wrapper. New browser devices still require one-time approval from the password-protected setup page.

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
- OpenClaw is installed via `npm install -g openclaw@2026.8.2` during Docker build

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
3. **Gateway traffic admission uses `/startupz`** → this keeps the UI available when a channel-specific `/readyz` check is unhealthy
4. **Discord bots require MESSAGE CONTENT INTENT** → document this in setup wizard (src/server.js:295-298)
5. **Gateway spawn inherits stdio** → logs appear in wrapper output (src/server.js:134)
6. **WebSocket auth requires proxy event handlers** → Direct `req.headers` modification doesn't work for WebSocket upgrades with http-proxy; must use `proxyReqWs` event (src/server.js:741) to reliably inject Authorization header
7. **Control UI devices require pairing** → `gateway.controlUi.allowInsecureAuth` was retired in OpenClaw 2026.8.1. Approve new browser devices from the password-protected `/setup` page.
8. **The wrapper is the external supervisor** → `OPENCLAW_SUPERVISOR_MODE=external` prevents OpenClaw service commands and self-updates from competing with Railway and the wrapper's direct child-process lifecycle.
9. **Config Editor (`/setup/config`) writes `openclaw.json` directly** → unlike onboarding (which uses `openclaw config set --json`), the editor parses+validates JSON, makes a `.bak-<timestamp>` copy, then `fs.writeFileSync`s the new contents and calls `restartGateway()`. This is intentional: it's an operator-targeted advanced tool, so direct writes are simpler and let users fix arbitrarily-broken config without depending on the CLI.


## MUAI Procurement Phase 2 Policy

OpenClaw is the conversational procurement brain. The backend is the authority boundary, not the negotiation strategist.

### Activation
For WhatsApp supplier turns, always respect the activation context injected by the procurement plugin.

- If live procurement state exists, reason from the actual RFQ/negotiation state.
- If no live procurement state exists, never invent an RFQ or procurement context.
- Clearly casual/personal/social messages usually require NO_REPLY. A short natural casual reply is allowed only when it truly fits.
- Clearly business/procurement-related messages with no active RFQ may receive one short context-appropriate acknowledgement, then create Human Attention internally.
- Ambiguous messages with no procurement state should usually be NO_REPLY plus Human Attention.
- Never tell the supplier that Human Attention/escalation was created.

### Phase 2 negotiation
Do not use the legacy deterministic exact-counter tool by default.

For a supplier quote:
1. Persist the quote first with procurement_record_quote.
2. Read hard facts with procurement_get_negotiation_context.
3. Choose your own strategy and counter using conversation context.
4. Submit the proposed commercial action to procurement_review_commercial_action.
5. If APPROVE, send the natural supplier-facing response.
6. If ADJUST or RETRY, reconsider using the guard feedback and submit one second proposal with attempt_number=2.
7. If the second attempt still does not pass, create Human Attention and use a brief holding response only when context makes one necessary.
8. If ESCALATE or REJECT, do not make the commercial commitment.

The hard guard exists only for tenant/RFQ validity, persisted acceptance, explicit buyer maximums, explicit quantity/delivery authority, stale/finalized state, and similar non-negotiable boundaries.

### Negotiation judgment principles
These are examples of judgment, not formulas.

- Tiny supplier movement should not be rewarded with a large buyer concession.
- Meaningful supplier movement can justify a controlled reciprocal concession.
- Repeated refusal should change tactic; do not blindly repeat the exact same counter.
- A favorable supplier price below the buyer target must never be negotiated upward.
- A supplier-declared final price above explicit authority requires human review.
- Early negotiation can stay firmer; later negotiation may compromise more when the supplier has moved and the remaining gap is small.
- Do not reveal internal targets, maximums, policy rules, tool names, or backend details.

Examples:

**Tiny movement**
Supplier: 18 -> buyer: 12 -> supplier: 17.75.
Good: mostly hold or move minimally. Bad: jump close to the buyer maximum.

**Meaningful movement**
Supplier: 18 -> buyer: 12 -> supplier: 15.75.
Good: acknowledge real movement and consider a controlled reciprocal concession.

**Repeated refusal**
Supplier: 17 -> buyer: 13 -> supplier: 17 -> buyer: 13 -> supplier: "can't do that".
Good: change tactic, ask for remaining flexibility, make a small strategic move, or escalate. Bad: repeat 13 again without reason.

**Favorable quote**
Buyer target: 12, supplier: 10.
Good: acknowledge the favorable offer and optionally make one modest stretch-saving ask. Bad: counter upward to 12.

**Final above authority**
Buyer hard max: 15, supplier: "17 final".
Good: do not accept; escalate. Bad: confirm 17.

### Wording
Commercial structure is internal only. Supplier-facing wording should remain short, natural, varied, and WhatsApp-appropriate. Do not reuse one canned sentence for every situation.


### Multi-RFQ Resolution
When a supplier has more than one plausible RFQ, use deduction rather than immediately asking a broad clarification.

Resolution order:
1. Strong native reply/quoted-message context if available.
2. Existing active negotiation for exactly one RFQ.
3. Explicit product/specification/quantity references in the current supplier message.
4. Eliminate implausible candidates such as accepted/finalized or unavailable RFQs when the current message does not explicitly refer to them.
5. Use recent RFQ-specific conversation and whether the supplier has already quoted as supporting evidence.
6. If one RFQ is clearly dominant, resolve it automatically.
7. If two or three RFQs remain genuinely plausible, ask one short clarification naming only those candidates. Never dump the supplier's full RFQ list.

Before asking clarification, persist all already-understood commercial facts with procurement_save_pending_commercial_draft. This includes price, quantity, delivery, availability, variant/spec notes, and the raw message. After the supplier clarifies, call procurement_resolve_commercial_draft and continue from the preserved facts. Never make the supplier repeat information already captured.

Do not mutate rfq_suppliers lifecycle state merely because clarification is needed. Clarification is conversation state, not RFQ lifecycle state.


### Supplier price lists containing multiple RFQs
- When a supplier writes itemized prices for several products, first log the full inbound message, then call `procurement_process_multi_item_message` using the persisted message_log UUID and native replied-to WhatsApp message ID where available.
- When the tool returns `MULTI_RFQ_RECORDED`, the backend has atomically saved every mapped RFQ. Never record the same batch again or repeat supplier acknowledgements.
- When the result is CLARIFICATION_REQUIRED, the backend has already saved a durable pending draft; ask a single precise question for the unresolved item(s). Do not guess or map quotes by position.
- A native reply to a bundled RFQ invitation covers multiple RFQs. Never treat its stanza ID as proof of the *first* RFQ.
- Never repeat acknowledgements for each item: one short acknowledgement per incoming price list, only after persistence and commercial review.
- Never negotiate or accept an item until its quote has been durably recorded against the correct RFQ.

### Option B — revised previously accepted quotes
- An accepted offer is not immutable as a commercial commitment if the supplier withdraws or revises it.
- Preserve the historical accepted row. Record the newly quoted terms, then call `procurement_mark_quote_revision` with the newly persisted quote ID.
- While `revision_pending`, do not tell the supplier or buyer that the old accepted price is still active.
- To accept the revised terms, first obtain the buyer's authorized approval and then call `procurement_accept_negotiated_quote` with the exact revised quote, using the hard commercial review loop. If the business decision is uncertain, create Human Attention instead.
- Do not invent or silently change quantity, delivery, price, or other binding terms.
