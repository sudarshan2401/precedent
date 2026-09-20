import { randomUUID } from "node:crypto";
import type { ExtractionClient, GateClient, Rule } from "../types.js";
import { getAllCommitsChronological, getDiff, mineFixCommits, type MinedCommit } from "./mineFixCommits.js";

const BLOCK_THRESHOLD = 0.9;
const DUPLICATE_THRESHOLD = 0.75;

export interface BacktestCase {
  commit: MinedCommit;
  isRecurrence: boolean;
  rulesAvailableAtTime: number;
  confidence?: number;
  flagged: boolean;
  latencyMs: number;
}

export interface BacktestReport {
  cases: BacktestCase[];
  truePositives: number;
  falseNegatives: number;
  falsePositives: number;
  trueNegatives: number;
  totalRulesExtracted: number;
  fixCommitsExamined: number;
}

export async function runBacktest(opts: {
  repoPath: string;
  extraction: ExtractionClient;
  gate: GateClient;
  sampleCleanEvery?: number;
  maxCommits?: number;
}): Promise<BacktestReport> {
  const { repoPath, extraction, gate, sampleCleanEvery = 20, maxCommits } = opts;

  const fixShas = new Set(mineFixCommits(repoPath).map((c) => c.sha));
  const chronological = getAllCommitsChronological(repoPath);
  const allCommits = maxCommits ? chronological.slice(-maxCommits) : chronological;

  const rules: Rule[] = [];
  const cases: BacktestCase[] = [];

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    if (i % 25 === 0) console.log(`[precedent] ${i}/${allCommits.length} commits processed, ${rules.length} rules so far`);
    const isFix = fixShas.has(commit.sha);
    const isCleanSample = !isFix && sampleCleanEvery > 0 && i % sampleCleanEvery === 0;
    const asOfRules = rules.filter((r) => new Date(r.createdAt) < commit.timestamp);

    // Ground truth: a fix only counts as a "recurrence" if its own extracted
    // rule is a genuine semantic duplicate of an earlier, different fix's
    // rule — not just because some unrelated rule already existed by then.
    let isGenuineRecurrence = false;
    let newRuleText: string | null = null;
    if (isFix) {
      const fixDiff = getDiff(repoPath, commit.sha);
      newRuleText = await extraction.extractRule({ diff: fixDiff, message: commit.message });
      if (newRuleText && asOfRules.length > 0) {
        const dupMatches = await gate.checkDiff(newRuleText, asOfRules);
        const maxConfidence = Math.max(...dupMatches.map((m) => m.confidence));
        if (process.env.PRECEDENT_DEBUG) {
          console.log(`[precedent:debug] dup check vs ${asOfRules.length} rules, max=${maxConfidence.toFixed(2)}: "${newRuleText.slice(0, 90)}"`);
        }
        isGenuineRecurrence = dupMatches.some((m) => m.confidence >= DUPLICATE_THRESHOLD);
      }
    }

    if (isFix || isCleanSample) {
      const diffTarget = isFix ? commit.parentSha : commit.sha;
      const diff = getDiff(repoPath, diffTarget);

      const start = performance.now();
      const matches = await gate.checkDiff(diff, asOfRules);
      const latencyMs = performance.now() - start;

      const best = [...matches].sort((a, b) => b.confidence - a.confidence)[0];
      cases.push({
        commit,
        isRecurrence: isFix && isGenuineRecurrence,
        rulesAvailableAtTime: asOfRules.length,
        confidence: best?.confidence,
        flagged: (best?.confidence ?? 0) >= BLOCK_THRESHOLD,
        latencyMs,
      });
    }

    if (isFix && newRuleText) {
      rules.push({
        id: randomUUID(),
        rule: newRuleText,
        sourceRepo: repoPath,
        sourceCommit: commit.sha,
        createdAt: commit.timestamp.toISOString(),
      });
    }
  }

  return {
    cases,
    truePositives: cases.filter((c) => c.isRecurrence && c.flagged).length,
    falseNegatives: cases.filter((c) => c.isRecurrence && !c.flagged).length,
    falsePositives: cases.filter((c) => !c.isRecurrence && c.flagged).length,
    trueNegatives: cases.filter((c) => !c.isRecurrence && !c.flagged).length,
    totalRulesExtracted: rules.length,
    fixCommitsExamined: cases.filter((c) => fixShas.has(c.commit.sha)).length,
  };
}
