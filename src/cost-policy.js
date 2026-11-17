// Heartbeat cost controls from Railway variables. Heartbeats inherit the agent's
// chat model (e.g. Opus with thinking) unless overridden, and per-agent
// `agents.entries.<id>.heartbeat` blocks shadow the defaults, so every agent
// that has its own heartbeat block gets the override too.

const SETTINGS = [
  ["HEARTBEAT_MODEL", "model"],
  ["HEARTBEAT_EVERY", "every"],
];

export function heartbeatPatches(env, agentEntries = {}) {
  const overrides = SETTINGS.flatMap(([name, field]) => {
    const value = env[name]?.trim();
    return value ? [[field, value]] : [];
  });
  if (overrides.length === 0) return [];

  const scopes = [
    "agents.defaults.heartbeat",
    ...Object.keys(agentEntries ?? {})
      .filter((id) => agentEntries[id]?.heartbeat)
      .sort()
      .map((id) => `agents.entries.${id}.heartbeat`),
  ];

  return scopes.flatMap((scope) =>
    overrides.map(([field, value]) => ({ path: `${scope}.${field}`, value })),
  );
}

export function costPolicyStatus(env) {
  return Object.fromEntries(
    SETTINGS.map(([name]) => [name, env[name]?.trim() || null]),
  );
}
