import type { ModelProvider } from "../ai/provider.js";
import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";

const SMOKE_PROMPT = "Reply with exactly: LOCAL_MODEL_OK";

const provider: ModelProvider = new QwenProvider(config.model);

try {
  const result = await provider.generate({
    messages: [{ role: "user", content: SMOKE_PROMPT }],
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Smoke experiment failed: ${message}`);
  process.exitCode = 1;
}
