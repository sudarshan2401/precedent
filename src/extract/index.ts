import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AnthropicExtractionClient, MockExtractionClient } from "./llmClient.js";
import { appendRule } from "../ruleStore.js";
import type { ExtractionClient } from "../types.js";

const RULES_PATH = ".lessons/rules.jsonl";

function isFixCommit(message: string): boolean {
  return /^fix(\(.+\))?:/i.test(message) || /\bcloses?\s+#\d+/i.test(message) || /\bfix(es|ed)?\b/i.test(message);
}

async function main() {
  const commitSha = process.argv[2] ?? "HEAD";
  const message = execSync(`git log -1 --pretty=%B ${commitSha}`, { encoding: "utf-8" }).trim();

  if (!isFixCommit(message)) {
    console.log(`[precedent] "${message.split("\n")[0]}" doesn't look like a fix, skipping extraction.`);
    return;
  }

  const diff = execSync(`git show ${commitSha}`, { encoding: "utf-8", maxBuffer: 10_000_000 });
  const client: ExtractionClient = process.env.ANTHROPIC_API_KEY
    ? new AnthropicExtractionClient(process.env.ANTHROPIC_API_KEY)
    : new MockExtractionClient();

  const rule = await client.extractRule({ diff, message });
  if (!rule) {
    console.log("[precedent] Extractor decided this wasn't a genuine bug fix. No rule added.");
    return;
  }

  let repo = "local";
  try {
    repo = execSync("git config --get remote.origin.url", { encoding: "utf-8" }).trim() || "local";
  } catch {
    // no remote configured
  }
  appendRule(RULES_PATH, {
    id: randomUUID(),
    rule,
    sourceRepo: repo,
    sourceCommit: commitSha === "HEAD" ? execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim() : commitSha,
    createdAt: new Date().toISOString(),
  });

  console.log(`[precedent] Added rule: ${rule}`);
}

main().catch((err) => {
  console.error("[precedent] extraction failed:", err);
  process.exit(1);
});
