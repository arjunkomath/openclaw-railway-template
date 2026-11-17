// Maps Railway variables to OpenClaw config so integrations can be turned on
// without the Railway console. Secrets stay in the environment: config only
// holds env SecretRefs / ${VAR} placeholders that the gateway resolves at runtime.

const envRef = (id) => ({ source: "env", provider: "default", id });

const SLACK_ACCOUNT_VAR = /^SLACK_([A-Z0-9]+)_BOT_TOKEN$/;

function slackAccounts(env) {
  const patches = [];
  for (const name of Object.keys(env).sort()) {
    const match = SLACK_ACCOUNT_VAR.exec(name);
    if (!match || !env[name]?.trim()) continue;
    const id = match[1];
    const appVar = `SLACK_${id}_APP_TOKEN`;
    if (!env[appVar]?.trim()) continue;
    patches.push({
      label: `Slack workspace "${id.toLowerCase()}"`,
      path: `channels.slack.accounts.${id.toLowerCase()}`,
      value: {
        enabled: true,
        name: id.charAt(0) + id.slice(1).toLowerCase(),
        mode: "socket",
        botToken: envRef(name),
        appToken: envRef(appVar),
      },
    });
  }
  return patches;
}

function mcpServers(env) {
  const patches = [];
  const brainUrl = env.BRAIN_MCP_URL?.trim();
  if (brainUrl && env.BRAIN_API_KEY?.trim()) {
    patches.push({
      label: "Brain MCP",
      path: "mcp.servers.brain",
      value: {
        url: brainUrl,
        transport: "streamable-http",
        headers: { Authorization: "Bearer ${BRAIN_API_KEY}" },
      },
    });
  }

  const supabaseRef = env.SUPABASE_PROJECT_REF?.trim();
  if (supabaseRef && env.SUPABASE_ACCESS_TOKEN?.trim()) {
    const url = new URL("https://mcp.supabase.com/mcp");
    url.searchParams.set("project_ref", supabaseRef);
    url.searchParams.set("read_only", "true");
    patches.push({
      label: "Supabase MCP (read-only)",
      path: "mcp.servers.supabase",
      value: {
        url: url.toString(),
        transport: "streamable-http",
        headers: { Authorization: "Bearer ${SUPABASE_ACCESS_TOKEN}" },
      },
    });
  }
  return patches;
}

// The image bakes Chromium in and sets CHROMIUM_PATH. Containers have no display
// and no user namespaces, so the managed browser runs headless without the sandbox.
// BROWSER_ENABLED=false turns the tool off.
function browser(env) {
  const executablePath = env.CHROMIUM_PATH?.trim();
  if (!executablePath) return [];
  const label = "Browser tool (headless Chromium)";
  if (env.BROWSER_ENABLED?.trim().toLowerCase() === "false") {
    return [{ label: "Browser tool (off)", path: "browser.enabled", value: false }];
  }
  return Object.entries({
    enabled: true,
    executablePath,
    headless: true,
    noSandbox: true,
    defaultProfile: "openclaw",
  }).map(([key, value]) => ({ label, path: `browser.${key}`, value }));
}

export function integrationPatches(env) {
  return [...slackAccounts(env), ...mcpServers(env), ...browser(env)];
}

const WEB_SEARCH_KEYS = [
  "BRAVE_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "GEMINI_API_KEY",
  "PARALLEL_API_KEY",
  "PERPLEXITY_API_KEY",
  "TAVILY_API_KEY",
];

export function integrationStatus(env) {
  const has = (name) => Boolean(env[name]?.trim());
  return {
    configured: [...new Set(integrationPatches(env).map((p) => p.label))],
    webSearchKeys: WEB_SEARCH_KEYS.filter(has),
    pageSpeedKey: has("PAGESPEED_API_KEY"),
  };
}
