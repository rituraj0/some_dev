'use client';

import {
  contributions,
  fmtHours,
  fmtNum,
  fmtPct,
  type Engineer,
  type Metrics,
  type Weights,
} from '../lib/model';

export default function Drilldown({
  engineer: e,
  weights,
  meta,
  stats,
}: {
  engineer: Engineer;
  weights: Weights;
  meta: Metrics['meta'];
  stats: Metrics['stats'];
}) {
  const parts = contributions(e, weights);
  const centralityX = stats.medianCentrality
    ? e.raw.centrality / stats.medianCentrality
    : 0;

  // The raw evidence behind each pillar, stated as numbers a leader can check.
  const evidence: Record<string, { stat: string; detail: string }> = {
    shipped: {
      stat: `${fmtNum(e.raw.authored)} merged PRs`,
      detail: `drew ${fmtNum(e.raw.reviewsReceived)} human reviews and ${fmtNum(
        e.raw.inlineReceived
      )} inline comments \u00b7 ${e.raw.zeroReviewPct}% merged with no human review \u00b7 median ${
        e.raw.medianChurn ?? 0
      } lines changed \u00b7 ${e.raw.shareOfHumanPrs}% of all human PRs in the repo`,
    },
    leverage: {
      stat: `${fmtNum(e.raw.reviewsGiven)} reviews given`,
      detail: `to ${e.raw.authorsHelped} different engineers \u00b7 ${fmtNum(
        e.raw.changesRequested
      )} requested changes \u00b7 ${fmtNum(e.raw.inlineGiven)} inline comments \u00b7 ${fmtNum(
        e.raw.approvalsOnly
      )} bare approvals (discounted)`,
    },
    centrality: {
      stat: `${centralityX.toFixed(1)}\u00d7 the median engineer`,
      detail: `PageRank over the who-reviews-whom graph \u00b7 their reviewers and reviewees are themselves well-connected`,
    },
    ownership: {
      stat: `${e.raw.loadBearingAreas} load-bearing ${
        e.raw.loadBearingAreas === 1 ? 'area' : 'areas'
      }`,
      detail: e.areas.length
        ? `top area \`${e.areas[0].scope}\`: ${Math.round(e.areas[0].share * 100)}% of its activity, ${
            e.areas[0].areaPrs
          } PRs from ${e.areas[0].areaHumans} people`
        : 'no area above the ownership threshold',
    },
    speed: {
      stat: `${fmtNum(e.raw.firstResponder)} PRs answered first`,
      detail: `median time-to-first-review ${fmtHours(e.raw.medianResponseHours)}`,
    },
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Identity */}
      <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-ink-850/60 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={e.avatar ?? ''} alt="" className="h-11 w-11 rounded-full ring-1 ring-white/15" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white">{e.name ?? e.login}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px]">
            <a
              href={e.links.profile}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-slate-400 hover:text-sky-400"
            >
              @{e.login}
            </a>
            <a
              href={e.links.authored}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400/90 hover:text-sky-300"
            >
              verify {fmtNum(e.raw.authored)} merged PRs &rarr;
            </a>
            <a
              href={e.links.reviewed}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400/90 hover:text-sky-300"
            >
              verify reviews &rarr;
            </a>
          </div>
        </div>
      </div>

      {/* Pillar-by-pillar arithmetic */}
      <section>
        <SectionTitle>Score breakdown</SectionTitle>
        <div className="overflow-hidden rounded-lg border border-white/8">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-white/4 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-2.5 py-1.5 font-medium">Pillar</th>
                <th className="px-2 py-1.5 text-right font-medium">Pct</th>
                <th className="px-2 py-1.5 text-right font-medium">Wt</th>
                <th className="px-2 py-1.5 text-right font-medium">Points</th>
                <th className="px-2.5 py-1.5 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.key} className="border-t border-white/6 align-top">
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: p.color }}
                      />
                      <span className="text-slate-200">{p.label}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                    {fmtPct(e.pct[p.key])}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                    {weights[p.key]}%
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-white">
                    {p.value.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="font-medium text-slate-200">{evidence[p.key].stat}</div>
                    <div className="mt-0.5 leading-snug text-[10.5px] text-slate-500">
                      {evidence[p.key].detail}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-white/10 bg-white/4">
                <td className="px-2.5 py-1.5 font-semibold text-white" colSpan={3}>
                  Composite
                </td>
                <td className="px-2 py-1.5 text-right font-bold tabular-nums text-white">
                  {parts.reduce((s, p) => s + p.value, 0).toFixed(1)}
                </td>
                <td className="px-2.5 py-1.5 text-[10.5px] text-slate-500">
                  Percentile &times; weight, summed. 100 = top of every pillar.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Areas */}
      {e.areas.length > 0 && (
        <section>
          <SectionTitle>
            Areas they carry
            <Hint>share of all activity in that product area, authored + reviewed</Hint>
          </SectionTitle>
          <div className="flex flex-col gap-1">
            {e.areas.slice(0, 5).map((a) => (
              <div key={a.scope} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-40 shrink-0 truncate font-mono text-slate-300" title={a.scope}>
                  {a.scope}
                </span>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-ink-800">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, a.share * 100)}%`,
                      background: a.loadBearing ? '#f0913e' : '#f0913e55',
                    }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-slate-200">
                  {Math.round(a.share * 100)}%
                </span>
                <span className="w-28 shrink-0 text-right text-[10px] text-slate-500">
                  {a.authored} of {a.areaPrs} PRs &middot; {a.areaHumans}p
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Collaborators */}
      {e.collaborators.length > 0 && (
        <section>
          <SectionTitle>
            Who they unblock
            <Hint>reviews given, by author</Hint>
          </SectionTitle>
          <div className="flex flex-wrap gap-1">
            {e.collaborators.map((c) => (
              <a
                key={c.login}
                href={`https://github.com/${c.login}`}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-white/8 bg-ink-850 px-1.5 py-[3px] text-[11px] text-slate-300 transition hover:border-emerald-400/40 hover:text-white"
              >
                {c.login} <span className="font-semibold tabular-nums text-emerald-400">{c.count}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Evidence PRs */}
      {e.topPrs.length > 0 && (
        <section>
          <SectionTitle>
            Their highest-scrutiny merges
            <Hint>the PRs that earned the most shipped weight</Hint>
          </SectionTitle>
          <div className="flex flex-col gap-1">
            {e.topPrs.map((pr) => (
              <a
                key={pr.n}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-2 rounded border border-white/8 bg-ink-850/60 px-2 py-1.5 transition hover:border-sky-400/40 hover:bg-ink-850"
              >
                <span className="shrink-0 font-mono text-[10.5px] text-slate-500 group-hover:text-sky-400">
                  #{pr.n}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-300 group-hover:text-white">
                  {pr.title}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                  {pr.reviewers} reviewer{pr.reviewers === 1 ? '' : 's'} &middot; {pr.inline} inline
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Honest caveats, per person */}
      <section className="rounded-lg border border-white/8 bg-white/2 p-2.5">
        <SectionTitle>Read this with care</SectionTitle>
        <ul className="flex flex-col gap-1 text-[11px] leading-snug text-slate-400">
          <li>
            <strong className="text-slate-300">{e.raw.zeroReviewPct}%</strong> of their merged PRs had no
            human reviewer, so those count for very little shipped weight by design.
          </li>
          <li>
            Median change size is{' '}
            <strong className="text-slate-300">{fmtNum(e.raw.medianChurn ?? 0)} lines</strong>, shown for
            context only &mdash; size is not an input to any pillar.
          </li>
          {e.raw.authoredTrivial > 0 && (
            <li>
              <strong className="text-slate-300">{fmtNum(e.raw.authoredTrivial)}</strong> of their PRs
              looked like dependency or chore work and were discounted to 20%.
            </li>
          )}
          {e.raw.shareOfHumanPrs > 5 && (
            <li className="text-amber-200/80">
              They account for <strong>{e.raw.shareOfHumanPrs}%</strong> of every human PR in the repo
              &mdash; an unusual volume that likely reflects agent-assisted authoring. Try the
              &ldquo;Force multiplier&rdquo; preset to see the ranking with volume de-emphasised.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h3>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="font-normal normal-case tracking-normal text-slate-600">{children}</span>;
}
