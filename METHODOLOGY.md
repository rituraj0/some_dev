# Methodology

## The definition of impact

> Impact is how much the organisation's forward motion depends on you.

That is observable in **how colleagues behave around** an engineer's work, not in how much
work there is. Commit counts, lines of code and files-changed are **not inputs to any
pillar** — they measure typing, not consequence. A 12-line change to the flags evaluator
that three senior engineers argued over matters more than a 2,000-line generated migration
nobody read.

Five pillars, each explainable in a sentence:

| Pillar | Question it answers | Default weight |
| --- | --- | --- |
| Shipped weight | Did their work matter? | 25% |
| Review leverage | Do they make others faster? | 25% |
| Trust centrality | Does the org route trust through them? | 15% |
| Domain ownership | What breaks if they leave? | 20% |
| Unblocking speed | How long do others wait on them? | 15% |

Each pillar is reduced to a **percentile** within the 155 qualifying engineers, then
combined with weights the viewer controls in the UI. Percentiles (rather than raw values)
stop a single extreme outlier from swamping a pillar and keep the weights comparable.
A score of 100 means top-of-population on all five.

### 1. Shipped weight

For each merged PR, the credit earned scales with the human scrutiny the organisation chose
to spend on it:

```
scrutiny    = distinctHumanReviewers + 0.5 * humanReviewCount + 0.25 * min(inlineComments, 24)
consequence = typeWeight * trivialPenalty * breakingBonus * (0.25 + sqrt(scrutiny))
```

- `typeWeight` comes from the conventional-commit type: `perf` 1.1, `feat`/`fix` 1.0,
  `refactor` 0.9, `test` 0.5, `ci`/`build` 0.4, `chore` 0.35, `docs` 0.3, `style` 0.25,
  `revert` 0.2.
- `trivialPenalty` is 0.2 for dependency bumps, lockfile churn and `automated`-labelled PRs.
- `breakingBonus` is 1.25 for conventional-commit breaking changes (`feat(x)!:`).
- `sqrt` stops one heavily-reviewed monster PR from dominating; the `0.25` floor means an
  unreviewed auto-merge still counts for a little, but only a little.

A person's shipped weight is the sum over their merged PRs.

### 2. Review leverage

For each review given on **someone else's** PR:

```
value = base[state] * (1 + 0.15 * min(inlineComments, 10))
base  = { CHANGES_REQUESTED: 1.5, COMMENTED: 1.0, APPROVED: 0.4, DISMISSED: 0.2 }
```

A bare approval is cheap; blocking a merge or leaving inline comments is not. The pillar
then requires both depth and breadth:

```
leverage = sqrt(totalReviewValue) * sqrt(distinctAuthorsHelped)
```

So reviewing 200 PRs for one teammate scores far below reviewing 200 PRs across 50
teammates. Self-reviews are excluded.

### 3. Trust centrality

PageRank (damping 0.85, 60 iterations) over the directed graph where an edge runs from PR
author to reviewer, weighted by the review values above. You score highly by being relied
on **by people who are themselves relied on**. Unlike a review count, this cannot be
inflated by spraying approvals at low-stakes PRs.

### 4. Domain ownership

PostHog tags essentially every PR with a product area via its title
(`fix(data-warehouse): …`) — 100% of merges follow conventional commits and 98.6% carry an
explicit scope, across 644 distinct areas. For each area, a person's activity is their
authored `consequence` plus the value of the reviews they gave in that area, as a share of
the area's total.

An area is **load-bearing** for someone at ≥15% share of an area with ≥10 PRs, provided
they authored ≥4 PRs there (or hold ≥30% share). The pillar score is
`Σ share × log(1 + areaPrs)`, so owning a slice of a busy area counts more than owning a
quiet corner.

This is the closest available proxy for bus-factor risk.

### 5. Unblocking speed

```
speed = sqrt(timesFirstToRespond) * 24 / (24 + medianHoursToFirstReview)
```

Only each reviewer's *first* review on a given PR counts, so a long back-and-forth is not
mistaken for a slow first response. Requires 5+ reviews given to qualify.

## Data collection

- **Source**: GitHub GraphQL API, every PR *merged* into `PostHog/posthog` in the 90 days
  ending 2026-09-26.
- **Sharding**: GitHub's search API caps any single query at 1,000 results and PostHog
  merges ~175 PRs/day, so the pull is sharded one day at a time — 90 shards, none
  truncated. A shard that fails can be backfilled on its own with
  `ONLY_DAYS=<date> APPEND=1 npm run fetch`; the analysis dedupes by PR number, so
  appending is always safe.
- **Volume**: 15,703 merged PRs and 73,216 review events.
- **Cost optimisation**: file paths are deliberately *not* fetched. The conventional-commit
  scope in the title supplies product area at roughly a quarter of the GraphQL point cost,
  which is what makes a full 90-day pull finish in ~12 minutes.

`scripts/fetch.mjs` → `.cache/prs.ndjson` → `scripts/accounts.mjs` → `scripts/analyze.mjs`
→ `app/data/metrics.json` (~297 KB, committed). The dashboard is a static export, so it
makes no API calls at runtime and needs no secrets to build.

## Filtering automation — the step that changes the answer

In the raw data the busiest reviewers in the repository are all machines:

| Reviewer | Review events | |
| --- | --- | --- |
| `stamphog` | 10,514 | auto-approval bot |
| `greptile-apps` | 7,316 | AI reviewer |
| `posthog` | 6,497 | org account used by an App |
| `veria-ai` | 3,703 | AI reviewer |
| `coderabbitai` | 3,203 | AI reviewer |
| `Gilbert09` | 2,246 | **first actual human, 6th overall** |

**39,197 of 73,216 review events (54%) came from bots.** Without filtering, the "most
impactful engineer at PostHog" is an auto-approval bot. (Counting reviews of *other
people's* PRs only, the busiest human reviewer is `andrewm4894` with 874.)

Rather than maintain a guesswork deny-list, `scripts/accounts.mjs` asks GitHub what each of
the 256 distinct accounts actually *is*:

- `type = Organization` → a GitHub App acting through an org account (`coderabbitai`,
  `chatgpt-codex-connector`, `copilot-pull-request-reviewer`, `cursor`, `posthog`)
- `404` → a GitHub App with no user account (`stamphog`, `releaser-posthog`,
  `tests-posthog`, `clickhouse-sync-posthog`, `veria-ai`, …)
- `type = User` → a human, unless it trips a service-account pattern
  (`copilot-swe-agent`, `greptile-apps`, `parameterai`)

That classified 23 of 256 accounts as automation, with a recorded reason for each, and
caught several that a name-based list would have missed. All 256 resolved; none were left
ambiguous. The full exclusion list is shown in the dashboard.

## Two other properties of this data worth knowing

1. **37% of human-authored PRs merge with no human review at all** (5,165 of 14,036).
   PostHog auto-approves a large share of merges, so a raw PR count says very little about
   consequence. This is exactly why shipped weight scales with scrutiny received.
2. **Volume is agent-inflated.** The top author merged 2,454 PRs in 90 days — 17.5% of every
   human PR in the repo, about 26 a day. That is real (it matches GitHub's own search count
   exactly) but it reflects an agent-assisted workflow, not 8× the output of a strong
   engineer. The dashboard flags anyone above 5% of repo PRs, shows median change size and
   scrutiny-per-PR as context, and ships a "Force multiplier" preset that de-emphasises
   volume so a leader can see how much the ranking depends on it.

## Validation

Per-author merged-PR totals were checked against GitHub's own search API and match exactly:

| Engineer | This analysis | `is:pr is:merged author:X merged:2026-06-29..2026-09-26` |
| --- | --- | --- |
| *(whole repo)* | **15,703** | **15,703** |
| `Gilbert09` | 2,454 | 2,454 |
| `webjunkie` | 420 | 420 |
| `rnegron` | 334 | 334 |
| `andrewm4894` | 270 | 270 |

The repo-wide total matching exactly is the strongest available evidence that the 90-day
coverage is complete, with no shard silently dropped. Every figure in the drilldown links to
the PR or the GitHub search that reproduces it.

## Known limitations

- **Repo-scoped.** Only `PostHog/posthog`. Work in PostHog's ~380 other repositories,
  design, incident response, RFCs, on-call, mentoring in Slack and hiring are all invisible
  here.
- **Review quality is proxied, not measured.** Inline-comment counts stand in for substance;
  one sentence that redirects a project scores below ten nitpicks.
- **Durability is not scored.** Only 21 of 15,703 merges were reverts (~0.1%) — far too
  sparse to rank people on, so it is reported as repo context only.
- **Role-blind.** A staff engineer who deliberately spends their time on review looks
  different from a strong individual shipper. That is a feature of the weighting being
  adjustable rather than something the model resolves.
- **Snapshot.** Metrics are precomputed; re-run `npm run pipeline` to refresh.
