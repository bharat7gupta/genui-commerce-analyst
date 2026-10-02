import { QwenProvider } from "./ai/qwen-provider.js";
import { config } from "./config.js";

const provider = new QwenProvider(config.model);
const prompt = process.argv.slice(2).join(" ") || "Summarize today's sales.";

const result = await provider.generate({
  messages: [
    {
      role: "system",
      content: "You are a concise commerce analyst.",
    },
    { role: "user", content: prompt },
  ],
});

console.log(result.text);
console.log(JSON.stringify(result.metadata, null, 2));
