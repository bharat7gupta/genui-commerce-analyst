import "dotenv/config";

import { z } from "zod";

const environmentSchema = z.object({
  MODEL_BASE_URL: z.url(),
  MODEL_NAME: z.string().trim().min(1),
  MODEL_API_KEY: z.string().optional(),
  MODEL_REASONING_EFFORT: z.enum([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  throw new Error(
    `Invalid environment configuration: ${z.prettifyError(parsedEnvironment.error)}`,
  );
}

export const config = {
  model: {
    baseUrl: parsedEnvironment.data.MODEL_BASE_URL.replace(/\/$/, ""),
    model: parsedEnvironment.data.MODEL_NAME,
    reasoningEffort: parsedEnvironment.data.MODEL_REASONING_EFFORT,
    ...(parsedEnvironment.data.MODEL_API_KEY
      ? { apiKey: parsedEnvironment.data.MODEL_API_KEY }
      : {}),
  },
} as const;
