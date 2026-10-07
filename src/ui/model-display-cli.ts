import { QwenProvider } from "../ai/qwen-provider.js";
import { config } from "../config.js";
import { DuckDBQueryPlanExecutor } from "../db/duckdb-query-plan-executor.js";
import { createModelDisplayServer } from "./model-display-server.js";

createModelDisplayServer(new QwenProvider(config.model), new DuckDBQueryPlanExecutor())
  .listen(3001, "127.0.0.1", () => {
    console.log("Interactive model display: http://127.0.0.1:3001");
  });
