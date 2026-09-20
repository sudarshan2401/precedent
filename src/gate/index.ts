import { execSync } from "node:child_process";
import { loadRules } from "../ruleStore.js";
import { JevGateClient, MockGateClient } from "./jevClient.js";
import type { GateClient, GateResult } from "../types.js";

const RULES_PATH = ".lessons/rules.jsonl";
const BLOCK_THRESHOLD = 0.9;
const WARN_THRESHOLD = 0.6;

export async function runGate(diff: string, rulesPath = RULES_PATH): Promise<GateResult> {
  const rules = loadRules(rulesPath);
  const client: GateClient = process.env.JEV_API_KEY
    ? new JevGateClient(process.env.JEV_API_KEY)
    : new MockGateClient();

  const start = performance.now();
  const matches = await client.checkDiff(diff, rules);
  const latencyMs = performance.now() - start;

  const blocking = matches.filter((m) => m.confidence >= BLOCK_THRESHOLD);
  const warning = matches.filter((m) => m.confidence >= WARN_THRESHOLD && m.confidence < BLOCK_THRESHOLD);

  const verdict = blocking.length > 0 ? "block" : warning.length > 0 ? "warn" : "pass";
  return { verdict, matches: [...blocking, ...warning], latencyMs };
}

function getDiffToCheck(): string {
  // In a PR workflow there's nothing staged — diff against the PR's base branch instead.
  if (process.env.GITHUB_BASE_REF) {
    return execSync(`git diff origin/${process.env.GITHUB_BASE_REF}...HEAD`, {
      encoding: "utf-8",
      maxBuffer: 10_000_000,
    });
  }
  return execSync("git diff --cached", { encoding: "utf-8", maxBuffer: 10_000_000 });
}

async function main() {
  const diff = getDiffToCheck();
  if (!diff.trim()) {
    console.log("[precedent] No changes to check.");
    return;
  }

  const result = await runGate(diff);
  console.log(`[precedent] Checked against rule store in ${result.latencyMs.toFixed(0)}ms.`);

  for (const match of result.matches) {
    const tag = match.confidence >= BLOCK_THRESHOLD ? "BLOCK" : "WARN";
    console.log(`  [${tag}] (${(match.confidence * 100).toFixed(0)}%) ${match.rule}  [${match.sourceCommit.slice(0, 8)}]`);
  }

  if (result.verdict === "block") {
    console.error("[precedent] Commit blocked: this diff matches a known past mistake. Fix it or run with --no-verify to override.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[precedent] gate failed:", err);
  process.exit(1);
});
