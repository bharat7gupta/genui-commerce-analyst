import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { runMetricDefinitionToolWorkflow } from "./metric-definition-tool-workflow.js";

const question = process.argv.slice(2).join(" ").trim();

if (question.length === 0) {
  console.error(
    'Usage: npm run tool:metric-definition -- "What does net revenue mean?"',
  );
  process.exitCode = 1;
} else {
  const provider: ModelProvider = new QwenProvider(config.model);
  const result = await runMetricDefinitionToolWorkflow(provider, question);

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

  if (result.outcome !== "answer") {
    process.exitCode = 1;
  }
}
