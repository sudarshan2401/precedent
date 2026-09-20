import Anthropic from "@anthropic-ai/sdk";

export interface ReintroductionCase {
  positive: string;
  negative: string;
}

export interface ReintroductionGenerator {
  generate(rule: string, originalDiff: string): Promise<ReintroductionCase | null>;
}

const PROMPT = `You are constructing a test case for a bug-recurrence detector.

Given a rule distilled from a real historical bug fix, and the original diff it came from, produce two short, realistic code snippets (10-25 lines each) in a DIFFERENT file, feature, and domain than the original — different function/variable names, different surrounding context:

1. "positive": a new snippet that genuinely reintroduces the same underlying mistake described by the rule, in a plausible unrelated feature.
2. "negative": a superficially similar snippet (same domain/vocabulary as "positive") that does NOT actually violate the rule — a near-miss meant to test whether a detector is discriminating on meaning rather than keyword overlap.

Respond with ONLY a JSON object: {"positive": "...", "negative": "..."}`;

export class AnthropicReintroductionGenerator implements ReintroductionGenerator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(rule: string, originalDiff: string): Promise<ReintroductionCase | null> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `${PROMPT}\n\nRule: ${rule}\n\nOriginal diff:\n${originalDiff.slice(0, 4000)}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.positive !== "string" || typeof parsed.negative !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
