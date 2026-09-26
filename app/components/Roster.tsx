'use client';

import { useMemo, useState } from 'react';
import { fmtHours, fmtNum, score, type Engineer, type Weights } from '../lib/model';

type SortKey = 'score' | 'authored' | 'reviewsGiven' | 'authorsHelped' | 'areas' | 'response';

export default function Roster({
  engineers,
  weights,
  selected,
  onSelect,
}: {
  engineers: Engineer[];
  weights: Weights;
  selected: string | null;
  onSelect: (login: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('score');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? engineers.filter(
          (e) =>
            e.login.toLowerCase().includes(needle) ||
            (e.name ?? '').toLowerCase().includes(needle) ||
            e.areas.some((a) => a.scope.includes(needle))
        )
      : engineers;
    const get = (e: Engineer): number => {
      switch (sort) {
        case 'authored':
          return e.raw.authored;
        case 'reviewsGiven':
          return e.raw.reviewsGiven;
        case 'authorsHelped':
          return e.raw.authorsHelped;
        case 'areas':
          return e.raw.loadBearingAreas;
        case 'response':
          return -(e.raw.medianResponseHours ?? 1e9);
        default:
          return score(e, weights);
      }
    };
    return [...filtered].sort((a, b) => get(b) - get(a));
  }, [engineers, q, sort, weights]);

  const cols: { key: SortKey; label: string; title: string }[] = [
    { key: 'score', label: 'Score', title: 'Composite under the current weighting' },
    { key: 'authored', label: 'PRs', title: 'Merged PRs authored' },
    { key: 'reviewsGiven', label: 'Revs', title: 'Reviews given to other people' },
    { key: 'authorsHelped', label: 'People', title: 'Distinct engineers they reviewed for' },
    { key: 'areas', label: 'Areas', title: 'Load-bearing product areas' },
    { key: 'response', label: 'Median', title: 'Median time to first review' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={'Filter by name, handle or product area\u2026'}
          className="w-full rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-[11.5px] text-slate-200 placeholder:text-slate-600 focus:border-sky-400/50 focus:outline-none"
        />
        <span className="shrink-0 text-[10.5px] text-slate-500">{rows.length} shown</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10 bg-ink-900">
            <tr className="text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1.5 text-left font-medium">#</th>
              <th className="px-2 py-1.5 text-left font-medium">Engineer</th>
              {cols.map((c) => (
                <th key={c.key} className="px-1.5 py-1.5 text-right font-medium">
                  <button
                    title={c.title}
                    onClick={() => setSort(c.key)}
                    className={`transition hover:text-slate-200 ${
                      sort === c.key ? 'text-sky-400' : ''
                    }`}
                  >
                    {c.label}
                    {sort === c.key ? ' \u2193' : ''}
                  </button>
                </th>
              ))}
              <th className="px-2 py-1.5 text-left font-medium">Primary area</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const primary = e.areas.find((a) => a.loadBearing) ?? e.areas[0];
              return (
                <tr
                  key={e.login}
                  onClick={() => onSelect(e.login)}
                  className={`cursor-pointer border-t border-white/5 transition ${
                    selected === e.login ? 'bg-sky-400/8' : 'hover:bg-white/4'
                  }`}
                >
                  <td className="px-2 py-1 tabular-nums text-slate-600">{i + 1}</td>
                  <td className="max-w-[210px] px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={e.avatar ?? ''} alt="" className="h-4 w-4 shrink-0 rounded-full" />
                      <span className="truncate text-slate-300">{e.name ?? e.login}</span>
                      <span className="shrink-0 font-mono text-[9.5px] text-slate-600">
                        @{e.login}
                      </span>
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-right font-semibold tabular-nums text-white">
                    {score(e, weights).toFixed(1)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-400">
                    {fmtNum(e.raw.authored)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-400">
                    {fmtNum(e.raw.reviewsGiven)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-400">
                    {e.raw.authorsHelped}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-400">
                    {e.raw.loadBearingAreas}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-slate-400">
                    {fmtHours(e.raw.medianResponseHours)}
                  </td>
                  <td className="max-w-[130px] truncate px-2 py-1 font-mono text-[10px] text-slate-500">
                    {primary ? `${primary.scope} ${Math.round(primary.share * 100)}%` : '\u2014'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-white/8 px-3 py-1.5 text-[10px] text-slate-600">
        Qualifying bar: 3+ merged PRs or 5+ reviews given in the window. Sorted by{' '}
        {cols.find((c) => c.key === sort)?.label}. Click any row for its evidence.
      </div>
    </div>
  );
}
