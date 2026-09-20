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
src/eval/      — recurrence backtest harness
.lessons/      — the growing rule store
```

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
mistake — which is the actual claim this tool makes.

`npm run eval -- <repo>` runs a walk-forward backtest with zero synthetic
data:

1. Mine every fix commit in the repo's history, chronologically.
2. Walk forward through all commits. At each fix, extract its rule and add
   it to the rule set *as of that timestamp only* — later commits never see
   rules that didn't exist yet.
3. For every bug-inducing commit (the parent of a fix) and a sample of
   clean commits, check the diff against only the rules that existed at
   that point in time.
4. Report recall (split into "a prior rule existed" vs "first-time bug, no
   precedent to catch it"), false-positive rate on clean commits, and
   latency/cost vs. a naive sequential per-rule LLM baseline at the same
   final rule count.

For the published version of this benchmark, swap `mineFixCommits` for
`src/eval/apacheJitLoader.ts`, which loads the labeled ApacheJIT /
JIT-Defects4J commit data instead of commit-message heuristics — real,
peer-reviewed ground truth instead of a heuristic proxy.
