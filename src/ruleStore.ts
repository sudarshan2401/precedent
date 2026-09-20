import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Rule } from "./types.js";

export function loadRules(path: string, asOf?: Date): Rule[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const rules = lines.map((line) => JSON.parse(line) as Rule);
  if (!asOf) return rules;
  return rules.filter((r) => new Date(r.createdAt) <= asOf);
}

export function appendRule(path: string, rule: Rule): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(rule) + "\n", "utf-8");
}
