import type { BacktestReport } from "./backtest.js";

export function renderReport(report: BacktestReport): string {
  const { cases, truePositives, falseNegatives, falsePositives, trueNegatives, totalRulesExtracted, fixCommitsExamined } =
    report;

  const recurrenceCases = cases.filter((c) => c.isRecurrence);
  const recall = recurrenceCases.length ? truePositives / recurrenceCases.length : 0;

  const cleanTotal = falsePositives + trueNegatives;
  const falsePositiveRate = cleanTotal > 0 ? falsePositives / cleanTotal : 0;

  const latencies = cases.map((c) => c.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const naiveSequentialMs = totalRulesExtracted * 300;
  const naiveSequentialCost = totalRulesExtracted * 0.002;

  return `# Precedent recurrence backtest

- Fix commits examined: ${fixCommitsExamined}
- Of those, genuine recurrences of an earlier, different fix's rule (semantic duplicate check, not just "some rule existed"): ${recurrenceCases.length}
- Clean commits sampled as controls: ${cases.length - fixCommitsExamined}
- Rules extracted over the full backtest: ${totalRulesExtracted}

## Recall (of genuine recurrences only — first-time bugs have no precedent to catch and are excluded)
- Caught: ${truePositives}/${recurrenceCases.length} (${(recall * 100).toFixed(1)}%)
- Missed: ${falseNegatives}

## Precision / noise
- False positives on clean commits: ${falsePositives}/${cleanTotal} (${(falsePositiveRate * 100).toFixed(1)}%)

## Latency (single Jev fan-out call, regardless of rule count)
- p50: ${p50.toFixed(0)}ms
- p95: ${p95.toFixed(0)}ms

## vs. naive sequential per-rule LLM baseline (at final rule count = ${totalRulesExtracted})
- Naive: ~${naiveSequentialMs.toFixed(0)}ms, ~$${naiveSequentialCost.toFixed(3)} per commit check
- Jev fan-out: ~${p50.toFixed(0)}ms, ~$0 per commit check (input-only pricing, $0.042/M tokens)
`;
}
