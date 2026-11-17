# OpenClaw Railway Template

## Security Notice

> **This template exposes your OpenClaw gateway to the public internet.** **Please read the [OpenClaw security documentation](https://docs.openclaw.ai/gateway/security) before deploying** to understand the risks and recommended configuration. If you only use chat channels (Telegram, Discord, Slack) and don't need the gateway dashboard, you can remove the public endpoint from Railway after setup.

<img width="1860" height="2624" alt="CleanShot 2026-02-23 at 21 59 06@2x" src="https://github.com/user-attachments/assets/2605d44c-4319-4e92-838c-3caa726b9595" />

## What you get

- **OpenClaw Gateway + Control UI** (served at `/` and `/openclaw`)
- A friendly **Setup Wizard** at `/setup` (protected by a password)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` with `SETUP_PASSWORD`.
- During setup, the wrapper runs `openclaw onboard ...` inside the container, writes state to the volume, and then starts the gateway. API-key providers use non-interactive setup. Interactive device-code logins (ChatGPT/Codex, xAI/Grok) can't run from the web wizard — complete those by running `openclaw wizard` in the Railway console.
- After setup, **`/` is OpenClaw**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Getting chat tokens (so you don't have to scramble)

### ChatGPT / OpenAI Codex and Grok / xAI subscription login

These providers use an interactive device-code login that the web `/setup` wizard can't drive. Complete them from the Railway console instead:

1. Open your service in Railway and launch the **console** (a shell inside the running container).
2. Run `openclaw wizard` and follow the prompts. Choose the ChatGPT/Codex or xAI/Grok device login, open the URL it prints in your browser, and enter the short code.
3. Once the wizard finishes saving the OAuth profile, return to `/setup` — the instance will be configured and the gateway will start.

This lets you use a ChatGPT/Codex account or an eligible SuperGrok / X Premium subscription without pasting an API key.

### Telegram bot token

1. Open Telegram and message **@BotFather**
2. Run `/newbot` and follow the prompts
3. BotFather will give you a token that looks like: `123456789:AA...`
4. Paste that token into `/setup`

### Discord bot token

1. Go to the Discord Developer Portal: https://discord.com/developers/applications
2. **New Application** → pick a name
3. Open the **Bot** tab → **Add Bot**
4. Copy the **Bot Token** and paste it into `/setup`
5. Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`; then choose permissions)

### Slack app tokens

1. Create an app at https://api.slack.com/apps → **From scratch**
2. **Socket Mode** → enable it and generate an **App-Level Token** with the `connections:write` scope (`xapp-...`)
3. **OAuth & Permissions** → add bot scopes: `app_mentions:read`, `chat:write`, `channels:history`, `groups:history`, `im:history`, `im:read`, `im:write`, `users:read`
4. **Event Subscriptions** → enable and subscribe to bot events: `app_mention`, `message.channels`, `message.groups`, `message.im`
5. **App Home** → enable the **Messages Tab** so people can DM the bot
6. **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`)
7. Paste both tokens into `/setup`, then invite the bot to channels with `/invite @your-bot`

The first DM from a new user returns a pairing code — approve it in `/setup` → "Approve Pairing" → Slack.

### More integrations from Railway variables

Set these in Railway → Variables. The wrapper writes them into OpenClaw config on each gateway start, as env references, so the secrets never land in `openclaw.json`. `/setup/api/debug` → `integrations` shows what got picked up.

| Variables | Result |
| --- | --- |
| `SLACK_<NAME>_BOT_TOKEN` + `SLACK_<NAME>_APP_TOKEN` | Extra Slack workspace as account `<name>` (Socket Mode). Create the app the same way as above, in that workspace |
| `BRAIN_MCP_URL` + `BRAIN_API_KEY` | MCP server `brain` (`Authorization: Bearer`) |
| `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` | MCP server `supabase`, read-only |
| `BRAVE_API_KEY` (or another [web search provider](https://docs.openclaw.ai/tools/web) key) | `web_search` turns on |
| `PAGESPEED_API_KEY` | Available to the agent's shell as `$PAGESPEED_API_KEY` |
| `HEARTBEAT_MODEL` (e.g. `anthropic/claude-haiku-5-5`) | Heartbeat model for the defaults and every agent with its own heartbeat block, so background runs stop billing at the chat model's rate |
| `HEARTBEAT_EVERY` (e.g. `2h`) | Heartbeat interval for the same set of agents |
| `HEARTBEAT_DISABLED_AGENTS` (e.g. `main,vance`) | Turns those agents' heartbeats off (`every: 0m`) |

### Gmail (read + send)

The image ships with [`gog`](https://gogcli.sh), which enables OpenClaw's bundled `gog` skill for Gmail (plus Calendar/Drive if you grant those scopes). Its tokens live on the volume at `/data/.gogcli`.

> The agent gets real access to the mailbox, including sending. Anyone who can message the bot can ask it to read or send mail, and incoming emails can contain prompt-injection text. Use a dedicated mailbox if you can, and keep DM access on pairing.

**1. Create an OAuth client (one time)**

1. In Google Cloud Console, create or pick a project and enable the **Gmail API**
2. **Google Auth Platform** → configure the consent screen; while it's in *Testing*, add your Gmail address as a test user
3. **Clients** → **Create client** → type **Desktop app** → download the JSON

**2. Set a keyring password in Railway**

Add a Railway variable `GOG_KEYRING_PASSWORD` (e.g. `${{ secret() }}`) and redeploy. gog encrypts stored tokens with it, and the gateway needs it to read them.

**3. Connect from `/setup`**

Go to `/setup` → **Email** → **Connect Gmail**:

1. Upload (or paste) the client JSON from step 1
2. Enter the Google account email, pick extra services (Calendar/Drive) if wanted, and click **Authorize with Google**
3. Approve in the Google tab that opens. Google then redirects to a `localhost` page that fails to load — that's expected. Copy that full URL from the address bar, paste it back into `/setup`, and click **Finish**

The gateway restarts to pick up the new account. Then ask the bot something like "summarize my unread email from today" or "email bob@example.com saying I'm running late". Connected accounts are listed in the Email card, with a **Disconnect** button.

<details>
<summary>Prefer the Railway console?</summary>

```bash
gog auth credentials set - < client.json   # or paste the JSON, then Ctrl-D
gog auth add you@gmail.com --services gmail --remote --step 1
# open auth_url, approve, copy the localhost URL from the address bar
gog auth add you@gmail.com --services gmail --remote --step 2 --auth-url '<paste the localhost URL>'
gog auth list --check
gog gmail search 'newer_than:1d' --max 3
```

</details>

## Local testing

```bash
docker build -t openclaw-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# Setup wizard: http://localhost:8080/setup (password: test)
```

## FAQ

**Q: How do I access the setup page?**

A: Go to `/setup` on your deployed instance. When prompted for credentials, use the generated `SETUP_PASSWORD` from your Railway Variables as the password. The username field is ignored—you can leave it empty or enter anything.

**Q: I see "gateway disconnected" or authentication errors in the Control UI. What should I do?**

A: Go back to `/setup` and click the "Open OpenClaw UI" button from there. The setup page passes the required auth token to the UI. Accessing the UI directly without the token will cause connection errors.

**Q: How do I approve pairing for Telegram, Discord, or Slack?**

A: Go to `/setup` and use the "Approve Pairing" dialog to approve pending pairing requests from your chat channels.

**Q: I see "pairing required" when opening the Control UI. How do I fix it?**

A: New browsers/devices need a one-time approval from the gateway. Go to `/setup`, click "Manage Devices" in the Devices section, and click "Approve Latest Request". Refresh the Control UI and it should connect. Local connections (127.0.0.1) are auto-approved; remote connections (LAN, public URL) require explicit approval.

**Q: How do I change the AI model after setup?**

A: Use the OpenClaw CLI to switch models. Railway provides an integrated in-browser shell directly in your dashboard — no external SSH client needed. Open the Railway dashboard, click your service, go to the **Console** tab, and use the connected shell to run:

```bash
openclaw models set provider/model-id
```

For example: `openclaw models set anthropic/claude-sonnet-4-20250514` or `openclaw models set openai/gpt-4-turbo`. Use `openclaw models list --all` to see available models.

**Q: How do I access configuration after the initial setup?**

A: Visit `/setup` on your deployed instance at any time — it works both before and after setup. Once configured, the setup page shows your current status along with management tools: device approval, health checks (Run Doctor), data export, and a reset option. You'll need your `SETUP_PASSWORD` to access it.

**Q: My config seems broken or I'm getting strange errors. How do I fix it?**

A: Go to `/setup` and click the "Run Doctor" button. This runs `openclaw doctor --fix` which performs health checks on your gateway and channels, creates a backup of your config, and removes any unrecognized or corrupted configuration keys.

## Screenshots

## Setup

<img width="2110" height="2032" alt="CleanShot 2026-02-23 at 21 57 59@2x" src="https://github.com/user-attachments/assets/28640eec-fa35-42f2-ba56-cb1fbb9525de" />

## Device approval

<img width="1712" height="1376" alt="CleanShot 2026-02-23 at 21 59 21@2x" src="https://github.com/user-attachments/assets/f30ab683-dbc2-4980-ace7-152265e00c79" />

## Support

Need help? [Request support on Railway Station](https://station.railway.com/all-templates/d0880c01-2cc5-462c-8b76-d84c1a203348)
