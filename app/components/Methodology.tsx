'use client';

import { PILLARS, fmtNum, type Metrics } from '../lib/model';

export default function Methodology({ data, onClose }: { data: Metrics; onClose: () => void }) {
  const s = data.stats;
  const botReviewPct = Math.round((s.botReviews / s.totalReviews) * 100);
  const noReviewPct = Math.round((s.prsWithNoHumanReview / s.humanPrs) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/12 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2.5">
          <h2 className="text-[14px] font-semibold text-white">How this is calculated</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-0.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[12px] leading-relaxed text-slate-300">
          <H>The definition</H>
          <p className="mb-3">
            Impact is <strong className="text-white">how much the organisation&rsquo;s forward motion
            depends on you</strong>. That is visible in how colleagues behave around your work, not in how
            much work there is. Commit counts, lines of code and files-changed are deliberately{' '}
            <strong className="text-white">not inputs to any pillar</strong> &mdash; they measure typing,
            not consequence.
          </p>

          <H>The five pillars</H>
          <div className="mb-3 flex flex-col gap-2">
            {PILLARS.map((p) => (
              <div key={p.key} className="rounded-lg border border-white/8 bg-ink-850/60 p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                  <span className="text-[12.5px] font-semibold text-white">{p.label}</span>
                  <span className="text-[11px] text-slate-500">
                    {p.question} &middot; default weight {data.meta.defaultWeights[p.key]}%
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-slate-400">{p.how}</p>
              </div>
            ))}
          </div>
          <p className="mb-3">
            Each pillar is converted to a <strong className="text-white">percentile</strong> among the{' '}
            {s.rankedEngineers} qualifying engineers, then combined using the weights you control. A score
            of 100 means top-of-population on all five. Percentiles rather than raw values mean one
            extreme outlier cannot swamp a pillar, and the weights stay comparable.
          </p>

          <H>Three things in this data that change the answer</H>
          <ol className="mb-3 flex list-decimal flex-col gap-2 pl-5">
            <li>
              <strong className="text-white">{botReviewPct}% of all reviews are machines.</strong> In the
              raw data the busiest &ldquo;reviewers&rdquo; in the repo are{' '}
              <code className="text-slate-400">coderabbitai</code>,{' '}
              <code className="text-slate-400">stamphog</code> and{' '}
              <code className="text-slate-400">greptile-apps</code> &mdash; all of them outrank the
              busiest human. Every one of the {s.botAccounts} accounts below was excluded, and
              they are classified by asking GitHub what each account actually is (App, Organization or
              User) rather than by guessing from names.
            </li>
            <li>
              <strong className="text-white">{noReviewPct}% of human PRs merge with no human review.</strong>{' '}
              PostHog auto-approves a large share of merges, so raw PR counts say very little. This is
              precisely why shipped weight scales with the scrutiny a PR actually drew: an unreviewed
              auto-merge earns a small floor, a change three people argued over earns much more.
            </li>
            <li>
              <strong className="text-white">Every PR title is machine-readable.</strong>{' '}
              {s.conventionalPct}% follow conventional commits and {s.scopedPct}% carry an explicit scope
              like <code className="text-slate-400">fix(data-warehouse):</code>, across {s.distinctAreas}{' '}
              distinct areas. That is what makes domain ownership measurable without guessing at file
              paths.
            </li>
          </ol>

          <H>Data and provenance</H>
          <ul className="mb-3 flex flex-col gap-1 pl-5">
            <Li>
              Source: GitHub GraphQL API, every PR <em>merged</em> into {data.meta.repo} between{' '}
              {data.meta.from} and {data.meta.to} ({data.meta.windowDays} days), pulled in one-day shards
              to stay under the 1,000-result search cap.
            </Li>
            <Li>
              Volume: <strong className="text-white">{fmtNum(s.mergedPrs)}</strong> merged PRs (
              {fmtNum(s.humanPrs)} human-authored, {fmtNum(s.botPrs)} bot-authored) carrying{' '}
              {fmtNum(s.totalReviews)} review events, of which {fmtNum(s.humanReviews)} were human reviews
              of someone else&rsquo;s work.
            </Li>
            <Li>
              Spot-checked against GitHub&rsquo;s own search counts: the per-author merged-PR totals here
              match <code className="text-slate-400">is:pr is:merged author:X</code> exactly. Every figure
              in the drilldown links back to the PR or the search that produces it.
            </Li>
            <Li>
              Qualifying bar: {data.meta.thresholds.minAuthored}+ merged PRs or{' '}
              {data.meta.thresholds.minReviews}+ reviews given. An area counts as load-bearing at{' '}
              {Math.round(data.meta.thresholds.ownershipMinShare * 100)}%+ share of an area with{' '}
              {data.meta.thresholds.areaMinTotalPrs}+ PRs.
            </Li>
            <Li>
              Precomputed at build time into a {'\u2248'}300&nbsp;KB JSON file, so the page makes no API
              calls and nothing is recomputed in your browser beyond the re-weighting.
            </Li>
          </ul>

          <H>What this deliberately does not measure</H>
          <ul className="mb-3 flex flex-col gap-1 pl-5">
            <Li>
              Work that never lands in this repo: design, incident response, RFCs, mentoring in Slack,
              on-call, hiring, or contributions to PostHog&rsquo;s other {'~'}380 repositories.
            </Li>
            <Li>
              Review <em>quality</em>. Inline-comment counts are a proxy for substance; a single sentence
              that redirects a project scores lower than ten nitpicks.
            </Li>
            <Li>
              Durability. Only {s.revertPrs} of {fmtNum(s.mergedPrs)} merges were reverts ({'<'}0.2%), far
              too sparse to rank anyone on, so it is reported here as repo context rather than folded into
              a score.
            </Li>
            <Li>
              Seniority and scope of role. A staff engineer deliberately spending their time on review
              will look different from a strong individual shipper &mdash; which is why the weighting is
              adjustable instead of fixed.
            </Li>
          </ul>

          <H>Accounts excluded as automation ({s.botAccounts})</H>
          <div className="flex flex-wrap gap-1">
            {data.bots.map((b) => (
              <span
                key={b.login}
                title={b.reason}
                className="rounded border border-amber-400/20 bg-amber-400/8 px-1.5 py-[2px] font-mono text-[10px] text-amber-200/80"
              >
                {b.login}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h3>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="list-disc text-[11.5px] text-slate-400">{children}</li>;
}
