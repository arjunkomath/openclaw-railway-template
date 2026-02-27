---
name: github-app-auth
description: "Mint a fresh GitHub App installation token using the locally stored private key. Use when: (1) gh CLI returns 401 or Bad credentials, (2) GH_TOKEN is expired or missing, (3) before any GitHub operation that requires auth, (4) a cron job reports GitHub auth failure. NOT for: initial GitHub App setup, PAT-based auth, or gh auth login flows."
---

# GitHub App Auth

Mint a fresh GitHub App installation token using the locally stored private key.

## How It Works

A bash script creates a JWT from the GitHub App credentials, exchanges it for a short-lived
installation access token (~1 hour), and persists it to `/data/.openclaw/.env`.

## Usage

1. Run the refresh script:

```bash
bash /data/.openclaw/github-skill/token-refresh.sh
```

2. Load the new token into the current shell:

```bash
. /data/.openclaw/.env && export GH_TOKEN
```

3. Verify:

```bash
gh api user/installations --jq '.[0].app_slug' 2>/dev/null && echo "Auth OK"
```

## Token Lifetime

Installation tokens expire after ~1 hour. For long-running sessions or cron jobs,
refresh proactively before GitHub operations rather than waiting for a 401.

## Troubleshooting

- **"token" key error from python3**: The JWT may be malformed or the private key file is missing/corrupt. Check that the key file exists and `openssl` is available.
- **403 on token exchange**: The GitHub App may lack permissions on the target installation. Verify app settings at https://github.com/settings/apps.
- **Token works in main session but not cron**: Isolated cron sessions get a clean environment. Either run the refresh script inside the cron task, or pass `GH_TOKEN` via cron env config.