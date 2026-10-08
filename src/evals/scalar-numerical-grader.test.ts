import assert from "node:assert/strict";
import test from "node:test";

import { compileQueryPlan } from "../db/query-plan-sql-compiler.js";
import { augustNetRevenueCase } from "./august-net-revenue-case.js";
import { gradeScalarNumericalResult } from "./scalar-numerical-grader.js";

const expectation = augustNetRevenueCase.numericalExpectation;
const checks = [
  { name: "correct value", rows: [{ net_revenue: "7225.00" }], pass: true, reason: "equals" },
  { name: "equivalent decimal", rows: [{ net_revenue: "7225.0" }], pass: true, reason: "equals" },
  { name: "incorrect value", rows: [{ net_revenue: "7225.01" }], pass: false, reason: "received 7225.01" },
  { name: "missing field", rows: [{ total_gross_revenue: "7225.00" }], pass: false, reason: "Missing expected field" },
  { name: "empty rows", rows: [], pass: false, reason: "received 0" },
  { name: "extra row", rows: [{ net_revenue: "7225.00" }, { net_revenue: "7225.00" }], pass: false, reason: "received 2" },
  { name: "malformed value", rows: [{ net_revenue: "7225.00 USD" }], pass: false, reason: "plain decimal" },
] as const;

for (const check of checks) {
  test(check.name, (context) => {
    const verdict = gradeScalarNumericalResult(check.rows, expectation);
    assert.equal(verdict.pass, check.pass);
    assert.ok(verdict.reason.includes(check.reason));
    context.diagnostic(`${JSON.stringify(check.rows)} => ${JSON.stringify(verdict)}`);
  });
}

test("case plan fits the existing compiler and expected rows pass", () => {
  assert.deepEqual(compileQueryPlan(augustNetRevenueCase.expectedPlan).parameters,
    ["2025-08-01", "2025-09-01"]);
  assert.equal(gradeScalarNumericalResult(augustNetRevenueCase.expectedRows, expectation).pass, true);
});

test("preserves precision beyond cents and the safe integer range", () => {
  assert.equal(gradeScalarNumericalResult([{ net_revenue: "7225.0000000000000001" }], expectation).pass, false);
  const large = { field: "amount", amount: "9007199254740993.01" };
  assert.equal(gradeScalarNumericalResult([{ amount: "9007199254740993.010" }], large).pass, true);
  assert.equal(gradeScalarNumericalResult([{ amount: "9007199254740993.02" }], large).pass, false);
});

test("rejects null, non-finite numbers, exponent strings, and whitespace", () => {
  for (const value of [null, NaN, Infinity, "7.225e3", " 7225.00", "", true, 7225.1]) {
    assert.equal(gradeScalarNumericalResult([{ net_revenue: value }], expectation).pass, false);
  }
  assert.equal(gradeScalarNumericalResult([{ net_revenue: 7225 }], expectation).pass, true);
});

test("handles signed decimals and zero without rounding", () => {
  assert.equal(gradeScalarNumericalResult([{ amount: "-001.200" }], { field: "amount", amount: "-1.2" }).pass, true);
  assert.equal(gradeScalarNumericalResult([{ amount: "-0.00" }], { field: "amount", amount: "0" }).pass, true);
});
