import type { ModelProvider } from "../ai/provider.js";
import {
  extractQueryPlan,
  type QueryPlanExtractionPromptVersion,
  type QueryPlanExtractionResult,
} from "../query-plan/query-plan-extraction.js";
import { QUERY_PLAN_EXTRACTION_PROMPT_VERSION } from "../query-plan/query-plan-extraction-v1-prompt.js";
import type { QueryPlan } from "../query-plan/query-plan.js";
import { ROUTER_VERSION } from "../routing/router-v1-prompt.js";
import {
  routeRequest,
  type RouterVersion,
  type RoutingDecision,
} from "../routing/router.js";

export type TableCell = string | number | boolean | null;
export type TableRow = Readonly<Record<string, TableCell>>;

export interface QueryPlanExecutor {
  execute(plan: QueryPlan): Promise<readonly TableRow[]>;
}

type NonPlanExtractionResult = Exclude<
  QueryPlanExtractionResult,
  { outcome: "query_plan" }
>;

export type CommerceAnalysisResult =
  | {
      outcome: "routed";
      routingDecision: RoutingDecision;
    }
  | {
      outcome: "rejected";
      routingDecision: RoutingDecision & { route: "analytics" };
      extraction: NonPlanExtractionResult;
    }
  | {
      outcome: "completed";
      routingDecision: RoutingDecision & { route: "analytics" };
      queryPlan: QueryPlan;
      tableRows: readonly TableRow[];
    };

export type CommerceAnalysisOptions = {
  routerVersion?: RouterVersion;
  extractionPromptVersion?: QueryPlanExtractionPromptVersion;
};

export async function runCommerceAnalysis(
  provider: ModelProvider,
  executor: QueryPlanExecutor,
  question: string,
  options: CommerceAnalysisOptions = {},
): Promise<CommerceAnalysisResult> {
  const routingDecision = await routeRequest(
    provider,
    question,
    options.routerVersion ?? ROUTER_VERSION,
  );

  if (routingDecision.route !== "analytics") {
    return { outcome: "routed", routingDecision };
  }

  const analyticsRoutingDecision = {
    ...routingDecision,
    route: "analytics" as const,
  };
  const extraction = await extractQueryPlan(
    provider,
    question,
    options.extractionPromptVersion ?? QUERY_PLAN_EXTRACTION_PROMPT_VERSION,
  );

  if (extraction.outcome !== "query_plan") {
    return {
      outcome: "rejected",
      routingDecision: analyticsRoutingDecision,
      extraction,
    };
  }

  const tableRows = await executor.execute(extraction.queryPlan);

  return {
    outcome: "completed",
    routingDecision: analyticsRoutingDecision,
    queryPlan: extraction.queryPlan,
    tableRows,
  };
}
