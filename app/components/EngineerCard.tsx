'use client';

import { contributions, fmtPct, type Engineer, type Weights } from '../lib/model';

export default function EngineerCard({
  engineer: e,
  position,
  weights,
  score,
  why,
  selected,
  onSelect,
}: {
  engineer: Engineer;
  position: number;
  weights: Weights;
  score: number;
  why: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const parts = contributions(e, weights);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;

  return (
    <li>
      <button
        onClick={onSelect}
        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
          selected
            ? 'border-sky-400/50 bg-sky-400/6'
            : 'border-white/8 bg-ink-850/60 hover:border-white/20 hover:bg-ink-850'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`w-4 shrink-0 text-center text-[15px] font-bold tabular-nums ${
              position === 1 ? 'text-amber-300' : 'text-slate-600'
            }`}
          >
            {position}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={e.avatar ?? ''}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/15"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-white">
                {e.name ?? e.login}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-slate-500">@{e.login}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-400">{why}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[17px] font-bold leading-none tabular-nums text-white">
              {score.toFixed(1)}
            </div>
            <div className="mt-0.5 text-[9.5px] uppercase tracking-wide text-slate-600">score</div>
          </div>
        </div>

        {/* Pillar contribution bar: width is literally each pillar's share of
            the score, so the visual and the arithmetic are the same thing. */}
        <div className="mt-1.5 flex h-[6px] w-full overflow-hidden rounded-full bg-ink-800">
          {parts.map((p) => (
            <div
              key={p.key}
              title={`${p.label}: contributes ${p.value.toFixed(1)} of ${score.toFixed(1)} (${
                e.pct[p.key]
              }th percentile x ${weights[p.key]}% weight)`}
              style={{
                width: `${(p.value / total) * 100}%`,
                background: p.color,
              }}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {parts.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1 text-[10px]">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: p.color }}
              />
              <span className="text-slate-500">{p.label}</span>
              <span className="font-semibold tabular-nums text-slate-300">
                {fmtPct(e.pct[p.key])}
                <span className="text-slate-600">th</span>
              </span>
            </span>
          ))}
        </div>
      </button>
    </li>
  );
}
