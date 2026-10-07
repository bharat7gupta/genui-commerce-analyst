import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import type { TableRow } from "../application/commerce-analysis-pipeline.js";
import { parseKpiSpecification } from "./kpi-specification.js";
import { NET_REVENUE_KPI_PLAN as plan } from "./net-revenue-kpi-plan.js";

if (plan.metric.kind !== "metric" || plan.dateRange.kind !== "interval") {
  throw new Error("The KPI example requires a metric and an explicit interval");
}
const metric = plan.metric.value;
const { start, end } = plan.dateRange;

function NetRevenuePage({ content }: { content: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Net revenue · Commerce Analyst</title>
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; background: #f4f6f8; color: #172a3a;
            font-family: system-ui, sans-serif; }
          main { max-width: 640px; margin: 12vh auto; padding: 24px; }
          h1 { font-size: 24px; margin-bottom: 24px; }
          .kpi { background: white; border: 1px solid #dce3e8;
            border-radius: 16px; padding: 28px; }
          h2 { font-size: 16px; margin: 0; font-weight: 600; }
          .value { font-size: clamp(36px, 8vw, 52px); font-weight: 650;
            font-variant-numeric: tabular-nums; margin: 16px 0 24px; }
          dl { margin: 0; border-top: 1px solid #e5eaee; padding-top: 20px; }
          dt { color: #536574; font-size: 13px; margin-top: 12px; }
          dd { margin: 4px 0 0; overflow-wrap: anywhere; }
          .definition { color: #536574; font-size: 14px; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5eaee;
            font-variant-numeric: tabular-nums; }
        `}</style>
      </head>
      <body>
        <main>
          <h1>Commerce Analyst</h1>
          {content}
        </main>
      </body>
    </html>
  );
}

function NetRevenueCard({ content }: { content: ReactNode }) {
  return (
    <article className="kpi" aria-labelledby="metric-title">
      <h2 id="metric-title">Net revenue</h2>
      {content}
      <dl>
        <dt>Metric</dt>
        <dd>{metric}</dd>
        <dt>Date range</dt>
        <dd><time dateTime={start}>{start}</time> (inclusive) → <time dateTime={end}>{end}</time> (exclusive)</dd>
      </dl>
      <p className="definition">Gross revenue minus discounts and refunds. All regions and order statuses.</p>
    </article>
  );
}

function createCard(input: unknown, rows: readonly TableRow[]): ReactNode {
  // Validate before selecting a component or looking up any result value.
  const specification = parseKpiSpecification(input);
  const values = rows.map((row) => {
    const value = row[specification.resultField];
    if (value !== null && typeof value !== "string") {
      throw new Error("Expected net_revenue rows containing a decimal string or NULL");
    }
    return value;
  });

  let content: ReactNode;
  switch (specification.type) {
    case "kpi":
      if (values.length !== 1) {
        throw new Error("Expected one net_revenue row for the KPI");
      }
      content = <p className="value">{values[0] ?? "No matching orders"}</p>;
      break;
    case "table":
      content = (
        <table aria-label="Net revenue results">
          <thead><tr><th scope="col">Net revenue</th></tr></thead>
          <tbody>
            {values.map((value, index) => (
              <tr key={index}><td>{value ?? "No matching orders"}</td></tr>
            ))}
          </tbody>
        </table>
      );
      break;
  }
  return <NetRevenueCard content={content} />;
}

export function renderKpiPage(input: unknown, rows: readonly TableRow[]): string {
  return "<!doctype html>" + renderToStaticMarkup(<NetRevenuePage content={createCard(input, rows)} />);
}

export function renderKpiFragment(input: unknown, rows: readonly TableRow[]): string {
  return renderToStaticMarkup(createCard(input, rows));
}
