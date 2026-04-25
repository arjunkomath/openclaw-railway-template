import assert from "node:assert/strict";
import test from "node:test";

import {
  canServeGatewayRequest,
  describeGatewayHealth,
} from "./gateway-readiness.js";

test("serves gateway requests when a detached gateway is reachable", () => {
  assert.equal(
    canServeGatewayRequest({
      configured: true,
      hasProcessHandle: false,
      starting: false,
      reachable: true,
    }),
    true,
  );
});

test("reports a reachable detached gateway as ready", () => {
  assert.deepEqual(
    describeGatewayHealth({
      configured: true,
      hasProcessHandle: false,
      starting: false,
      reachable: true,
    }),
    {
      gateway: "ready",
      gatewayRunning: false,
      gatewayStarting: false,
      gatewayReachable: true,
      statusCode: 200,
    },
  );
});

test("does not serve gateway requests while configured gateway is unreachable", () => {
  assert.equal(
    canServeGatewayRequest({
      configured: true,
      hasProcessHandle: false,
      starting: false,
      reachable: false,
    }),
    false,
  );
});

test("marks configured stopped gateway unhealthy for Railway recovery", () => {
  assert.deepEqual(
    describeGatewayHealth({
      configured: true,
      hasProcessHandle: false,
      starting: false,
      reachable: false,
    }),
    {
      gateway: "starting",
      gatewayRunning: false,
      gatewayStarting: false,
      gatewayReachable: false,
      statusCode: 503,
    },
  );
});

test("keeps starting gateway healthy during boot grace", () => {
  assert.deepEqual(
    describeGatewayHealth({
      configured: true,
      hasProcessHandle: false,
      starting: true,
      reachable: false,
    }),
    {
      gateway: "starting",
      gatewayRunning: false,
      gatewayStarting: true,
      gatewayReachable: false,
      statusCode: 200,
    },
  );
});
