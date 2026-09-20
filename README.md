# precedent

Every merged bug fix becomes a rule. Every local commit is checked against
all of them, in one round trip, before it ever leaves your machine.

## Why

Teams keep making the same mistake in different files months apart because
the lesson from the first fix lived in a closed PR, not in anything that
runs at the moment someone writes similar code again. The usual fix —
"have an LLM review every commit" — doesn't hold up in practice: calling a
general-purpose model once per rule, on every commit, is too slow and too
costly to sit in the local commit path, so real review gets pushed to CI or
skipped. [Jev](https://typesafe.ai), TypeSafe AI's System-1 model, returns a
calibrated probability per typed question in one parallel round trip at
~$0.042/M input tokens and free output — cheap and fast enough to check a
diff against hundreds of accumulated rules synchronously, locally, on every
`git commit`.

## How it works

**1. Extraction (async, at merge time — can afford to be slow and careful)**

A CI step runs on every merged commit that looks like a fix (`fix:` prefix,
closed issue, red-to-green test). It sends the diff and issue context to a
general-purpose LLM and asks for the underlying mistake stated as a general,
checkable rule. The rule is appended to `.lessons/rules.jsonl`, a
version-controlled, append-only log.

**2. The gate (synchronous, on every local commit — must be instant)**

A pre-commit hook (`.husky/pre-commit`) sends the staged diff to Jev with
one `Noul` (yes/no-as-probability) question per accumulated rule, all in a
single request. Confidence ≥ 0.9 blocks the commit and names the source fix;
0.6–0.9 warns; below that, silence.

```
src/extract/   — merge-time rule extraction (Anthropic-backed, mock fallback)
src/gate/      — commit-time gate (Jev-backed, mock fallback)
src/eval/      — recurrence backtest + reintroduction test harnesses
.lessons/      — the growing rule store
.github/workflows/
  extract-on-merge.yml — runs extraction on every push to main, commits new rules back
  gate-on-pr.yml        — runs the gate on the PR diff, as a backstop for anyone who skips the local hook
```

## As an actual pipeline, not just local scripts

`.husky/pre-commit` is the fast path — it's meant to catch things before they're
even pushed. Two GitHub Actions workflows make the other two ends real:

- **`extract-on-merge.yml`** — on every push to `main`, runs `npm run extract`;
  if the commit was a fix, it commits the new rule straight back into
  `.lessons/rules.jsonl` (as `precedent-bot`), so the rule store grows on its
  own with zero manual curation.
- **`gate-on-pr.yml`** — runs the same gate against the full PR diff (vs. the
  base branch) as a required check, so a contributor who commits with
  `--no-verify` or from a machine without the local hook installed still gets
  caught before merge.

Both need `ANTHROPIC_API_KEY` / `JEV_API_KEY` set as repo secrets.

## Worked example (real API calls, in this repo's own history)

`src/demo/orderService.ts` shipped a bug (duplicate emails on webhook retry),
got fixed, and `npm run extract` turned it into: *"Don't process webhook
events without checking for prior execution/idempotency, it caused
duplicate order confirmation emails on retries."* `src/demo/shipmentService.ts`
is a later, unrelated file — SMS instead of email, "carrier webhook" instead
of "order confirmation" — with the same underlying flaw. The real Jev gate
flagged it at 76% confidence as a WARN, in about a second, having never seen
this file before. That's the semantic-recurrence claim, demonstrated live
rather than asserted.

## Running it

```bash
npm install
export ANTHROPIC_API_KEY=...   # extraction; omitted = mock extractor
export JEV_API_KEY=...         # gating; omitted = mock gate

npm run extract              # extract a rule from HEAD if it's a fix
npm run gate                 # check the currently staged diff
npm run eval -- /path/to/some/local/repo
```

Without API keys, everything still runs end-to-end against mock clients —
useful for verifying the mechanism, not for real numbers.

## The eval

No existing benchmark measures this specific thing. Just-in-time defect
prediction datasets (ApacheJIT, JIT-Defects4J) label whether a commit is
generically bug-prone; none test whether a rule extracted from an *earlier*
fix would catch a *later, different* commit making the same underlying
mistake — which is the actual claim this tool makes. There are two harnesses,
because the organic backtest turned up a real, interesting negative result.

### 1. Organic walk-forward backtest (`npm run eval -- <repo> [maxCommits]`)

Zero synthetic data: mines every fix commit in a repo's real history
chronologically, extracts a rule from each *as of its own timestamp only*
(later commits never see rules that didn't exist yet), and checks every
bug-inducing commit and a sample of clean commits against only the rules
that existed at that point in time.

Run against 400 commits of `zod` and 200 of `axios` (real, both real API
calls), this found **zero genuine semantic duplicates** among 130+ extracted
rules in each repo — literal recurrence of the same root cause essentially
never happens within a few hundred commits of a well-maintained project.
That's a real finding, not a bug in the tool (verified by feeding the
duplicate-detection call an obviously-similar synthetic pair in isolation,
which correctly scored 0.94). What this harness *does* give real numbers
for: false-positive rate on clean commits (0% across ~220 sampled), and
latency/cost vs. a naive sequential per-rule LLM baseline at real rule-store
sizes (~380ms/~$0 vs. 10-40s/$0.06-$0.26 at 70-130 rules).

### 2. Reintroduction test (`npm run eval:reintro -- <repo> [maxFixCommits] [sampleSize]`)

Since organic recurrence is rare, this measures the thing that actually
matters going forward: seeded from N *real* historical fixes, an LLM
constructs a plausible reintroduction of each one's underlying mistake in a
different file/feature/domain (same method as the worked example above,
automated), plus a near-miss negative that's superficially similar but
doesn't actually violate the rule. Each gets checked against the full
accumulated rule store for real.

Run against 40 real fix commits from `axios` (36 extracted rules), sampling
15 for reintroduction:

- **Caught (WARN or BLOCK): 13/14 (92.9%)**, 7 of those at BLOCK-level
  confidence (≥0.9)
- **False positives on near-miss negatives: 1/14 (7.1%)** — and that one
  only reached WARN (0.74), never BLOCK
- **Latency: p50 960ms, p95 1048ms** against the real 36-rule store

One genuine miss is disclosed rather than dropped: a synchronous
request-interceptor control-flow bug scored only 0.53 — a real limit of the
approach on subtler control-flow mistakes vs. the more common "missing a
check before doing X" pattern.

For a fuller academic version of harness 1, swap `mineFixCommits` for
`src/eval/apacheJitLoader.ts`, which loads the labeled ApacheJIT /
JIT-Defects4J commit data instead of commit-message heuristics.
