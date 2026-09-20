import { execSync } from "node:child_process";

export interface MinedCommit {
  sha: string;
  parentSha: string;
  timestamp: Date;
  message: string;
}

function isFixMessage(message: string): boolean {
  return /^fix(\(.+\))?:/i.test(message) || /\bfix(es|ed)?\b/i.test(message) || /\bcloses?\s+#\d+/i.test(message);
}

function parseLog(repoPath: string): MinedCommit[] {
  const log = execSync(`git -C ${repoPath} log --all --pretty=format:%H|%P|%aI|%s`, {
    encoding: "utf-8",
    maxBuffer: 50_000_000,
  });
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, iso, ...rest] = line.split("|");
      return { sha, parentSha: parents.split(" ")[0], timestamp: new Date(iso), message: rest.join("|") };
    })
    .filter((c) => c.parentSha)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export function getAllCommitsChronological(repoPath: string): MinedCommit[] {
  return parseLog(repoPath);
}

export function mineFixCommits(repoPath: string): MinedCommit[] {
  return parseLog(repoPath).filter((c) => isFixMessage(c.message));
}

export function getDiff(repoPath: string, sha: string): string {
  return execSync(`git -C ${repoPath} show ${sha}`, { encoding: "utf-8", maxBuffer: 10_000_000 });
}
