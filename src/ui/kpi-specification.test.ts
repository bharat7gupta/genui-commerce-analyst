import assert from "node:assert/strict";
import test from "node:test";

import { KPI_SPECIFICATION, UiSpecificationValidationError } from "./kpi-specification.js";
import { renderKpiPage } from "./net-revenue-kpi-page.js";

test("the same specification renders changing executor values", () => {
  for (const value of ["12.34", "98.76"]) {
    const html = renderKpiPage(KPI_SPECIFICATION, [{ net_revenue: value }]);
    assert.ok(html.includes(`<p class="value">${value}</p>`));
    assert.ok(html.includes("2025-08-01"));
    assert.ok(html.includes("2025-09-01"));
  }
});

test("unknown component types are rejected before reading results", () => {
  assert.throws(
    () => renderKpiPage({ type: "chart", resultField: "net_revenue" }, []),
    (error) => error instanceof UiSpecificationValidationError &&
      error.message.includes('Unknown component type; expected "kpi"'),
  );
});

test("unknown result fields are rejected even when present in results", () => {
  assert.throws(
    () => renderKpiPage({ type: "kpi", resultField: "profit" }, [{ profit: "100.00" }]),
    (error) => error instanceof UiSpecificationValidationError &&
      error.message.includes('Unknown result field; expected "net_revenue"'),
  );
});

test("a specification cannot carry its own numeric value", () => {
  assert.throws(
    () => renderKpiPage({ ...KPI_SPECIFICATION, value: 123 }, [{ net_revenue: "12.34" }]),
    UiSpecificationValidationError,
  );
});

test("NULL is shown as no matching orders, and missing results are rejected", () => {
  assert.ok(renderKpiPage(KPI_SPECIFICATION, [{ net_revenue: null }]).includes("No matching orders"));
  assert.throws(() => renderKpiPage(KPI_SPECIFICATION, []), /Expected one net_revenue row/);
});
