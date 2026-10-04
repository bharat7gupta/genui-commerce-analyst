import type { ModelProvider } from "../ai/provider.js";
import {
  ROUTER_SYSTEM_PROMPT,
  ROUTER_VERSION,
  ROUTE_LABELS,
  type RouteLabel,
} from "./router-v1-prompt.js";

export type RoutingDecision = {
  routerVersion: typeof ROUTER_VERSION;
  route: RouteLabel;
};

export class InvalidRouteOutputError extends Error {
  constructor(readonly output: string) {
    super(`Invalid router output: ${JSON.stringify(output)}`);
    this.name = "InvalidRouteOutputError";
  }
}

export async function routeRequest(
  provider: ModelProvider,
  userRequest: string,
): Promise<RoutingDecision> {
  const result = await provider.generate({
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      { role: "user", content: userRequest },
    ],
    temperature: 0,
    maxTokens: 8,
  });

  if (!isRouteLabel(result.text)) {
    throw new InvalidRouteOutputError(result.text);
  }

  return {
    routerVersion: ROUTER_VERSION,
    route: result.text,
  };
}

function isRouteLabel(output: string): output is RouteLabel {
  return ROUTE_LABELS.some((label) => output === label);
}
