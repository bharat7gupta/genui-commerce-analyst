import assert from "node:assert/strict";

import { comparePeriods } from "../application/compare-periods.js";

// Read the existing seeded database; no model calls or database recreation.
const result = await comparePeriods(
  "net_revenue",
  { start: "2025-08-01", end: "2025-09-01" },
  { start: "2025-09-01", end: "2025-10-01" },
);
assert.equal(result.baselineValue, "7225.00");
assert.equal(result.targetValue, "8295.00");
assert.equal(result.absoluteChange, "1070.00");
assert.equal(result.percentageChange, "14.81");
console.log(JSON.stringify(result, null, 2));
