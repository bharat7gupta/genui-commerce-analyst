import { z } from "zod";

export const kpiSpecificationSchema = z.object({
  type: z.enum(["kpi", "table"], { error: 'Unknown component type; expected "kpi" or "table".' }),
  resultField: z.literal("net_revenue", {
    error: 'Unknown result field; expected "net_revenue".',
  }),
}).strict();

export type KpiSpecification = z.infer<typeof kpiSpecificationSchema>;

export const KPI_SPECIFICATION = {
  type: "kpi",
  resultField: "net_revenue",
} satisfies KpiSpecification;

export const TABLE_SPECIFICATION = {
  type: "table",
  resultField: "net_revenue",
} satisfies KpiSpecification;

export class UiSpecificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiSpecificationValidationError";
  }
}

export function parseKpiSpecification(input: unknown): KpiSpecification {
  const result = kpiSpecificationSchema.safeParse(input);
  if (!result.success) {
    throw new UiSpecificationValidationError(
      `Invalid UI specification: ${result.error.issues.map((issue) =>
        `${issue.path.join(".") || "specification"}: ${issue.message}`,
      ).join("; ")}`,
    );
  }
  return result.data;
}
