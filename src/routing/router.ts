import type { ModelProvider } from "../ai/provider.js";
import {
  ROUTER_SYSTEM_PROMPT as ROUTER_V1_SYSTEM_PROMPT,
  ROUTER_VERSION as ROUTER_V1_VERSION,
  ROUTE_LABELS,
  type RouteLabel,
} from "./router-v1-prompt.js";
import {
  ROUTER_V2_SYSTEM_PROMPT,
  ROUTER_V2_VERSION,
} from "./router-v2-prompt.js";
import {
  ROUTER_V3_PROMPT_PACKAGE,
  ROUTER_V3_VERSION,
  type RouterV3Example,
} from "./router-v3-prompt.js";

export type RouterVersion =
  | typeof ROUTER_V1_VERSION
  | typeof ROUTER_V2_VERSION
  | typeof ROUTER_V3_VERSION;

export type RoutingDecision = {
  routerVersion: RouterVersion;
  route: RouteLabel;
};

type RouterPromptPackage = Readonly<{
  systemPrompt: string;
  examples: readonly RouterV3Example[];
}>;

const NO_EXAMPLES: readonly RouterV3Example[] = Object.freeze([]);
const ROUTER_PROMPT_PACKAGES: Readonly<
  Record<RouterVersion, RouterPromptPackage>
> = Object.freeze({
  [ROUTER_V1_VERSION]: Object.freeze({
    systemPrompt: ROUTER_V1_SYSTEM_PROMPT,
    examples: NO_EXAMPLES,
  }),
  [ROUTER_V2_VERSION]: Object.freeze({
    systemPrompt: ROUTER_V2_SYSTEM_PROMPT,
    examples: NO_EXAMPLES,
  }),
  [ROUTER_V3_VERSION]: ROUTER_V3_PROMPT_PACKAGE,
});

export class InvalidRouteOutputError extends Error {
  constructor(readonly output: string) {
    super(`Invalid router output: ${JSON.stringify(output)}`);
    this.name = "InvalidRouteOutputError";
  }
}

export async function routeRequest(
  provider: ModelProvider,
  userRequest: string,
  routerVersion: RouterVersion = ROUTER_V1_VERSION,
): Promise<RoutingDecision> {
  const promptPackage = ROUTER_PROMPT_PACKAGES[routerVersion];
  const result = await provider.generate({
    messages: [
      { role: "system", content: promptPackage.systemPrompt },
      ...promptPackage.examples.flatMap(({ user, assistant }) => [
        user,
        assistant,
      ]),
      { role: "user", content: userRequest },
    ],
    temperature: 0,
    maxTokens: 8,
  });

  if (!isRouteLabel(result.text)) {
    throw new InvalidRouteOutputError(result.text);
  }

  return {
    routerVersion,
    route: result.text,
  };
}

function isRouteLabel(output: string): output is RouteLabel {
  return ROUTE_LABELS.some((label) => output === label);
}
