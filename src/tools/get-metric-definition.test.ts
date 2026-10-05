import assert from "node:assert/strict";
import test from "node:test";

import {
  executeGetMetricDefinition,
  getMetricDefinitionToolDefinition,
  type GetMetricDefinitionHandler,
} from "./get-metric-definition.js";

test("returns the authoritative definition for a supported metric", () => {
  const result = executeGetMetricDefinition({ metric: "net_revenue" });

  assert.deepEqual(result, {
    success: true,
    data: {
      metric: "net_revenue",
      meaning: "Net revenue after discounts and refunds.",
      calculation: "SUM(gross_amount - discount_amount - refund_amount)",
      relevantExclusions: [
        "No order statuses are excluded unless an explicit supported status filter is applied.",
      ],
    },
  });
  assert.deepEqual(getMetricDefinitionToolDefinition.parameters, {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: [
          "total_gross_revenue",
          "net_revenue",
          "total_refund_amount",
        ],
      },
    },
    required: ["metric"],
    additionalProperties: false,
  });
});

test("rejects a missing metric without invoking the handler", () => {
  expectInvalidArguments({}, "invalid_value");
});

test("rejects an unsupported metric without invoking the handler", () => {
  expectInvalidArguments({ metric: "profit" }, "invalid_value");
});

test("rejects extra fields without invoking the handler", () => {
  expectInvalidArguments(
    { metric: "total_gross_revenue", sql: "SELECT * FROM orders" },
    "unrecognized_keys",
  );
});

function expectInvalidArguments(input: unknown, expectedIssueCode: string): void {
  let handlerCalls = 0;
  const handler: GetMetricDefinitionHandler = () => {
    handlerCalls += 1;
    throw new Error("Handler must not be called for invalid arguments");
  };

  const result = executeGetMetricDefinition(input, handler);

  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.ok(
    result.error.issues.some(({ code }) => code === expectedIssueCode),
    `Expected ${expectedIssueCode}, received ${result.error.issues.map(({ code }) => code).join(", ")}`,
  );
  assert.equal(handlerCalls, 0);
}
