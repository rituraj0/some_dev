# PostHog Engineering Impact Dashboard

Who are PostHog's most impactful engineers? A single-page, interactive answer built from
**15,703 pull requests** merged into [`PostHog/posthog`](https://github.com/PostHog/posthog)
over the 90 days ending 2026-09-26.

## The idea

> Impact is how much the organisation's forward motion depends on you.

That is observable in **how colleagues behave around** an engineer's work. Commit counts,
lines of code and files-changed are deliberately not inputs to any pillar — they measure
typing, not consequence.

Engineers are scored on five pillars, each reduced to a percentile within the 155
qualifying engineers and combined with weights **the viewer controls**:

| Pillar | Question it answers |
| --- | --- |
| Shipped weight | Did their work matter? Merged PRs weighted by the human scrutiny each drew. |
| Review leverage | Do they make others faster? Substantive reviews × distinct people unblocked. |
| Trust centrality | Does the org route trust through them? PageRank on the review graph. |
| Domain ownership | What breaks if they leave? Share of each product area flowing through them. |
| Unblocking speed | How long do others wait? How often and how fast they respond first. |

Because there is no single right definition, the dashboard ships four presets — Balanced,
Pure shipper, Force multiplier, Domain owner — and shows how much the top 5 changes between
them. Under "Balanced" the answer is Tom Owers; under "Force multiplier" it is Andrew
Maguire. That disagreement is the point.

- **[APPROACH.md](APPROACH.md)** — approach summary: the definition, the five pillars and
  the reasoning, in one read.
- **[METHODOLOGY.md](METHODOLOGY.md)** — every formula, threshold and constant.
- **[SUBMISSION.md](SUBMISSION.md)** — the full PostHog developer analysis write-up.

## Two findings that shaped the model

1. **54% of all 73,216 review events are bots.** The five busiest "reviewers" in the repo
   are `stamphog`, `greptile-apps`, `posthog`, `veria-ai` and `coderabbitai` — the first
   human doesn't appear until 6th. Without filtering, PostHog's most impactful engineer is
   an auto-approval bot. Rather than guess from names, `scripts/accounts.mjs` asks GitHub
   what each of the 256 distinct accounts *is* (App / Organization / User) and excluded 23
   with a recorded reason for each.
2. **37% of human PRs merge with no human review at all.** So a raw PR count says very
   little. This is why shipped weight scales with the scrutiny a change actually attracted.

A third property made the analysis cheap: **100% of PostHog PR titles follow conventional
commits** and 98.6% carry an explicit scope (`fix(data-warehouse): …`) across 644 areas.
That supplies product-area ownership without fetching file paths for 15,703 PRs.

## Running it

```bash
npm install

echo "GITHUB_TOKEN=ghp_your_classic_pat_with_public_repo" > .env.local

npm run pipeline   # fetch (~12 min) -> classify accounts -> analyze
npm run dev        # http://localhost:3000
npm run build      # static export to out/
npm run verify     # Playwright: no page scroll at laptop sizes, no console errors
```

The pipeline steps can also be run individually (`npm run fetch`, `npm run accounts`,
`npm run analyze`). If a daily shard fails, backfill just that day rather than re-pulling
everything:

```bash
ONLY_DAYS=2026-07-28 APPEND=1 npm run fetch
```

`app/data/metrics.json` (~297 KB) is committed, so **the build needs no token and makes no
API calls**.

### Verifying the numbers

Every figure in the drilldown links back to the PR or the GitHub search that reproduces it.
Totals match GitHub's own search API exactly — both the repo-wide count of 15,703 merged
PRs and per-author figures such as
[`author:Gilbert09`](https://github.com/PostHog/posthog/pulls?q=is%3Apr+is%3Amerged+author%3AGilbert09+merged%3A2026-06-29..2026-09-26)
returning 2,454.

## Architecture

```
GitHub GraphQL ──> .cache/prs.ndjson ──> app/data/metrics.json ──> static Next.js page
  90 daily shards     15,703 PRs            aggregates only         no runtime API calls
```

| Path | Role |
| --- | --- |
| `scripts/fetch.mjs` | Day-sharded GraphQL pull of merged PRs + review metadata |
| `scripts/accounts.mjs` | Resolves logins to human/automation via the GitHub users API |
| `scripts/analyze.mjs` | Bot filtering, five pillars, percentiles, PageRank, area ownership |
| `scripts/shot.mjs` | Playwright check: no page scroll at laptop sizes, no console errors |
| `app/lib/model.ts` | Pillar definitions and the client-side re-weighting |
| `app/components/` | Dashboard shell, ranked cards, drilldown, weights, roster, methodology |

Next.js 15 with `output: 'export'`, Tailwind v4, no chart library (the bars are the
arithmetic, rendered as divs). 102 KB of shared JS; the page never scrolls at 1280×800 or
above, with panels scrolling internally.

## Deploying to Netlify

`netlify.toml` is committed, so Netlify needs no configuration:

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Accept the detected settings (`npm run build`, publish `out`) and deploy.

No environment variables are required.
