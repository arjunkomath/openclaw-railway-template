import assert from "node:assert/strict";
import test from "node:test";

import {
  costPolicyStatus,
  disabledHeartbeatAgents,
  heartbeatPatches,
} from "./cost-policy.js";

test("no variables, no patches", () => {
  assert.deepEqual(heartbeatPatches({}, { forge: { heartbeat: {} } }), []);
});

test("model override hits defaults and every agent with its own heartbeat", () => {
  const patches = heartbeatPatches(
    { HEARTBEAT_MODEL: " anthropic/claude-haiku-5-5 " },
    { vance: { heartbeat: { every: "15m" } }, forge: { heartbeat: {} }, main: {} },
  );
  assert.deepEqual(patches, [
    { path: "agents.defaults.heartbeat.model", value: "anthropic/claude-haiku-5-5" },
    { path: "agents.entries.forge.heartbeat.model", value: "anthropic/claude-haiku-5-5" },
    { path: "agents.entries.vance.heartbeat.model", value: "anthropic/claude-haiku-5-5" },
  ]);
});

test("model and interval together, tolerates missing entries", () => {
  const patches = heartbeatPatches(
    { HEARTBEAT_MODEL: "m", HEARTBEAT_EVERY: "2h" },
    undefined,
  );
  assert.deepEqual(patches, [
    { path: "agents.defaults.heartbeat.model", value: "m" },
    { path: "agents.defaults.heartbeat.every", value: "2h" },
  ]);
});

test("disabled agents get a zero interval and skip the other overrides", () => {
  const patches = heartbeatPatches(
    { HEARTBEAT_EVERY: "2h", HEARTBEAT_DISABLED_AGENTS: "Vance, main,ghost" },
    { vance: { heartbeat: {} }, main: {}, forge: { heartbeat: {} } },
  );
  assert.deepEqual(patches, [
    { path: "agents.defaults.heartbeat.every", value: "2h" },
    { path: "agents.entries.forge.heartbeat.every", value: "2h" },
    { path: "agents.entries.main.heartbeat.every", value: "0m" },
    { path: "agents.entries.vance.heartbeat.every", value: "0m" },
  ]);
});

test("disabled list is normalized", () => {
  assert.deepEqual(disabledHeartbeatAgents({ HEARTBEAT_DISABLED_AGENTS: " b,a,,B " }), [
    "a",
    "b",
  ]);
});

test("status reports what is set", () => {
  assert.deepEqual(costPolicyStatus({ HEARTBEAT_EVERY: "2h" }), {
    HEARTBEAT_MODEL: null,
    HEARTBEAT_EVERY: "2h",
    HEARTBEAT_DISABLED_AGENTS: [],
  });
});
