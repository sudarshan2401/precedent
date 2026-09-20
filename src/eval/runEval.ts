import { AnthropicExtractionClient, MockExtractionClient } from "../extract/llmClient.js";
import { JevGateClient, MockGateClient } from "../gate/jevClient.js";
import type { ExtractionClient, GateClient } from "../types.js";
import { runBacktest } from "./backtest.js";
import { renderReport } from "./report.js";

async function main() {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: npm run eval -- <path-to-local-git-repo>");
    process.exit(1);
  }

  const extraction: ExtractionClient = process.env.ANTHROPIC_API_KEY
    ? new AnthropicExtractionClient(process.env.ANTHROPIC_API_KEY)
    : new MockExtractionClient();
  const gate: GateClient = process.env.JEV_API_KEY
    ? new JevGateClient(process.env.JEV_API_KEY)
    : new MockGateClient();

  if (!process.env.ANTHROPIC_API_KEY || !process.env.JEV_API_KEY) {
    console.log("[precedent] Running in mock mode — set ANTHROPIC_API_KEY and JEV_API_KEY for real numbers.\n");
  }

  const report = await runBacktest({ repoPath, extraction, gate });
  console.log(renderReport(report));
}

main().catch((err) => {
  console.error("[precedent] eval failed:", err);
  process.exit(1);
});
