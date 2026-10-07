import assert from "node:assert/strict";
import test from "node:test";

import { KPI_SPECIFICATION, TABLE_SPECIFICATION, UiSpecificationValidationError } from "./kpi-specification.js";
import { renderKpiPage } from "./net-revenue-kpi-page.js";

test("the same specification renders changing executor values", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    for (const value of ["12.34", "98.76"]) {
      const html = renderKpiPage(specification, [{ net_revenue: value }]);
      assert.ok(html.includes(specification.type === "kpi"
        ? `<p class="value">${value}</p>` : `<td>${value}</td>`));
      assert.ok(html.includes("net_revenue"));
      assert.ok(html.includes("2025-08-01"));
      assert.ok(html.includes("2025-09-01"));
    }
  }
});

test("the table displays each executor row under the Net revenue column", () => {
  const html = renderKpiPage(TABLE_SPECIFICATION, [
    { net_revenue: "12.34" }, { net_revenue: "98.76" }, { net_revenue: null },
  ]);
  assert.ok(html.includes('<th scope="col">Net revenue</th>'));
  assert.ok(html.includes("<td>12.34</td>"));
  assert.ok(html.includes("<td>98.76</td>"));
  assert.ok(html.includes("<td>Unavailable</td>"));
});

test("unknown component types are rejected before reading results", () => {
  assert.throws(
    () => renderKpiPage({ type: "chart", resultField: "net_revenue" }, []),
    (error) => error instanceof UiSpecificationValidationError &&
      error.message.includes('Unknown component type; expected "kpi" or "table"'),
  );
});

test("unknown result fields are rejected even when present in results", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    assert.throws(
      () => renderKpiPage({ ...specification, resultField: "profit" }, [{ profit: "100.00" }]),
      (error) => error instanceof UiSpecificationValidationError &&
        error.message.includes('Unknown result field; expected "net_revenue"'),
    );
  }
});

test("a specification cannot carry its own numeric value", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    assert.throws(
      () => renderKpiPage({ ...specification, value: 123 }, [{ net_revenue: "12.34" }]),
      UiSpecificationValidationError,
    );
  }
});

test("SQL NULL shows the no-match state for both types; missing aggregate rows are errors", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    const html = renderKpiPage(specification, [{ net_revenue: null }]);
    assert.ok(html.includes("No matching data for this date range"));
    assert.ok(html.includes("net_revenue"));
    assert.ok(html.includes("2025-08-01"));
    assert.ok(html.includes("2025-09-01"));
    assert.ok(!html.includes('<p class="value">'));
    assert.ok(!html.includes("<table"));
    assert.throws(() => renderKpiPage(specification, []), /Expected one net_revenue row/);
  }
});

test("decimal zero remains a normal KPI/table value", () => {
  for (const specification of [KPI_SPECIFICATION, TABLE_SPECIFICATION]) {
    const html = renderKpiPage(specification, [{ net_revenue: "0.00" }]);
    assert.ok(html.includes(specification.type === "kpi"
      ? '<p class="value">0.00</p>' : '<td>0.00</td>'));
    assert.ok(!html.includes("No matching data"));
  }
});
