'use client';

import { PILLARS, PRESETS, score, type Engineer, type Weights } from '../lib/model';

export default function WeightPanel({
  weights,
  setWeights,
  ranked,
}: {
  weights: Weights;
  setWeights: (w: Weights) => void;
  ranked: Engineer[];
}) {
  const activePreset = PRESETS.find((p) => PILLARS.every((pl) => p.weights[pl.key] === weights[pl.key]));

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[11.5px] leading-relaxed text-slate-400">
        There is no single correct definition of impact, so the weighting is yours to set. Each engineer is
        scored on their <strong className="text-slate-200">percentile</strong> within PostHog for each
        pillar; these weights decide how those five percentiles combine. The ranking on the left updates as
        you drag.
      </p>

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Start from a point of view
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const active = activePreset?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setWeights(p.weights)}
                className={`rounded-lg border px-2.5 py-2 text-left transition ${
                  active
                    ? 'border-sky-400/50 bg-sky-400/8'
                    : 'border-white/8 bg-ink-850/60 hover:border-white/20'
                }`}
              >
                <div className="text-[12px] font-semibold text-white">{p.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{p.blurb}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Or tune each pillar
        </h3>
        <div className="flex flex-col gap-2.5">
          {PILLARS.map((p) => (
            <div key={p.key}>
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor={`w-${p.key}`}
                  className="flex items-baseline gap-1.5 text-[12px] font-medium text-slate-200"
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                  {p.label}
                  <span className="text-[10.5px] font-normal text-slate-500">{p.question}</span>
                </label>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                  {weights[p.key]}%
                </span>
              </div>
              <input
                id={`w-${p.key}`}
                type="range"
                min={0}
                max={60}
                step={5}
                value={weights[p.key]}
                style={{ color: p.color }}
                onChange={(ev) =>
                  setWeights({ ...weights, [p.key]: Number(ev.target.value) })
                }
                className="mt-1.5 w-full"
              />
              <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{p.how}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-white/8 bg-ink-850/60 p-2.5">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          How sensitive is the answer?
        </h3>
        <p className="mb-2 text-[10.5px] text-slate-500">
          Top 5 under each preset. Names that appear in every column are robust to how you define impact.
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => {
            const top = [...ranked].sort((a, b) => score(b, p.weights) - score(a, p.weights)).slice(0, 5);
            return (
              <div key={p.id}>
                <div
                  className={`mb-1 truncate text-[10px] font-semibold uppercase tracking-wide ${
                    activePreset?.id === p.id ? 'text-sky-400' : 'text-slate-500'
                  }`}
                >
                  {p.label}
                </div>
                <ol className="flex flex-col gap-0.5">
                  {top.map((e) => (
                    <li
                      key={e.login}
                      className="truncate font-mono text-[10px] text-slate-400"
                      title={`${e.login} \u2014 ${score(e, p.weights).toFixed(1)}`}
                    >
                      {e.login}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
