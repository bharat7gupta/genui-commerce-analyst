import assert from "node:assert/strict";
import test from "node:test";

import {
  executeGetSchema,
  getSchemaToolDefinition,
  type GetSchemaHandler,
} from "./get-schema.js";

test("returns the application-supported query schema", () => {
  const result = executeGetSchema({});

  assert.deepEqual(result, {
    success: true,
    data: {
      metrics: [
        "total_gross_revenue",
        "net_revenue",
        "total_refund_amount",
      ],
      dimensions: ["region", "category", "status"],
      filters: {
        fields: [
          "order_id",
          "customer_id",
          "region",
          "category",
          "status",
          "gross_amount",
          "discount_amount",
          "refund_amount",
        ],
        operatorsByField: {
          order_id: ["eq", "in"],
          customer_id: ["eq", "in"],
          region: ["eq", "in"],
          category: ["eq", "in"],
          status: ["eq", "in"],
          gross_amount: ["eq", "gt", "gte", "lt", "lte"],
          discount_amount: ["eq", "gt", "gte", "lt", "lte"],
          refund_amount: ["eq", "gt", "gte", "lt", "lte"],
        },
        enumeratedValuesByField: {
          region: ["North", "South", "East", "West"],
          category: ["Electronics", "Apparel", "Home", "Beauty"],
          status: ["completed", "partially_refunded", "refunded"],
        },
      },
    },
  });
  assert.equal(getSchemaToolDefinition.name, "get_schema");
  assert.match(
    getSchemaToolDefinition.description,
    /supported metrics, dimensions, filter fields, per-field operators, and enumerated filter values/,
  );
  assert.deepEqual(getSchemaToolDefinition.parameters, {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {},
    additionalProperties: false,
  });
});

test("rejects extra arguments without invoking the handler", () => {
  let handlerCalls = 0;
  const handler: GetSchemaHandler = () => {
    handlerCalls += 1;
    throw new Error("Handler must not be called for invalid arguments");
  };

  const result = executeGetSchema({ includeRows: true }, handler);

  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.ok(
    result.error.issues.some(({ code }) => code === "unrecognized_keys"),
  );
  assert.equal(handlerCalls, 0);
});
