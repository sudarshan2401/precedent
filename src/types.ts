export interface Rule {
  id: string;
  rule: string;
  sourceRepo: string;
  sourceCommit: string;
  createdAt: string;
}

export interface RuleMatch {
  ruleId: string;
  rule: string;
  confidence: number;
  sourceCommit: string;
}

export type GateVerdict = "block" | "warn" | "pass";

export interface GateResult {
  verdict: GateVerdict;
  matches: RuleMatch[];
  latencyMs: number;
}

export interface ExtractionClient {
  extractRule(input: {
    diff: string;
    message: string;
    issueText?: string;
  }): Promise<string | null>;
}

export interface GateClient {
  checkDiff(diff: string, rules: Rule[]): Promise<RuleMatch[]>;
}
