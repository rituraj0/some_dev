# PostHog Developer Analysis — Engineering Impact Dashboard

**Dashboard URL:** _(pending deploy — see [Deploying](#deploying))_
**Repository:** https://github.com/rituraj0/some_dev
**Time taken:** ~55 minutes
**Stack:** Next.js 15 static export, Tailwind v4, deployed on Netlify

---

## The question

> Who are the most impactful engineers at PostHog?

Over the 90 days ending 2026-09-26, across **15,703 pull requests** merged into
`PostHog/posthog`.

## How I defined impact

> Impact is how much the organisation's forward motion depends on you.

The reasoning: anything you can count directly — commits, lines, PRs, files touched —
measures *typing*, not consequence. But a codebase records something much better, which is
**how an engineer's colleagues behaved around their work**. Who did other people wait on?
Whose changes did the org decide were worth arguing over? Whose absence would stall an
area? Those signals are much harder to game and much closer to what a manager actually
means by impact.

So lines of code, commit counts and files-changed are **not inputs to any pillar**.

### The five pillars

| Pillar | Question it answers | Weight |
| --- | --- | --- |
| Shipped weight | Did their work matter? | 25% |
| Review leverage | Do they make others faster? | 25% |
| Trust centrality | Does the org route trust through them? | 15% |
| Domain ownership | What breaks if they leave? | 20% |
| Unblocking speed | How long do others wait on them? | 15% |

**Shipped weight** — each merged PR is weighted by the human scrutiny the organisation
chose to spend on it (distinct reviewers, review rounds, inline comments), square-rooted so
one monster PR can't dominate. A change three engineers argued over counts far more than
one a bot rubber-stamped; dependency bumps and chores are discounted to 20%.

**Review leverage** — reviews given on *other people's* PRs, weighted so that blocking a
merge or leaving inline comments counts more than a bare approval, then multiplied by the
number of **different** engineers unblocked. Reviewing 200 PRs for one teammate scores far
below reviewing 200 across 50 teammates.

**Trust centrality** — PageRank over the directed who-reviews-whom graph. You score highly
by being relied on *by people who are themselves relied on*. Unlike a review count, this
can't be inflated by spraying approvals at low-stakes PRs.

**Domain ownership** — the share of each product area's activity flowing through a person,
counting both what they write and what they review. The closest available proxy for
bus-factor risk.

**Unblocking speed** — how often they were the first human to respond to someone's PR, and
their median time-to-first-review. Fast first reviews compound into everyone's cycle time.

Each pillar becomes a **percentile** among the 155 qualifying engineers, then combines using
weights **the viewer controls**. Percentiles rather than raw values mean one outlier can't
swamp a pillar and the weights stay comparable.

### Why the weights are adjustable

There is no single right definition of impact, so the dashboard ships four presets and shows
how much the answer moves between them:

- **Balanced** → the top engineer is **Tom Owers** (`@Gilbert09`)
- **Force multiplier** → the top engineer is **Andrew Maguire** (`@andrewm4894`)

That disagreement is the honest answer, not a flaw. Names that appear in every column are
robust to how you define impact; names that appear in only one are a statement about that
definition. A "sensitivity" panel shows all four top-5 lists side by side.

## Three findings in the data that changed the analysis

**1. Half of all review activity is machines.** In the raw data the busiest "reviewers" in
the repository are:

| Reviewer | Review events | |
| --- | --- | --- |
| `stamphog` | 10,514 | auto-approval bot |
| `greptile-apps` | 7,316 | AI reviewer |
| `posthog` | 6,497 | org account used by a GitHub App |
| `veria-ai` | 3,703 | AI reviewer |
| `coderabbitai` | 3,203 | AI reviewer |
| `Gilbert09` | 2,246 | **first actual human, 6th overall** |

**39,197 of 73,216 review events (54%) came from bots.** Without filtering, the most
impactful engineer at PostHog is an auto-approval bot. Rather than maintain a guesswork
deny-list, I asked GitHub what each of the 256 distinct accounts actually *is* —
`Organization` and `404` both indicate a GitHub App — and excluded 23 with a recorded reason
for each. That caught several a name-based filter would have missed
(`clickhouse-sync-posthog`, `copilot-swe-agent`, `releaser-posthog`, `tests-posthog`,
`veria-ai`). All 256 resolved; none ambiguous. The full exclusion list is visible in the
dashboard.

**2. 37% of human PRs merge with no human review at all** (5,165 of 14,036). PostHog
auto-approves a large share of merges, so a raw PR count says very little about consequence.
This is precisely why shipped weight scales with the scrutiny a change actually attracted: an
unreviewed auto-merge earns a small floor, a contested change earns much more.

**3. Volume is agent-inflated, and the dashboard says so.** The top author merged 2,454 PRs
in 90 days — 17.5% of every human PR in the repo, about 27 a day. That figure is real (it
matches GitHub's search API exactly), but it reflects an agent-assisted workflow rather than
8× the output of a strong engineer. The dashboard flags anyone above 5% of repo PRs, shows
median change size and scrutiny-per-PR as context, and ships the "Force multiplier" preset so
a leader can see exactly how much the ranking depends on volume.

A fourth property made the whole thing cheap: **100% of PostHog PR titles follow conventional
commits** and 98.6% carry an explicit scope (`fix(data-warehouse): …`) across 644 areas. That
supplies product-area ownership for free, instead of fetching file paths for 15,703 PRs — the
optimisation that let a full 90-day pull finish in ~12 minutes.

## Can the findings be validated?

That was a design goal, not an afterthought:

- Every headline number in the drilldown **links to the PR or the GitHub search that
  reproduces it**.
- The score arithmetic is visible: the breakdown table shows percentile × weight = points for
  each pillar, and they sum to the composite on screen (99.7 × 25% = 24.9, etc.).
- The stacked bar on each card is literally each pillar's share of the score, so the visual
  and the arithmetic are the same object.
- Totals were checked against GitHub's own search API and match exactly — including the
  repo-wide count, which is the strongest available evidence that no shard was silently
  dropped:

| Scope | This analysis | GitHub search |
| --- | --- | --- |
| **Whole repo, 90 days** | **15,703** | **15,703** |
| `author:Gilbert09` | 2,454 | 2,454 |
| `author:webjunkie` | 420 | 420 |
| `author:rnegron` | 334 | 334 |
| `author:andrewm4894` | 270 | 270 |

## Data completeness

- **Source:** GitHub GraphQL API, every PR *merged* into `PostHog/posthog` between
  2026-06-29 and 2026-09-26 (90 days — the full window requested).
- **Sharding:** GitHub's search API caps any query at 1,000 results and PostHog merges ~175
  PRs/day, so the pull runs as 90 one-day shards. One shard (2026-07-28) failed mid-run on a
  truncated API response; the fetcher records failed days, and it was backfilled with
  `ONLY_DAYS=2026-07-28 APPEND=1` to recover the missing 210 PRs. **Zero truncated shards**
  in the final metadata, confirmed by the repo-wide total above.
- **Volume:** 15,703 merged PRs and 73,216 review events.

## Technical notes

```
GitHub GraphQL ──> .cache/prs.ndjson ──> app/data/metrics.json ──> static Next.js page
  90 daily shards     15,703 PRs            aggregates only         no runtime API calls
```

Metrics are precomputed into a 297 KB JSON that is committed, so the production build needs
**no token, no secrets and makes no API calls**. Consequences: the page loads in ~1.3s
(54 KB gzipped HTML, 102 KB shared JS), and re-weighting happens client-side from the stored
percentiles.

Verified with Playwright at 1280×800, 1440×900 and 1728×1080: **no page-level scroll at any
size** (panels scroll internally), no console errors, and the full 155-engineer roster
renders. No chart library — the bars are divs, which is why the bundle is small.

## Known limitations

- **Repo-scoped.** Only `PostHog/posthog`. Design, incident response, RFCs, on-call,
  mentoring in Slack, hiring and PostHog's ~380 other repositories are invisible here.
- **Review quality is proxied, not measured.** Inline-comment counts stand in for substance;
  one sentence that redirects a project scores below ten nitpicks.
- **Durability isn't scored.** Only 21 of 15,703 merges were reverts (~0.1%) — far too sparse
  to rank anyone on, so it's reported as repo context only.
- **Role-blind.** A staff engineer who deliberately spends their time on review looks
  different from a strong individual shipper. That's why the weighting is adjustable rather
  than fixed.

## Deploying

`netlify.toml` is committed, so Netlify needs no configuration:

1. `git push -u origin main`
2. Netlify → **Add new site → Import an existing project** → pick the repo
3. Accept the detected settings (`npm run build`, publish `out`) and deploy

No environment variables required. Then fill in the Dashboard URL at the top of this file.

## Reproducing the analysis

```bash
npm install
echo "GITHUB_TOKEN=ghp_your_classic_pat_with_public_repo" > .env.local
npm run pipeline   # fetch (~11 min) -> classify accounts -> analyze
npm run build      # static export to out/
npm run verify     # Playwright layout + console checks
```

See **[APPROACH.md](APPROACH.md)** for the condensed approach summary, and
**[METHODOLOGY.md](METHODOLOGY.md)** for every formula, threshold and constant.
