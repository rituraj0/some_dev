# Approach Summary

> Paste-ready summary of the approach and methodology. Full formula-level detail lives in
> [METHODOLOGY.md](METHODOLOGY.md); the complete write-up is [SUBMISSION.md](SUBMISSION.md).

---

## Short version

I analysed **15,703 pull requests** merged into `PostHog/posthog` over the 90 days ending
2026-09-26 and ranked engineers on a definition of impact that deliberately avoids counting
output:

> **Impact is how much the organisation's forward motion depends on you.**

The reasoning: anything you can count directly — commits, lines, PRs, files touched —
measures *typing*, not consequence. But a repository records something far better, which is
**how an engineer's colleagues behaved around their work**. Who did other people wait on?
Which changes did the org decide were worth arguing over? Whose absence would stall an area?
Those signals are much harder to game and much closer to what a manager means by impact. So
lines of code, commit counts and files-changed are **not inputs to any pillar**.

Engineers are scored on five pillars, each converted to a **percentile** among the 155
qualifying engineers and combined with weights **the viewer controls**:

| Pillar | Question it answers | Weight |
| --- | --- | --- |
| Shipped weight | Did their work matter? | 25% |
| Review leverage | Do they make others faster? | 25% |
| Trust centrality | Does the org route trust through them? | 15% |
| Domain ownership | What breaks if they leave? | 20% |
| Unblocking speed | How long do others wait on them? | 15% |

Because there is no single right definition, the dashboard ships four presets and shows how
much the top 5 moves between them. Under **Balanced** the top engineer is Tom Owers; under
**Force multiplier** it is Andrew Maguire. That disagreement is the honest answer, not a bug.

Three properties of the data drove the design. **54% of all 73,216 review events are bots** —
the five busiest "reviewers" in the repo are all machines, and without filtering PostHog's
most impactful engineer is an auto-approval bot. **37% of human PRs merge with no human review
at all**, so raw PR counts say very little, which is exactly why shipped weight scales with
scrutiny received. And **100% of PR titles follow conventional commits**, which supplies
product-area ownership for free across 644 areas.

The result is a single-page Next.js dashboard, statically exported, that loads in ~1.2s and
links every number back to the PR or GitHub search that reproduces it.

---

## The five pillars in detail

**1. Shipped weight — did their work matter?**
Each merged PR is weighted by the human scrutiny the organisation chose to spend on it:

```
scrutiny    = distinctHumanReviewers + 0.5 × humanReviewCount + 0.25 × min(inlineComments, 24)
consequence = typeWeight × trivialPenalty × breakingBonus × (0.25 + √scrutiny)
```

A change three engineers argued over counts far more than one a bot rubber-stamped. The
square root stops one heavily-reviewed monster PR from dominating; the `0.25` floor means an
unreviewed auto-merge still counts, but only a little. Conventional-commit type sets
`typeWeight` (`perf` 1.1, `feat`/`fix` 1.0, `chore` 0.35, `docs` 0.3), and dependency bumps
and lockfile churn are discounted to 20%.

**2. Review leverage — do they make others faster?**
Reviews given on *other people's* PRs, weighted by what the reviewer actually did:

```
value    = base[state] × (1 + 0.15 × min(inlineComments, 10))
base     = { CHANGES_REQUESTED: 1.5, COMMENTED: 1.0, APPROVED: 0.4 }
leverage = √totalReviewValue × √distinctAuthorsHelped
```

Blocking a merge or leaving inline comments counts more than a bare approval, and the
geometric form demands **both** depth and breadth — reviewing 200 PRs for one teammate scores
far below reviewing 200 across 50 teammates.

**3. Trust centrality — does the org route trust through them?**
PageRank (damping 0.85) over the directed graph where an edge runs from PR author to
reviewer, weighted by review value. You score highly by being relied on **by people who are
themselves relied on**. Unlike a review count, this cannot be inflated by spraying approvals
at low-stakes PRs.

**4. Domain ownership — what breaks if they leave?**
PostHog tags essentially every PR with a product area in the title
(`fix(data-warehouse): …`). For each area, a person's activity is their authored
`consequence` plus the value of reviews they gave there, as a share of the area's total. An
area is *load-bearing* at ≥15% share of an area with ≥10 PRs. The score is
`Σ share × log(1 + areaPrs)`, so owning a slice of a busy area beats owning a quiet corner.
This is the closest available proxy for bus-factor risk.

**5. Unblocking speed — how long do others wait?**

```
speed = √timesFirstToRespond × 24 / (24 + medianHoursToFirstReview)
```

Only each reviewer's *first* review on a PR counts, so a long back-and-forth isn't mistaken
for a slow first response. Fast first reviews compound into everyone else's cycle time.

Percentiles rather than raw values mean one extreme outlier cannot swamp a pillar, and the
weights stay comparable across pillars. A score of 100 means top-of-population on all five.

---

## Filtering automation — the step that changes the answer

In the raw data, the busiest "reviewers" in the repository are all machines:

| Reviewer | Review events | |
| --- | --- | --- |
| `stamphog` | 10,514 | auto-approval bot |
| `greptile-apps` | 7,316 | AI reviewer |
| `posthog` | 6,497 | org account used by a GitHub App |
| `veria-ai` | 3,703 | AI reviewer |
| `coderabbitai` | 3,203 | AI reviewer |
| `Gilbert09` | 2,246 | **first actual human, 6th overall** |

**39,197 of 73,216 review events (54%) came from bots.** Getting this wrong doesn't skew the
answer slightly — it produces a completely different one.

Rather than maintain a guesswork deny-list, I asked GitHub what each of the 256 distinct
accounts actually *is*:

- `type = Organization` → a GitHub App acting through an org account (`coderabbitai`,
  `chatgpt-codex-connector`, `copilot-pull-request-reviewer`, `cursor`, `posthog`)
- `404` → a GitHub App with no user account (`stamphog`, `veria-ai`, `releaser-posthog`,
  `tests-posthog`, `clickhouse-sync-posthog`)
- `type = User` → a human, unless it trips a service-account pattern (`copilot-swe-agent`,
  `greptile-apps`, `parameterai`)

That classified 23 of 256 accounts as automation with a recorded reason for each, caught
several a name-based filter would have missed, and left none ambiguous. The full exclusion
list is visible in the dashboard.

## Honest handling of the volume outlier

The top author merged **2,454 PRs in 90 days** — 17.5% of every human PR in the repo, about
27 a day. The figure is real (it matches GitHub's search API exactly), but it reflects an
agent-assisted workflow rather than 8× the output of a strong engineer.

Rather than quietly suppress or uncritically reward it, the dashboard flags anyone above 5%
of repo PRs, shows median change size and scrutiny-per-PR alongside the raw count, and ships
the "Force multiplier" preset so a leader can see exactly how much the ranking depends on
volume. Under that preset the #1 engineer changes.

## Making the findings checkable

"Score: 207" with no explanation is useless to a leader, so validatability was a design goal:

- The score arithmetic is **visible on screen**: the breakdown table shows
  percentile × weight = points per pillar, summing to the composite (99.7 × 25% = 24.9, …).
- The stacked bar on each card *is* each pillar's share of the score — the visual and the
  arithmetic are the same object.
- Every headline number links to the PR or the GitHub search that reproduces it.
- Totals match GitHub's own search API exactly, including the repo-wide count:

| Scope | This analysis | GitHub search |
| --- | --- | --- |
| **Whole repo, 90 days** | **15,703** | **15,703** |
| `author:Gilbert09` | 2,454 | 2,454 |
| `author:webjunkie` | 420 | 420 |
| `author:rnegron` | 334 | 334 |
| `author:andrewm4894` | 270 | 270 |

## Data pipeline

```
GitHub GraphQL ──> .cache/prs.ndjson ──> app/data/metrics.json ──> static Next.js page
  90 daily shards     15,703 PRs            aggregates only         no runtime API calls
```

GitHub's search API caps any query at 1,000 results and PostHog merges ~175 PRs/day, so the
pull runs as 90 one-day shards. File paths are deliberately *not* fetched — the
conventional-commit scope in the title supplies product area at roughly a quarter of the
GraphQL cost, which is what makes a full 90-day pull finish in ~12 minutes.

Metrics are precomputed into a 297 KB JSON that is committed, so the production build needs
no token, no secrets and makes no API calls. The page loads in ~1.2s (102 KB shared JS, no
chart library — the bars are divs), and re-weighting happens client-side from the stored
percentiles. Verified with Playwright at 1280×800, 1440×900 and 1728×1080: no page-level
scroll, no console errors.

## What this deliberately does not measure

- **Work outside this repo:** design, incident response, RFCs, on-call, mentoring in Slack,
  hiring, and PostHog's ~380 other repositories.
- **Review quality:** inline-comment counts are a proxy for substance; one sentence that
  redirects a project scores below ten nitpicks.
- **Durability:** only 21 of 15,703 merges were reverts (~0.1%) — far too sparse to rank
  anyone on, so it's reported as repo context rather than folded into a score.
- **Seniority and role:** a staff engineer who deliberately spends their time on review looks
  different from a strong individual shipper. That's why the weighting is adjustable rather
  than fixed.
