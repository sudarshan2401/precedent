import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionClient } from "../types.js";

const EXTRACTION_PROMPT = `You turn a bug fix into a general rule someone could check for BEFORE writing similar code again.

Read the diff, commit message, and any issue text below. If this is a genuine bug fix, respond with ONE sentence stating the underlying mistake as a general, checkable rule (not specific to these exact variable/file names). If this is not a bug fix (e.g. a feature, refactor, or docs change), respond with exactly: NONE

Rule format: "Don't <the mistake>, it caused <brief consequence>."`;

export class AnthropicExtractionClient implements ExtractionClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractRule(input: { diff: string; message: string; issueText?: string }): Promise<string | null> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\nCommit message: ${input.message}\n\nIssue text: ${input.issueText ?? "(none)"}\n\nDiff:\n${input.diff.slice(0, 8000)}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text.trim() ?? "NONE";
    return text === "NONE" ? null : text;
  }
}

export class MockExtractionClient implements ExtractionClient {
  async extractRule(input: { diff: string; message: string }): Promise<string | null> {
    if (!/fix/i.test(input.message)) return null;
    return `Don't repeat the mistake fixed in "${input.message.slice(0, 80)}".`;
  }
}
