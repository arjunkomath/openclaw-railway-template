// Heartbeat cost controls from Railway variables. Heartbeats inherit the agent's
// chat model (e.g. Opus with thinking) unless overridden, and per-agent
// `agents.entries.<id>.heartbeat` blocks shadow the defaults, so every agent
// that has its own heartbeat block gets the override too.

const SETTINGS = [
  ["HEARTBEAT_MODEL", "model"],
  ["HEARTBEAT_EVERY", "every"],
];

// OpenClaw treats a zero interval as "heartbeat off".
const OFF = "0m";

export function disabledHeartbeatAgents(env) {
  return [
    ...new Set(
      (env.HEARTBEAT_DISABLED_AGENTS ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

export function heartbeatPatches(env, agentEntries = {}) {
  const entries = agentEntries ?? {};
  const disabled = disabledHeartbeatAgents(env).filter((id) => id in entries);
  const overrides = SETTINGS.flatMap(([name, field]) => {
    const value = env[name]?.trim();
    return value ? [[field, value]] : [];
  });

  const scopes = [
    "agents.defaults.heartbeat",
    ...Object.keys(entries)
      .filter((id) => entries[id]?.heartbeat && !disabled.includes(id))
      .sort()
      .map((id) => `agents.entries.${id}.heartbeat`),
  ];

  return [
    ...(overrides.length === 0
      ? []
      : scopes.flatMap((scope) =>
          overrides.map(([field, value]) => ({ path: `${scope}.${field}`, value })),
        )),
    ...disabled.map((id) => ({ path: `agents.entries.${id}.heartbeat.every`, value: OFF })),
  ];
}

export function costPolicyStatus(env) {
  return {
    ...Object.fromEntries(SETTINGS.map(([name]) => [name, env[name]?.trim() || null])),
    HEARTBEAT_DISABLED_AGENTS: disabledHeartbeatAgents(env),
  };
}
