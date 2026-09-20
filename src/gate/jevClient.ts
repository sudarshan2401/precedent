import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { GateClient, Rule, RuleMatch } from "../types.js";

export class JevGateClient implements GateClient {
  private client: TypeSafeClient;

  constructor(apiKey: string) {
    this.client = new TypeSafeClient({ apiKey });
  }

  async checkDiff(diff: string, rules: Rule[]): Promise<RuleMatch[]> {
    if (rules.length === 0) return [];

    const questions = Object.fromEntries(
      rules.map((r) => [r.id, noul(`This diff violates the rule: "${r.rule}"`)]),
    );

    const response = await this.client.systemOne({
      state: { diff: diff.slice(0, 20_000) },
      questions,
    });

    return rules.map((r) => ({
      ruleId: r.id,
      rule: r.rule,
      sourceCommit: r.sourceCommit,
      confidence: response.answers[r.id].noul,
    }));
  }
}

export class MockGateClient implements GateClient {
  async checkDiff(diff: string, rules: Rule[]): Promise<RuleMatch[]> {
    return rules.map((r) => {
      const keyword = r.rule.match(/"([^"]+)"/)?.[1] ?? "";
      const confidence = keyword && diff.includes(keyword) ? 0.95 : 0.05;
      return { ruleId: r.id, rule: r.rule, sourceCommit: r.sourceCommit, confidence };
    });
  }
}
