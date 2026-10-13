import { COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT, comparePeriodsV2ToolDefinition } from "./compare-periods-agent-v2-prompt.js";
import { compareRegionToolDefinition } from "../tools/compare-periods.js";
import { getMetricDefinitionToolDefinition } from "../tools/get-metric-definition.js";

export const COMPARISON_AGENT_V3_PROMPT_VERSION = "comparison-agent-v3" as const;
export const COMPARISON_AGENT_V3_TOOLS = Object.freeze([comparePeriodsV2ToolDefinition, compareRegionToolDefinition, getMetricDefinitionToolDefinition]);
export const COMPARISON_AGENT_V3_TOOL_VERSIONS = Object.freeze({
  compare_periods: "compare-periods-tool-definition-v2",
  compare_net_revenue_by_region: "compare-net-revenue-by-region-tool-v1",
  get_metric_definition: "metric-definition-with-source-v1",
});
export const COMPARISON_AGENT_V3_SYSTEM_PROMPT = `${COMPARE_PERIODS_AGENT_V2_SYSTEM_PROMPT}
Additional read-only capabilities: compare_net_revenue_by_region returns regional comparisons; get_metric_definition returns an authoritative definition with sourceId and sourceVersion. Select tools as needed to obtain the evidence requested by the user; no tool order is prescribed. Cite the observed definition sourceId when using its definition. Regional contributions describe changes, not established business causes. Report missing evidence instead of inventing it.`;
