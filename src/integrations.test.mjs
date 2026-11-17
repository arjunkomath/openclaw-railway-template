import assert from "node:assert/strict";
import test from "node:test";

import { integrationPatches, integrationStatus } from "./integrations.js";

test("no variables, no patches", () => {
  assert.deepEqual(integrationPatches({}), []);
});

test("default Slack tokens are left to OpenClaw's env fallback", () => {
  assert.deepEqual(
    integrationPatches({ SLACK_BOT_TOKEN: "xoxb-a", SLACK_APP_TOKEN: "xapp-a" }),
    [],
  );
});

test("named Slack workspace becomes an account with env SecretRefs", () => {
  const [patch] = integrationPatches({
    SLACK_SKYWARD_BOT_TOKEN: "xoxb-secret",
    SLACK_SKYWARD_APP_TOKEN: "xapp-secret",
  });
  assert.equal(patch.path, "channels.slack.accounts.skyward");
  assert.deepEqual(patch.value.botToken, {
    source: "env",
    provider: "default",
    id: "SLACK_SKYWARD_BOT_TOKEN",
  });
  assert.equal(patch.value.appToken.id, "SLACK_SKYWARD_APP_TOKEN");
  assert.ok(!JSON.stringify(patch).includes("secret"));
});

test("Slack workspace needs both tokens", () => {
  assert.deepEqual(integrationPatches({ SLACK_SKYWARD_BOT_TOKEN: "xoxb" }), []);
});

test("brain and Supabase MCP servers keep keys as placeholders", () => {
  const patches = integrationPatches({
    BRAIN_MCP_URL: "https://brain.example.com/mcp",
    BRAIN_API_KEY: "brain-secret",
    SUPABASE_PROJECT_REF: "abc123",
    SUPABASE_ACCESS_TOKEN: "sbp_secret",
  });
  assert.deepEqual(
    patches.map((p) => p.path),
    ["mcp.servers.brain", "mcp.servers.supabase"],
  );
  assert.equal(patches[0].value.headers.Authorization, "Bearer ${BRAIN_API_KEY}");
  assert.match(patches[1].value.url, /project_ref=abc123&read_only=true$/);
  assert.ok(!JSON.stringify(patches).includes("secret"));
});

test("status reports search and PageSpeed keys without values", () => {
  const status = integrationStatus({ BRAVE_API_KEY: "k", PAGESPEED_API_KEY: "p" });
  assert.deepEqual(status.webSearchKeys, ["BRAVE_API_KEY"]);
  assert.equal(status.pageSpeedKey, true);
});
