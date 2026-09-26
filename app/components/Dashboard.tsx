'use client';

import { useMemo, useState } from 'react';
import {
  PILLARS,
  PRESETS,
  fmtNum,
  rank,
  score,
  type Engineer,
  type Metrics,
  type Weights,
  why,
} from '../lib/model';
import EngineerCard from './EngineerCard';
import Drilldown from './Drilldown';
import WeightPanel from './WeightPanel';
import Roster from './Roster';
import Methodology from './Methodology';

type Tab = 'why' | 'weights' | 'roster';

export default function Dashboard({ data }: { data: Metrics }) {
  const [weights, setWeights] = useState<Weights>(data.meta.defaultWeights);
  const [tab, setTab] = useState<Tab>('why');
  const [selected, setSelected] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);

  const ranked = useMemo(() => rank(data.engineers, weights), [data.engineers, weights]);
  const top5 = ranked.slice(0, 5);
  const current =
    ranked.find((e) => e.login === selected) ?? top5[0] ?? null;

  const activePreset = PRESETS.find((p) =>
    PILLARS.every((pl) => p.weights[pl.key] === weights[pl.key])
  );

  const s = data.stats;

  return (
    <main className="flex h-screen flex-col gap-2.5 overflow-auto p-3 lg:overflow-hidden lg:p-4">
      <Header data={data} top5={top5} onShowMethod={() => setShowMethod(true)} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)]">
        {/* Left: the answer */}
        <section className="flex min-h-0 flex-col rounded-xl border border-white/8 bg-ink-900/70">
          <div className="flex items-baseline justify-between gap-3 border-b border-white/8 px-4 py-2.5">
            <h2 className="text-[13px] font-semibold tracking-tight text-white">
              Top 5 by impact
              {activePreset ? (
                <span className="ml-2 font-normal text-slate-500">{activePreset.label} weighting</span>
              ) : (
                <span className="ml-2 font-normal text-slate-500">custom weighting</span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500">
              Bar width = each pillar&rsquo;s share of the score. Click a row for the evidence.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <ol className="flex flex-col gap-2">
              {top5.map((e, i) => (
                <EngineerCard
                  key={e.login}
                  engineer={e}
                  position={i + 1}
                  weights={weights}
                  score={score(e, weights)}
                  why={why(e, weights)}
                  selected={current?.login === e.login}
                  onSelect={() => {
                    setSelected(e.login);
                    setTab('why');
                  }}
                />
              ))}
            </ol>
            <NextUp
              engineers={ranked.slice(5, 10)}
              weights={weights}
              onSelect={(login) => {
                setSelected(login);
                setTab('why');
              }}
            />
          </div>
        </section>

        {/* Right: how we got there */}
        <section className="flex min-h-0 flex-col rounded-xl border border-white/8 bg-ink-900/70">
          <div className="flex items-center gap-1 border-b border-white/8 px-2.5 py-2">
            {(
              [
                ['why', current ? `Why ${current.login}` : 'Evidence'],
                ['weights', 'Define impact'],
                ['roster', `All ${s.rankedEngineers} engineers`],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
                  tab === id
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'why' && current && (
              <Drilldown engineer={current} weights={weights} meta={data.meta} stats={data.stats} />
            )}
            {tab === 'weights' && (
              <WeightPanel weights={weights} setWeights={setWeights} ranked={ranked} />
            )}
            {tab === 'roster' && (
              <Roster
                engineers={ranked}
                weights={weights}
                selected={current?.login ?? null}
                onSelect={(login) => {
                  setSelected(login);
                  setTab('why');
                }}
              />
            )}
          </div>
        </section>
      </div>

      {showMethod && <Methodology data={data} onClose={() => setShowMethod(false)} />}
    </main>
  );
}

function Header({
  data,
  top5,
  onShowMethod,
}: {
  data: Metrics;
  top5: Engineer[];
  onShowMethod: () => void;
}) {
  const s = data.stats;
  const range = `${fmtDate(data.meta.from)} \u2013 ${fmtDate(data.meta.to)}`;

  return (
    <header className="shrink-0 rounded-xl border border-white/8 bg-gradient-to-br from-ink-850 to-ink-900 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-white">
            Who are PostHog&rsquo;s most impactful engineers?
          </h1>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-slate-400">
            Ranked over{' '}
            <a
              href={data.meta.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-200 underline decoration-white/25 hover:decoration-white"
            >
              PostHog/posthog
            </a>{' '}
            for the last {data.meta.windowDays} days by how much the org&rsquo;s forward motion depends on
            them &mdash; not by commits or lines of code.{' '}
            <button
              onClick={onShowMethod}
              className="font-medium text-sky-400 underline decoration-sky-400/40 hover:decoration-sky-400"
            >
              How this is calculated
            </button>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {top5.slice(0, 5).map((e, i) => (
            <a
              key={e.login}
              href={e.links.profile}
              target="_blank"
              rel="noreferrer"
              title={`#${i + 1} ${e.name ?? e.login} (@${e.login})`}
              className="relative"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={e.avatar ?? ''}
                alt={e.login}
                className="h-9 w-9 rounded-full ring-2 ring-white/15 transition hover:ring-sky-400/70"
              />
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-ink-800 text-[9px] font-bold text-white ring-1 ring-white/20">
                {i + 1}
              </span>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-white/8 pt-2.5 text-[11px]">
        <Chip label="Window" value={range} />
        <Chip label="Merged PRs" value={fmtNum(s.mergedPrs)} />
        <Chip label="Human-authored" value={fmtNum(s.humanPrs)} />
        <Chip label="Human reviews" value={fmtNum(s.humanReviews)} />
        <Chip label="Engineers ranked" value={fmtNum(s.rankedEngineers)} />
        <Chip label="Product areas" value={fmtNum(s.distinctAreas)} />
        <Chip
          label="Automation excluded"
          value={`${s.botAccounts} accounts, ${fmtNum(s.botReviews)} reviews`}
          accent
        />
        <span className="ml-auto text-slate-600">
          Snapshot {new Date(data.meta.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>
      </div>
    </header>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-md border px-2 py-[3px] ${
        accent
          ? 'border-amber-400/25 bg-amber-400/8 text-amber-200/90'
          : 'border-white/8 bg-white/4 text-slate-300'
      }`}
    >
      <span className={accent ? 'text-amber-200/60' : 'text-slate-500'}>{label}</span>
      <span className="font-semibold tabular-nums text-white/90">{value}</span>
    </span>
  );
}

function NextUp({
  engineers,
  weights,
  onSelect,
}: {
  engineers: Engineer[];
  weights: Weights;
  onSelect: (login: string) => void;
}) {
  if (!engineers.length) return null;
  return (
    <div className="mt-2.5 rounded-lg border border-white/6 bg-white/2 px-3 py-2">
      <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-slate-500">
        Ranked 6&ndash;10
      </p>
      <div className="flex flex-wrap gap-1.5">
        {engineers.map((e, i) => (
          <button
            key={e.login}
            onClick={() => onSelect(e.login)}
            className="group flex items-center gap-1.5 rounded-md border border-white/8 bg-ink-850 px-1.5 py-1 text-[11.5px] transition hover:border-sky-400/40 hover:bg-ink-800"
          >
            <span className="w-3 text-right tabular-nums text-slate-600">{i + 6}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.avatar ?? ''} alt="" className="h-4 w-4 rounded-full" />
            <span className="text-slate-300 group-hover:text-white">{e.login}</span>
            <span className="tabular-nums text-slate-500">{score(e, weights).toFixed(0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return '?';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
