export type PillarKey = 'shipped' | 'leverage' | 'centrality' | 'ownership' | 'speed';

export type Engineer = {
  login: string;
  name: string | null;
  avatar: string | null;
  composite: number;
  pct: Record<PillarKey, number>;
  raw: {
    authored: number;
    authoredTrivial: number;
    shippedWeight: number;
    reviewsReceived: number;
    inlineReceived: number;
    autoApprovedOnly: number;
    reviewsGiven: number;
    reviewValue: number;
    inlineGiven: number;
    changesRequested: number;
    approvalsOnly: number;
    authorsHelped: number;
    firstResponder: number;
    medianResponseHours: number | null;
    loadBearingAreas: number;
    ownershipScore: number;
    centrality: number;
    reverted: number;
    breaking: number;
    types: Record<string, number>;
    reviewsPerPr: number;
    zeroReviewPct: number;
    medianChurn: number | null;
    medianConsequence: number;
    shareOfHumanPrs: number;
  };
  areas: {
    scope: string;
    share: number;
    authored: number;
    areaPrs: number;
    areaHumans: number;
    loadBearing: boolean;
  }[];
  topPrs: {
    n: number;
    title: string;
    url: string;
    reviewers: number;
    inline: number;
    scope: string;
    merged: string;
    consequence: number;
  }[];
  collaborators: { login: string; count: number; name: string | null }[];
  links: { profile: string; authored: string; reviewed: string };
};

export type Metrics = {
  meta: {
    repo: string;
    repoUrl: string;
    from: string;
    to: string;
    windowDays: number | null;
    generatedAt: string;
    fetchedAt: string | null;
    defaultWeights: Record<PillarKey, number>;
    thresholds: Record<string, number>;
    reviewBase: Record<string, number>;
    typeWeight: Record<string, number>;
  };
  stats: {
    mergedPrs: number;
    humanPrs: number;
    botPrs: number;
    totalReviews: number;
    humanReviews: number;
    botReviews: number;
    selfReviews: number;
    conventionalPct: number;
    scopedPct: number;
    distinctAreas: number;
    medianCentrality: number;
    revertPrs: number;
    prsWithNoHumanReview: number;
    humansSeen: number;
    rankedEngineers: number;
    revertsMatched: number;
    botAccounts: number;
    unresolvedAccounts: string[];
  };
  bots: { login: string; reason: string }[];
  topAreas: { scope: string; prs: number; humans: number }[];
  engineers: Engineer[];
};

export const PILLARS: {
  key: PillarKey;
  label: string;
  short: string;
  color: string;
  question: string;
  how: string;
}[] = [
  {
    key: 'shipped',
    label: 'Shipped weight',
    short: 'Ship',
    color: '#4f8ff7',
    question: 'Did their work matter?',
    how: 'Every merged PR is weighted by how much human scrutiny the org chose to spend on it — distinct reviewers, review rounds and inline comments. A change three engineers argued over counts far more than one a bot rubber-stamped. Dependency bumps, docs and chores are discounted. Lines of code and files changed are not inputs at all.',
  },
  {
    key: 'leverage',
    label: 'Review leverage',
    short: 'Lift',
    color: '#31c48d',
    question: 'Do they make others faster?',
    how: 'Reviews they gave on other people\u2019s PRs, weighted so requesting changes or leaving inline comments counts more than a bare approval, then multiplied by the number of *different* engineers they unblocked. Broad mentorship beats rubber-stamping one teammate.',
  },
  {
    key: 'centrality',
    label: 'Trust centrality',
    short: 'Trust',
    color: '#c084fc',
    question: 'Does the org route trust through them?',
    how: 'PageRank over the who-reviews-whom graph. You score highly by being relied on by people who are themselves relied on. Unlike a review count, this cannot be inflated by spraying approvals at low-stakes PRs.',
  },
  {
    key: 'ownership',
    label: 'Domain ownership',
    short: 'Own',
    color: '#f0913e',
    question: 'What breaks if they leave?',
    how: 'PostHog tags every PR with a product area (`fix(data-warehouse): \u2026`). This is the share of each area\u2019s total activity that flows through this person, counting both what they write and what they review. Owning a slice of a busy area counts more than owning a quiet corner.',
  },
  {
    key: 'speed',
    label: 'Unblocking speed',
    short: 'Speed',
    color: '#f2555a',
    question: 'How long do others wait on them?',
    how: 'How often they were the first human to respond to someone else\u2019s PR, combined with their median time-to-first-review. A fast first review compounds into everyone else\u2019s cycle time.',
  },
];

export const PILLAR_BY_KEY = Object.fromEntries(PILLARS.map((p) => [p.key, p])) as Record<
  PillarKey,
  (typeof PILLARS)[number]
>;

export type Weights = Record<PillarKey, number>;

export const PRESETS: { id: string; label: string; blurb: string; weights: Weights }[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    blurb: 'All five pillars, shipping and enabling weighted equally.',
    weights: { shipped: 25, leverage: 25, centrality: 15, ownership: 20, speed: 15 },
  },
  {
    id: 'shipper',
    label: 'Pure shipper',
    blurb: 'Only credits consequential merged work.',
    weights: { shipped: 70, leverage: 10, centrality: 5, ownership: 15, speed: 0 },
  },
  {
    id: 'multiplier',
    label: 'Force multiplier',
    blurb: 'Credits the people who make everyone else faster.',
    weights: { shipped: 5, leverage: 40, centrality: 25, ownership: 5, speed: 25 },
  },
  {
    id: 'owner',
    label: 'Domain owner',
    blurb: 'Surfaces bus-factor risk: who is a single point of failure?',
    weights: { shipped: 15, leverage: 10, centrality: 15, ownership: 55, speed: 5 },
  },
];

export function score(e: Engineer, w: Weights): number {
  const total = PILLARS.reduce((s, p) => s + (w[p.key] || 0), 0) || 1;
  const raw = PILLARS.reduce((s, p) => s + (w[p.key] || 0) * e.pct[p.key], 0);
  return raw / total;
}

export function contributions(e: Engineer, w: Weights) {
  const total = PILLARS.reduce((s, p) => s + (w[p.key] || 0), 0) || 1;
  return PILLARS.map((p) => ({
    ...p,
    value: ((w[p.key] || 0) * e.pct[p.key]) / total,
  }));
}

export function rank(engineers: Engineer[], w: Weights): Engineer[] {
  return [...engineers].sort((a, b) => score(b, w) - score(a, w));
}

export function fmtHours(h: number | null): string {
  if (h === null) return 'n/a';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

/** Percentiles are shown to one decimal so the score arithmetic visibly adds up. */
export function fmtPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * One plain-English sentence per engineer, built from whichever pillars they
 * actually score on, so the headline reads as evidence rather than a number.
 */
export function why(e: Engineer, w: Weights): string {
  const ranked = contributions(e, w)
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const parts: string[] = [];
  const primary = e.areas.find((a) => a.loadBearing) ?? e.areas[0];

  for (const c of ranked.slice(0, 3)) {
    if (c.key === 'shipped') {
      parts.push(
        `landed ${fmtNum(e.raw.authored)} merged PRs that drew ${fmtNum(e.raw.reviewsReceived)} human reviews`
      );
    } else if (c.key === 'leverage') {
      parts.push(
        `reviewed for ${e.raw.authorsHelped} different engineers (${fmtNum(e.raw.reviewsGiven)} reviews, ${fmtNum(
          e.raw.inlineGiven
        )} inline comments)`
      );
    } else if (c.key === 'centrality') {
      parts.push(`sits in the top ${Math.max(1, Math.round(100 - e.pct.centrality))}% of the review-trust graph`);
    } else if (c.key === 'ownership' && primary) {
      parts.push(
        `carries ${Math.round(primary.share * 100)}% of all activity in \`${primary.scope}\`${
          e.raw.loadBearingAreas > 1 ? ` and is load-bearing in ${e.raw.loadBearingAreas} areas` : ''
        }`
      );
    } else if (c.key === 'speed') {
      parts.push(
        `first to respond on ${fmtNum(e.raw.firstResponder)} PRs, median ${fmtHours(
          e.raw.medianResponseHours
        )}`
      );
    }
  }
  const s = parts.slice(0, 3).join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}
