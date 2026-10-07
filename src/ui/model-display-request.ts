import { z } from "zod";

import { enforceExplicitDateIntervalLimit } from "../db/duckdb-query-plan-executor.js";
import { parseQueryPlan } from "../query-plan/query-plan.js";
import { kpiSpecificationSchema } from "./kpi-specification.js";
import { NET_REVENUE_KPI_PLAN } from "./net-revenue-kpi-plan.js";

const requestSchema = z.object({
  specification: kpiSpecificationSchema,
  start: z.string().optional(),
  end: z.string().optional(),
}).strict();

export class MissingDatesError extends Error {
  constructor(readonly missingInputs: readonly ("start" | "end")[]) {
    super("Choose a start and end date");
    this.name = "MissingDatesError";
  }
}

export function parseModelDisplayRequest(input: unknown) {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    throw new Error(`Invalid display request: ${z.prettifyError(request.error)}`);
  }
  const { start, end } = request.data;
  if (start === undefined || start === "" || end === undefined || end === "") {
    const missing: ("start" | "end")[] = [];
    if (start === undefined || start === "") missing.push("start");
    if (end === undefined || end === "") missing.push("end");
    throw new MissingDatesError(missing);
  }
  // All plan fields except dates remain application-owned and fixed.
  const plan = parseQueryPlan({
    ...NET_REVENUE_KPI_PLAN,
    dateRange: { kind: "interval", start, end },
  });
  // Reuse the executor's date policy before the model call; execution checks it again.
  enforceExplicitDateIntervalLimit(plan);
  return { specification: request.data.specification, plan };
}
