import { readFileSync } from "node:fs";

export interface ApacheJitRecord {
  repo: string;
  commitSha: string;
  isBugInducing: boolean;
  fixCommitSha?: string;
}

/**
 * Loader for the ApacheJIT / JIT-Defects4J commit-level datasets, used as the
 * labeled ground truth for the published recurrence backtest instead of
 * ad-hoc commit-message mining. Download from:
 *   https://github.com/hosseinkshvrz/ApacheJIT
 * Expected CSV columns: repo,commit_hash,is_bug_inducing,fix_commit_hash
 */
export function loadApacheJit(csvPath: string): ApacheJitRecord[] {
  const lines = readFileSync(csvPath, "utf-8").split("\n").filter(Boolean);
  const [header, ...rows] = lines;
  const cols = header.split(",");
  const idx = (name: string) => cols.indexOf(name);

  return rows.map((row) => {
    const cells = row.split(",");
    return {
      repo: cells[idx("repo")],
      commitSha: cells[idx("commit_hash")],
      isBugInducing: cells[idx("is_bug_inducing")] === "true" || cells[idx("is_bug_inducing")] === "1",
      fixCommitSha: cells[idx("fix_commit_hash")] || undefined,
    };
  });
}
