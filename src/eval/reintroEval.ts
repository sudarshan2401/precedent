import { randomUUID } from "node:crypto";
import { AnthropicExtractionClient, MockExtractionClient } from "../extract/llmClient.js";
import { JevGateClient, MockGateClient } from "../gate/jevClient.js";
import { getDiff, mineFixCommits } from "./mineFixCommits.js";
import { AnthropicReintroductionGenerator } from "./reintroductionGenerator.js";
import type { ExtractionClient, GateClient, Rule } from "../types.js";

const BLOCK_THRESHOLD = 0.9;
const WARN_THRESHOLD = 0.6;

interface SeedRule extends Rule {
  originalDiff: string;
}

async function main() {
  const repoPath = process.argv[2];
  const maxFixCommits = process.argv[3] ? Number(process.argv[3]) : 30;
  const sampleSize = process.argv[4] ? Number(process.argv[4]) : 15;
  if (!repoPath) {
    console.error("Usage: npm run eval:reintro -- <repoPath> [maxFixCommits] [sampleSize]");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required to generate reintroduction cases.");
    process.exit(1);
  }

  const extraction: ExtractionClient = new AnthropicExtractionClient(process.env.ANTHROPIC_API_KEY);
  const generator = new AnthropicReintroductionGenerator(process.env.ANTHROPIC_API_KEY);
  const gate: GateClient = process.env.JEV_API_KEY
    ? new JevGateClient(process.env.JEV_API_KEY)
    : new MockGateClient();
  if (!process.env.JEV_API_KEY) {
    console.log("[precedent] No JEV_API_KEY — gating with the mock client.\n");
  }

  const fixCommits = mineFixCommits(repoPath).slice(-maxFixCommits);
  console.log(`[precedent] Extracting rules from ${fixCommits.length} fix commits...`);

  const rules: SeedRule[] = [];
  for (const commit of fixCommits) {
    const diff = getDiff(repoPath, commit.sha);
    const rule = await extraction.extractRule({ diff, message: commit.message });
    if (rule) {
      rules.push({
        id: randomUUID(),
        rule,
        sourceRepo: repoPath,
        sourceCommit: commit.sha,
        createdAt: commit.timestamp.toISOString(),
        originalDiff: diff,
      });
    }
  }
  console.log(`[precedent] ${rules.length} rules extracted into the store.`);

  const sampled = [...rules].sort(() => Math.random() - 0.5).slice(0, Math.min(sampleSize, rules.length));
  console.log(`[precedent] Generating reintroduction cases for ${sampled.length} sampled rules...\n`);

  let caught = 0;
  let blocked = 0;
  let falsePositives = 0;
  const latencies: number[] = [];
  const lines: string[] = [];

  for (const rule of sampled) {
    const testCase = await generator.generate(rule.rule, rule.originalDiff);
    if (!testCase) continue;

    const posStart = performance.now();
    const posMatches = await gate.checkDiff(testCase.positive, rules);
    latencies.push(performance.now() - posStart);
    const posBest = Math.max(0, ...posMatches.map((m) => m.confidence));

    const negStart = performance.now();
    const negMatches = await gate.checkDiff(testCase.negative, rules);
    latencies.push(performance.now() - negStart);
    const negBest = Math.max(0, ...negMatches.map((m) => m.confidence));

    if (posBest >= WARN_THRESHOLD) caught++;
    if (posBest >= BLOCK_THRESHOLD) blocked++;
    if (negBest >= WARN_THRESHOLD) falsePositives++;

    lines.push(
      `${posBest >= BLOCK_THRESHOLD ? "BLOCK" : posBest >= WARN_THRESHOLD ? "WARN " : "MISS "} pos=${posBest.toFixed(2)}  ${negBest >= WARN_THRESHOLD ? "FALSE-POS" : "clean    "} neg=${negBest.toFixed(2)}  — ${rule.rule.slice(0, 70)}`,
    );
  }

  const total = lines.length;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  console.log(`# Precedent reintroduction test`);
  console.log(`${total} cases, each seeded from a real historical fix, checked against the full ${rules.length}-rule store\n`);
  console.log(lines.join("\n"));
  console.log(`\nCaught (WARN or BLOCK): ${caught}/${total} (${((caught / total) * 100).toFixed(1)}%)`);
  console.log(`  of which BLOCK-level (>=${BLOCK_THRESHOLD}): ${blocked}/${total}`);
  console.log(`False positives on near-miss negatives: ${falsePositives}/${total} (${((falsePositives / total) * 100).toFixed(1)}%)`);
  console.log(`Latency p50: ${p50.toFixed(0)}ms, p95: ${p95.toFixed(0)}ms`);
}

main().catch((err) => {
  console.error("[precedent] reintroduction eval failed:", err);
  process.exit(1);
});
