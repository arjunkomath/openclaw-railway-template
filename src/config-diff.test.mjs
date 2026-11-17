import assert from "node:assert/strict";
import test from "node:test";

import { changedPatches, getPath } from "./config-diff.js";

const config = {
  agents: {
    defaults: { heartbeat: { model: "anthropic/claude-haiku-5-5", every: "2h" } },
    entries: { vance: { heartbeat: { every: "0m" } } },
  },
  mcp: { servers: { jira: { url: "https://x", headers: { a: "1" } } } },
};

test("getPath walks dotted keys and tolerates missing branches", () => {
  assert.equal(getPath(config, "agents.defaults.heartbeat.every"), "2h");
  assert.equal(getPath(config, "agents.entries.forge.heartbeat.every"), undefined);
  assert.equal(getPath(null, "a.b"), undefined);
});

test("drops patches already applied, keeps the rest", () => {
  const patches = [
    { path: "agents.defaults.heartbeat.every", value: "2h" },
    { path: "agents.defaults.heartbeat.model", value: "anthropic/claude-sonnet-5-5" },
    { path: "agents.entries.vance.heartbeat.every", value: "0m" },
    { path: "agents.entries.forge.heartbeat.every", value: "0m" },
  ];
  assert.deepEqual(changedPatches(config, patches), [patches[1], patches[3]]);
});

test("object values compare structurally, ignoring key order", () => {
  const same = { path: "mcp.servers.jira", value: { headers: { a: "1" }, url: "https://x" } };
  const diff = { path: "mcp.servers.jira", value: { url: "https://y", headers: { a: "1" } } };
  assert.deepEqual(changedPatches(config, [same, diff]), [diff]);
});

test("unreadable config keeps every patch", () => {
  const patches = [{ path: "a.b", value: 1 }];
  assert.deepEqual(changedPatches(null, patches), patches);
});
