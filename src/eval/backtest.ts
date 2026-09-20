import { randomUUID } from "node:crypto";
import type { ExtractionClient, GateClient, Rule } from "../types.js";
import { getAllCommitsChronological, getDiff, mineFixCommits, type MinedCommit } from "./mineFixCommits.js";

const BLOCK_THRESHOLD = 0.9;

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
}

export async function runBacktest(opts: {
  repoPath: string;
  extraction: ExtractionClient;
  gate: GateClient;
  sampleCleanEvery?: number;
}): Promise<BacktestReport> {
  const { repoPath, extraction, gate, sampleCleanEvery = 20 } = opts;

  const fixShas = new Set(mineFixCommits(repoPath).map((c) => c.sha));
  const allCommits = getAllCommitsChronological(repoPath);

  const rules: Rule[] = [];
  const cases: BacktestCase[] = [];

  for (let i = 0; i < allCommits.length; i++) {
    const commit = allCommits[i];
    const isFix = fixShas.has(commit.sha);
    const isCleanSample = !isFix && sampleCleanEvery > 0 && i % sampleCleanEvery === 0;

    if (isFix || isCleanSample) {
      const asOfRules = rules.filter((r) => new Date(r.createdAt) < commit.timestamp);
      const diffTarget = isFix ? commit.parentSha : commit.sha;
      const diff = getDiff(repoPath, diffTarget);

      const start = performance.now();
      const matches = await gate.checkDiff(diff, asOfRules);
      const latencyMs = performance.now() - start;

      const best = [...matches].sort((a, b) => b.confidence - a.confidence)[0];
      cases.push({
        commit,
        isRecurrence: isFix,
        rulesAvailableAtTime: asOfRules.length,
        confidence: best?.confidence,
        flagged: (best?.confidence ?? 0) >= BLOCK_THRESHOLD,
        latencyMs,
      });
    }

    if (isFix) {
      const diff = getDiff(repoPath, commit.sha);
      const rule = await extraction.extractRule({ diff, message: commit.message });
      if (rule) {
        rules.push({
          id: randomUUID(),
          rule,
          sourceRepo: repoPath,
          sourceCommit: commit.sha,
          createdAt: commit.timestamp.toISOString(),
        });
      }
    }
  }

  return {
    cases,
    truePositives: cases.filter((c) => c.isRecurrence && c.flagged).length,
    falseNegatives: cases.filter((c) => c.isRecurrence && !c.flagged).length,
    falsePositives: cases.filter((c) => !c.isRecurrence && c.flagged).length,
    trueNegatives: cases.filter((c) => !c.isRecurrence && !c.flagged).length,
    totalRulesExtracted: rules.length,
  };
}
