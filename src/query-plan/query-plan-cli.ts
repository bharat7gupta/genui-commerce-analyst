import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { extractQueryPlan } from "./query-plan-extraction.js";

const question = process.argv.slice(2).join(" ").trim();

if (question.length === 0) {
  console.error(
    'Usage: npm run query-plan:extract -- "What was total gross revenue?"',
  );
  process.exitCode = 1;
} else {
  const provider: ModelProvider = new QwenProvider(config.model);
  const result = await extractQueryPlan(provider, question);

  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        configuredModel: config.model.model,
        reasoningEffort: config.model.reasoningEffort,
        question,
        ...result,
      },
      null,
      2,
    ),
  );

  if (
    result.outcome === "provider_error" ||
    result.outcome === "refusal" ||
    result.outcome === "incomplete" ||
    result.outcome === "malformed_json" ||
    result.outcome === "structural_validation_failure" ||
    result.outcome === "business_rule_failure"
  ) {
    process.exitCode = 1;
  }
}
