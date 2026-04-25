export function canServeGatewayRequest({
  configured,
  hasProcessHandle,
  starting,
  reachable,
}) {
  if (!configured) return false;
  return (hasProcessHandle && !starting) || reachable;
}

export function describeGatewayHealth({
  configured,
  hasProcessHandle,
  starting,
  reachable,
}) {
  const serving = canServeGatewayRequest({
    configured,
    hasProcessHandle,
    starting,
    reachable,
  });
  return {
    gateway: !configured
      ? "unconfigured"
      : serving
        ? "ready"
        : "starting",
    gatewayRunning: hasProcessHandle && !starting,
    gatewayStarting: starting,
    gatewayReachable: reachable,
    statusCode: configured && !serving && !starting ? 503 : 200,
  };
}
