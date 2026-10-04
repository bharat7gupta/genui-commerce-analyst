import assert from "node:assert/strict";
import test from "node:test";

import type {
  ModelProvider,
  ModelRequest,
  ModelResult,
} from "../ai/provider.js";
import {
  ROUTER_SYSTEM_PROMPT as ROUTER_V1_SYSTEM_PROMPT,
  ROUTER_VERSION as ROUTER_V1_VERSION,
} from "./router-v1-prompt.js";
import {
  ROUTER_V2_SYSTEM_PROMPT,
  ROUTER_V2_VERSION,
} from "./router-v2-prompt.js";
import {
  ROUTER_V3_EXAMPLES,
  ROUTER_V3_OUTPUT_LABELS,
  ROUTER_V3_PROMPT_PACKAGE,
  ROUTER_V3_SYSTEM_PROMPT,
  ROUTER_V3_VERSION,
} from "./router-v3-prompt.js";
import {
  InvalidRouteOutputError,
  routeRequest,
  type RouterVersion,
} from "./router.js";

test("all immutable prompt versions remain independently available", () => {
  assert.equal(ROUTER_V1_VERSION, "router-v1");
  assert.equal(ROUTER_V2_VERSION, "router-v2");
  assert.equal(ROUTER_V3_VERSION, "router-v3");
  assert.notEqual(ROUTER_V1_VERSION, ROUTER_V2_VERSION);
  assert.notEqual(ROUTER_V1_VERSION, ROUTER_V3_VERSION);
  assert.notEqual(ROUTER_V2_VERSION, ROUTER_V3_VERSION);
  assert.notEqual(ROUTER_V1_SYSTEM_PROMPT, ROUTER_V2_SYSTEM_PROMPT);
  assert.notEqual(ROUTER_V1_SYSTEM_PROMPT, ROUTER_V3_SYSTEM_PROMPT);
  assert.notEqual(ROUTER_V2_SYSTEM_PROMPT, ROUTER_V3_SYSTEM_PROMPT);
});

test("router-v1 remains the default selection", async () => {
  const capturedRequests: ModelRequest[] = [];
  const decision = await routeRequest(
    createFakeProvider("docs", (request) => {
      capturedRequests.push(request);
    }),
    "Look up a documented definition.",
  );
  const capturedRequest = capturedRequests[0];

  assert.ok(capturedRequest);
  assert.equal(decision.routerVersion, ROUTER_V1_VERSION);
  assert.equal(capturedRequest.messages[0]?.content, ROUTER_V1_SYSTEM_PROMPT);
});

test("selecting router-v2 sends its own trusted prompt", async () => {
  const capturedRequests: ModelRequest[] = [];
  const userRequest = "Analyze a defined commerce metric.";
  const decision = await routeRequest(
    createFakeProvider("analytics", (request) => {
      capturedRequests.push(request);
    }),
    userRequest,
    ROUTER_V2_VERSION,
  );
  const capturedRequest = capturedRequests[0];

  assert.ok(capturedRequest);
  assert.deepEqual(
    capturedRequest.messages.map(({ role }) => role),
    ["system", "user"],
  );
  assert.equal(capturedRequest.messages[0]?.content, ROUTER_V2_SYSTEM_PROMPT);
  assert.equal(capturedRequest.messages[1]?.content, userRequest);
  assert.equal(capturedRequest.temperature, 0);
  assert.equal(capturedRequest.maxTokens, 8);
  assert.deepEqual(decision, {
    routerVersion: ROUTER_V2_VERSION,
    route: "analytics",
  });
});

test("router-v3 is a frozen package with exactly six examples", () => {
  assert.equal(ROUTER_V3_EXAMPLES.length, 6);
  assert.ok(Object.isFrozen(ROUTER_V3_PROMPT_PACKAGE));
  assert.ok(Object.isFrozen(ROUTER_V3_EXAMPLES));
  assert.ok(Object.isFrozen(ROUTER_V3_OUTPUT_LABELS));
  assert.ok(
    ROUTER_V3_EXAMPLES.every(
      (example) =>
        Object.isFrozen(example) &&
        Object.isFrozen(example.user) &&
        Object.isFrozen(example.assistant),
    ),
  );
});

test("selecting router-v3 sends its own prompt package", async () => {
  const capturedRequests: ModelRequest[] = [];
  const userRequest = "Classify this new request.";
  const decision = await routeRequest(
    createFakeProvider("investigation", (request) => {
      capturedRequests.push(request);
    }),
    userRequest,
    ROUTER_V3_VERSION,
  );
  const capturedRequest = capturedRequests[0];

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.messages.length, 14);
  assert.equal(capturedRequest.messages[0]?.role, "system");
  assert.equal(capturedRequest.messages[0]?.content, ROUTER_V3_SYSTEM_PROMPT);
  assert.deepEqual(
    capturedRequest.messages.slice(1, -1),
    ROUTER_V3_EXAMPLES.flatMap(({ user, assistant }) => [user, assistant]),
  );
  assert.deepEqual(capturedRequest.messages.at(-1), {
    role: "user",
    content: userRequest,
  });
  assert.equal(capturedRequest.temperature, 0);
  assert.equal(capturedRequest.maxTokens, 8);
  assert.deepEqual(decision, {
    routerVersion: ROUTER_V3_VERSION,
    route: "investigation",
  });
});

test("all versions retain exact-label output validation", async () => {
  const versions: readonly RouterVersion[] = [
    ROUTER_V1_VERSION,
    ROUTER_V2_VERSION,
    ROUTER_V3_VERSION,
  ];

  for (const version of versions) {
    const exact = await routeRequest(
      createFakeProvider("clarify"),
      "An underspecified request.",
      version,
    );
    assert.equal(exact.route, "clarify");

    for (const invalidOutput of ["clarify\n", "Route: clarify"]) {
      await assert.rejects(
        routeRequest(
          createFakeProvider(invalidOutput),
          "An underspecified request.",
          version,
        ),
        (error) =>
          error instanceof InvalidRouteOutputError &&
          error.output === invalidOutput,
      );
    }
  }
});

function createFakeProvider(
  output: string,
  observe?: (request: ModelRequest) => void,
): ModelProvider {
  return {
    async generate(request): Promise<ModelResult> {
      observe?.(request);

      return {
        text: output,
        metadata: {
          model: "fake-model",
          tokenUsage: null,
          latencyMs: 0,
          requestId: null,
        },
      };
    },
  };
}
