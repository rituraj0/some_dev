// Turns the raw PR cache into the aggregates the dashboard ships.
//
// The model: impact is how much the organisation's forward motion depends on
// you. That is visible in how colleagues behave around your work, not in how
// much work there is. Five pillars, each explainable in one sentence:
//
//   1 Shipped weight   - merged PRs weighted by the human scrutiny they drew
//   2 Review leverage  - substantive reviews given x distinct people unblocked
//   3 Trust centrality - PageRank over the who-reviews-whom graph
//   4 Domain ownership - share of each product area's activity flowing through you
//   5 Unblocking speed - how often, and how fast, you are first to respond
//
// Line counts, commit counts and files-changed are deliberately NOT inputs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const IN = path.join(CACHE_DIR, process.env.PRS_FILE || 'prs.ndjson');
const ACCOUNTS = path.join(CACHE_DIR, 'accounts.json');
const META = path.join(CACHE_DIR, 'fetch-meta.json');
const OUT_DIR = path.join(ROOT, 'app', 'data');
const OUT = path.join(OUT_DIR, 'metrics.json');

const REPO = 'PostHog/posthog';
const REPO_URL = `https://github.com/${REPO}`;

// ---------------------------------------------------------------------------
// Tunables, all surfaced in the methodology so nothing is a magic number.
// ---------------------------------------------------------------------------

// How much a review counts, by what the reviewer actually did.
const REVIEW_BASE = {
  CHANGES_REQUESTED: 1.5, // caught something and blocked the merge
  COMMENTED: 1.0, // engaged without blocking
  APPROVED: 0.4, // a bare approval is cheap
  DISMISSED: 0.2,
  PENDING: 0,
};

// Conventional-commit type -> how much shipped credit it earns.
const TYPE_WEIGHT = {
  feat: 1.0,
  fix: 1.0,
  perf: 1.1,
  refactor: 0.9,
  revert: 0.2,
  test: 0.5,
  chore: 0.35,
  build: 0.4,
  ci: 0.4,
  docs: 0.3,
  style: 0.25,
};

const DEFAULT_WEIGHTS = {
  shipped: 25,
  leverage: 25,
  centrality: 15,
  ownership: 20,
  speed: 15,
};

// Qualifying bar for the ranked population.
const MIN_AUTHORED = 3;
const MIN_REVIEWS = 5;

// Area ownership thresholds.
const OWNERSHIP_MIN_SHARE = 0.15;
const OWNERSHIP_MIN_PRS_IN_AREA = 4;
const AREA_MIN_TOTAL_PRS = 10;

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;

function parseTitle(title) {
  const m = CONVENTIONAL.exec(title || '');
  if (!m) return { type: null, scope: null, breaking: false, subject: title || '' };
  return {
    type: m[1].toLowerCase(),
    scope: (m[2] || '').trim().toLowerCase() || null,
    breaking: Boolean(m[3]),
    subject: m[4],
  };
}

function isTrivial(pr, parsed) {
  const t = (pr.t || '').toLowerCase();
  if (pr.labels?.some((l) => /^(automated|dependencies)$/i.test(l))) return true;
  if (/^(chore|build)$/.test(parsed.type || '') && /bump|dependenc|upgrade .*version|lockfile|snapshot/.test(t)) {
    return true;
  }
  if (/^(bump|update) .*(version|dependenc)/.test(t)) return true;
  return false;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Percentile rank (0-100) of each value within the population. Ties share a
// rank. Using percentiles rather than raw scores means one outlier cannot
// swamp a pillar, and the weights stay comparable across pillars.
function percentileRanks(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    if (n <= 1) return 100;
    // Fraction of the population strictly below, plus half the ties.
    let below = 0;
    let equal = 0;
    for (const s of sorted) {
      if (s < v) below++;
      else if (s === v) equal++;
    }
    return Math.round(((below + equal / 2) / n) * 1000) / 10;
  });
}

function pagerank(nodes, edges, { damping = 0.85, iters = 60 } = {}) {
  const index = new Map(nodes.map((n, i) => [n, i]));
  const n = nodes.length;
  if (!n) return new Map();
  const outWeight = new Float64Array(n);
  const incoming = Array.from({ length: n }, () => []);
  for (const [from, to, w] of edges) {
    const i = index.get(from);
    const j = index.get(to);
    if (i === undefined || j === undefined || i === j) continue;
    outWeight[i] += w;
    incoming[j].push([i, w]);
  }
  let rank = new Float64Array(n).fill(1 / n);
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outWeight[i] === 0) dangling += rank[i];
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (const [i, w] of incoming[j]) sum += (rank[i] * w) / outWeight[i];
      next[j] = (1 - damping) / n + damping * (sum + dangling / n);
    }
    rank = next;
  }
  return new Map(nodes.map((name, i) => [name, rank[i]]));
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`Missing ${IN}. Run "npm run fetch" first.`);
    process.exit(1);
  }
  const accounts = fs.existsSync(ACCOUNTS) ? JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8')) : {};
  const fetchMeta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};

  const isBot = (login) => {
    if (!login) return true;
    const a = accounts[login];
    // Unresolved accounts default to human, but the resolver covers everything
    // in practice; we report any gaps below.
    return a ? Boolean(a.isBot) : false;
  };

  // -------------------------------------------------------------------------
  // Load + normalise
  // -------------------------------------------------------------------------
  const prs = [];
  const seen = new Set();
  let rawCount = 0;
  for (const line of fs.readFileSync(IN, 'utf8').split('\n')) {
    if (!line) continue;
    let pr;
    try {
      pr = JSON.parse(line);
    } catch {
      continue;
    }
    rawCount++;
    if (seen.has(pr.n)) continue; // day shards can overlap at boundaries
    seen.add(pr.n);
    prs.push(pr);
  }

  const stats = {
    rawRows: rawCount,
    uniquePrs: prs.length,
    botAuthored: 0,
    humanPrs: 0,
    totalReviews: 0,
    botReviews: 0,
    humanReviews: 0,
    selfReviews: 0,
    conventional: 0,
    scoped: 0,
    unresolvedAccounts: new Set(),
  };

  const people = new Map();
  const person = (login) => {
    if (!people.has(login)) {
      people.set(login, {
        login,
        name: accounts[login]?.name || null,
        avatar: accounts[login]?.avatar || null,
        authored: 0,
        authoredTrivial: 0,
        shippedWeight: 0,
        reviewsReceivedHuman: 0,
        inlineReceived: 0,
        autoApprovedOnly: 0,
        reviewsGiven: 0,
        reviewValue: 0,
        inlineGiven: 0,
        changesRequested: 0,
        approvalsOnly: 0,
        authorsHelped: new Map(),
        firstResponder: 0,
        responseHours: [],
        areaAuthored: new Map(),
        areaActivity: new Map(),
        types: new Map(),
        bestPrs: [],
        reverted: 0,
        breaking: 0,
        churn: [],
        consequences: [],
        firstSeen: null,
        lastSeen: null,
      });
    }
    return people.get(login);
  };

  // Area heat: how many distinct humans work in each scope, and total volume.
  const areas = new Map();
  const area = (scope) => {
    if (!areas.has(scope)) {
      areas.set(scope, { scope, prs: 0, humans: new Set(), activity: 0 });
    }
    return areas.get(scope);
  };

  // Pass 1: parse, classify, accumulate authored + review-side facts.
  const titleToPr = new Map();
  const revertTitles = [];

  for (const pr of prs) {
    const parsed = parseTitle(pr.t);
    pr._p = parsed;
    if (parsed.type) stats.conventional++;
    if (parsed.scope) stats.scoped++;
    pr._scope = parsed.scope || 'unscoped';
    pr._trivial = isTrivial(pr, parsed);

    titleToPr.set((pr.t || '').trim(), pr);
    // PostHog reverts appear as `revert(scope): ...`, `revert: "<original title>"`
    // or GitHub's default `Revert "<original title>"`.
    if (parsed.type === 'revert' || /^revert[\s"(:]/i.test(pr.t || '')) revertTitles.push(pr);

    const authorIsBot = isBot(pr.a);
    if (pr.a && !accounts[pr.a]) stats.unresolvedAccounts.add(pr.a);

    // Reviews: split human vs machine. This is the load-bearing filter - in the
    // raw data the busiest reviewers are all bots.
    const humanReviews = [];
    for (const r of pr.reviews || []) {
      stats.totalReviews++;
      if (!accounts[r.by]) stats.unresolvedAccounts.add(r.by);
      if (isBot(r.by)) {
        stats.botReviews++;
        continue;
      }
      if (r.by === pr.a) {
        stats.selfReviews++;
        continue;
      }
      stats.humanReviews++;
      humanReviews.push(r);
    }
    pr._humanReviews = humanReviews;

    const distinctReviewers = new Set(humanReviews.map((r) => r.by));
    const inlineReceived = humanReviews.reduce((s, r) => s + (r.inline || 0), 0);
    pr._distinctReviewers = distinctReviewers.size;
    pr._inlineReceived = inlineReceived;

    // How much human scrutiny the org chose to spend on this change. A PR that
    // pulled in three reviewers and twenty inline comments was consequential;
    // one a bot auto-approved was not.
    const scrutiny = distinctReviewers.size + 0.5 * humanReviews.length + 0.25 * Math.min(inlineReceived, 24);
    const typeWeight = TYPE_WEIGHT[parsed.type] ?? 0.6;
    const trivialPenalty = pr._trivial ? 0.2 : 1;
    const breakingBonus = parsed.breaking ? 1.25 : 1;
    // sqrt keeps a single heavily-reviewed monster PR from dominating; the 0.25
    // floor means an unreviewed auto-merge still counts for a little.
    pr._consequence = typeWeight * trivialPenalty * breakingBonus * (0.25 + Math.sqrt(scrutiny));

    if (authorIsBot) {
      stats.botAuthored++;
      pr._botAuthored = true;
    } else {
      stats.humanPrs++;
      const p = person(pr.a);
      p.authored++;
      if (pr._trivial) p.authoredTrivial++;
      p.shippedWeight += pr._consequence;
      p.reviewsReceivedHuman += humanReviews.length;
      p.inlineReceived += inlineReceived;
      if (distinctReviewers.size === 0) p.autoApprovedOnly++;
      if (parsed.breaking) p.breaking++;
      p.churn.push((pr.add || 0) + (pr.del || 0));
      p.consequences.push(pr._consequence);
      p.types.set(parsed.type || 'other', (p.types.get(parsed.type || 'other') || 0) + 1);
      p.areaAuthored.set(pr._scope, (p.areaAuthored.get(pr._scope) || 0) + 1);
      if (!p.firstSeen || pr.merged < p.firstSeen) p.firstSeen = pr.merged;
      if (!p.lastSeen || pr.merged > p.lastSeen) p.lastSeen = pr.merged;

      const a = area(pr._scope);
      a.prs++;
      a.humans.add(pr.a);
    }
  }

  // Revert detection. Only the quoted form names the original PR, so only those
  // can be attributed to an author; the rest are counted repo-wide. At ~0.15%
  // of merges this is far too sparse to rank people on, so it is reported as
  // repo-level context rather than folded into anyone's score.
  let revertsMatched = 0;
  for (const rv of revertTitles) {
    const m = /^revert(?:\([^)]*\))?:?\s*"(.+)"\s*$/i.exec((rv.t || '').trim());
    if (!m) continue;
    const orig = titleToPr.get(m[1].trim());
    if (!orig || orig.n === rv.n || orig._botAuthored || !orig.a) continue;
    revertsMatched++;
    person(orig.a).reverted++;
    orig._reverted = rv.n;
  }

  // Pass 2: reviewer-side credit, area activity, collaboration edges.
  const edges = new Map(); // "author>reviewer" -> weight
  for (const pr of prs) {
    if (!pr.a) continue;
    const created = Date.parse(pr.created);
    const firstHuman = [...pr._humanReviews].sort((x, y) => Date.parse(x.at) - Date.parse(y.at))[0];
    const perReviewer = new Map();

    for (const r of pr._humanReviews) {
      const value = (REVIEW_BASE[r.state] ?? 0.4) * (1 + 0.15 * Math.min(r.inline || 0, 10));
      const p = person(r.by);
      p.reviewsGiven++;
      p.reviewValue += value;
      p.inlineGiven += r.inline || 0;
      if (r.state === 'CHANGES_REQUESTED') p.changesRequested++;
      if (r.state === 'APPROVED' && !(r.inline > 0)) p.approvalsOnly++;
      p.authorsHelped.set(pr.a, (p.authorsHelped.get(pr.a) || 0) + 1);
      p.areaActivity.set(pr._scope, (p.areaActivity.get(pr._scope) || 0) + value);
      if (!p.firstSeen || r.at < p.firstSeen) p.firstSeen = r.at;
      if (!p.lastSeen || r.at > p.lastSeen) p.lastSeen = r.at;

      perReviewer.set(r.by, (perReviewer.get(r.by) || 0) + value);

      if (!pr._botAuthored) area(pr._scope).activity += value;
    }

    // Response time uses only each reviewer's *first* review on a PR, so a long
    // back-and-forth doesn't look like a slow first response.
    const firstByReviewer = new Map();
    for (const r of pr._humanReviews) {
      const prev = firstByReviewer.get(r.by);
      if (!prev || Date.parse(r.at) < Date.parse(prev.at)) firstByReviewer.set(r.by, r);
    }
    for (const [login, r] of firstByReviewer) {
      const hours = (Date.parse(r.at) - created) / 3600000;
      if (Number.isFinite(hours) && hours >= 0 && hours < 24 * 30) person(login).responseHours.push(hours);
    }
    if (firstHuman) person(firstHuman.by).firstResponder++;

    for (const [reviewer, w] of perReviewer) {
      if (reviewer === pr.a) continue;
      const key = `${pr.a}>${reviewer}`;
      edges.set(key, (edges.get(key) || 0) + w);
    }

    // Authored consequence also counts as area activity.
    if (!pr._botAuthored) {
      const p = person(pr.a);
      p.areaActivity.set(pr._scope, (p.areaActivity.get(pr._scope) || 0) + pr._consequence);
      area(pr._scope).activity += pr._consequence;
    }
  }

  // Drop anyone the account resolver flagged as a bot but who slipped in via a
  // review edge before classification.
  for (const login of [...people.keys()]) {
    if (isBot(login)) people.delete(login);
  }

  // -------------------------------------------------------------------------
  // Area ownership
  // -------------------------------------------------------------------------
  for (const p of people.values()) {
    p.ownedAreas = [];
    for (const [scope, activity] of p.areaActivity) {
      const a = areas.get(scope);
      if (!a || a.activity <= 0) continue;
      const share = activity / a.activity;
      const authored = p.areaAuthored.get(scope) || 0;
      p.ownedAreas.push({
        scope,
        share: Math.round(share * 1000) / 1000,
        authored,
        areaPrs: a.prs,
        areaHumans: a.humans.size,
        loadBearing:
          share >= OWNERSHIP_MIN_SHARE &&
          a.prs >= AREA_MIN_TOTAL_PRS &&
          (authored >= OWNERSHIP_MIN_PRS_IN_AREA || share >= 0.3),
      });
    }
    p.ownedAreas.sort((x, y) => y.share * Math.log1p(y.areaPrs) - x.share * Math.log1p(x.areaPrs));
    // Owning a slice of a big, busy area counts more than owning a quiet corner.
    p.ownershipScore = p.ownedAreas
      .filter((a) => a.loadBearing)
      .reduce((s, a) => s + a.share * Math.log1p(a.areaPrs), 0);
    p.loadBearingAreas = p.ownedAreas.filter((a) => a.loadBearing).length;
  }

  // -------------------------------------------------------------------------
  // Qualifying population + pillar raws
  // -------------------------------------------------------------------------
  const active = [...people.values()].filter(
    (p) => p.authored >= MIN_AUTHORED || p.reviewsGiven >= MIN_REVIEWS
  );

  const reviewEdges = [];
  for (const [key, w] of edges) {
    const [from, to] = key.split('>');
    if (people.has(from) && people.has(to)) reviewEdges.push([from, to, w]);
  }
  const ranks = pagerank([...people.keys()], reviewEdges);

  for (const p of active) {
    p.distinctAuthorsHelped = p.authorsHelped.size;
    p.medianResponseHours = median(p.responseHours);
    p.centralityRaw = (ranks.get(p.login) || 0) * 1000;

    // Depth x breadth: you need both substantive reviews and a spread of
    // people to score well.
    p.leverageRaw = Math.sqrt(p.reviewValue) * Math.sqrt(p.distinctAuthorsHelped);

    const mh = p.medianResponseHours;
    p.speedRaw =
      p.reviewsGiven >= MIN_REVIEWS && mh !== null
        ? Math.sqrt(p.firstResponder) * (24 / (24 + mh))
        : 0;

    p.revertRate = p.authored ? p.reverted / p.authored : 0;
  }

  const pillars = [
    ['shipped', (p) => p.shippedWeight],
    ['leverage', (p) => p.leverageRaw],
    ['centrality', (p) => p.centralityRaw],
    ['ownership', (p) => p.ownershipScore],
    ['speed', (p) => p.speedRaw],
  ];

  for (const [key, get] of pillars) {
    const ranksArr = percentileRanks(active.map(get));
    active.forEach((p, i) => {
      p[`${key}Pct`] = ranksArr[i];
    });
  }

  for (const p of active) {
    p.composite =
      Math.round(
        pillars.reduce((s, [key]) => s + (DEFAULT_WEIGHTS[key] / 100) * p[`${key}Pct`], 0) * 10
      ) / 10;
  }

  active.sort((a, b) => b.composite - a.composite);

  // -------------------------------------------------------------------------
  // Evidence for the drilldown
  // -------------------------------------------------------------------------
  const byAuthorTopPrs = new Map();
  for (const pr of prs) {
    if (pr._botAuthored || !pr.a) continue;
    const list = byAuthorTopPrs.get(pr.a) || [];
    list.push(pr);
    byAuthorTopPrs.set(pr.a, list);
  }

  const from = fetchMeta.from || null;
  const to = fetchMeta.to || null;
  const searchBase = `${REPO_URL}/pulls?q=`;

  const EVIDENCE_FOR = Number(process.env.EVIDENCE_FOR || 30);
  const roster = active.map((p, rank) => {
    const wantEvidence = rank < EVIDENCE_FOR;
    const topPrs = wantEvidence
      ? (byAuthorTopPrs.get(p.login) || [])
          .slice()
          .sort((a, b) => b._consequence - a._consequence)
          .slice(0, 5)
          .map((pr) => ({
            n: pr.n,
            title: pr.t,
            url: `${REPO_URL}/pull/${pr.n}`,
            reviewers: pr._distinctReviewers,
            inline: pr._inlineReceived,
            scope: pr._scope,
            merged: pr.merged,
            consequence: Math.round(pr._consequence * 10) / 10,
          }))
      : [];

    const collaborators = wantEvidence
      ? [...p.authorsHelped.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([login, count]) => ({
            login,
            count,
            name: accounts[login]?.name || null,
          }))
      : [];

    return {
      login: p.login,
      name: p.name,
      avatar: p.avatar,
      composite: p.composite,
      pct: {
        shipped: p.shippedPct,
        leverage: p.leveragePct,
        centrality: p.centralityPct,
        ownership: p.ownershipPct,
        speed: p.speedPct,
      },
      raw: {
        authored: p.authored,
        authoredTrivial: p.authoredTrivial,
        shippedWeight: Math.round(p.shippedWeight * 10) / 10,
        reviewsReceived: p.reviewsReceivedHuman,
        inlineReceived: p.inlineReceived,
        autoApprovedOnly: p.autoApprovedOnly,
        reviewsGiven: p.reviewsGiven,
        reviewValue: Math.round(p.reviewValue * 10) / 10,
        inlineGiven: p.inlineGiven,
        changesRequested: p.changesRequested,
        approvalsOnly: p.approvalsOnly,
        authorsHelped: p.distinctAuthorsHelped,
        firstResponder: p.firstResponder,
        medianResponseHours:
          p.medianResponseHours === null ? null : Math.round(p.medianResponseHours * 10) / 10,
        loadBearingAreas: p.loadBearingAreas,
        ownershipScore: Math.round(p.ownershipScore * 100) / 100,
        centrality: Math.round(p.centralityRaw * 1000) / 1000,
        reverted: p.reverted,
        breaking: p.breaking,
        // Context so volume can be read against scrutiny: a leader can tell
        // "lots of lightly-reviewed PRs" from "fewer, heavily-scrutinised ones".
        reviewsPerPr: p.authored
          ? Math.round((p.reviewsReceivedHuman / p.authored) * 100) / 100
          : 0,
        zeroReviewPct: p.authored ? Math.round((p.autoApprovedOnly / p.authored) * 100) : 0,
        medianChurn: median(p.churn),
        medianConsequence: p.consequences.length
          ? Math.round(median(p.consequences) * 100) / 100
          : 0,
        shareOfHumanPrs: stats.humanPrs
          ? Math.round((p.authored / stats.humanPrs) * 1000) / 10
          : 0,
        types: Object.fromEntries([...p.types.entries()].sort((a, b) => b[1] - a[1])),
      },
      areas: p.ownedAreas.slice(0, 6).map((a) => ({
        scope: a.scope,
        share: a.share,
        authored: a.authored,
        areaPrs: a.areaPrs,
        areaHumans: a.areaHumans,
        loadBearing: a.loadBearing,
      })),
      topPrs,
      collaborators,
      links: {
        profile: `https://github.com/${p.login}`,
        authored: `${searchBase}${encodeURIComponent(
          `is:pr is:merged author:${p.login} merged:${from}..${to}`
        )}`,
        reviewed: `${searchBase}${encodeURIComponent(
          `is:pr is:merged reviewed-by:${p.login} merged:${from}..${to}`
        )}`,
      },
    };
  });

  const topAreas = [...areas.values()]
    .filter((a) => a.scope !== 'unscoped')
    .sort((x, y) => y.prs - x.prs)
    .slice(0, 20)
    .map((a) => ({ scope: a.scope, prs: a.prs, humans: a.humans.size }));

  const botList = Object.values(accounts)
    .filter((a) => a.isBot)
    .map((a) => ({ login: a.login, reason: a.botReason || 'automation' }));

  // Reviews-by-bot share, for the "why filtering matters" callout.
  const out = {
    meta: {
      repo: REPO,
      repoUrl: REPO_URL,
      from,
      to,
      windowDays: fetchMeta.windowDays ?? null,
      generatedAt: new Date().toISOString(),
      fetchedAt: fetchMeta.fetchedAt || null,
      defaultWeights: DEFAULT_WEIGHTS,
      thresholds: {
        minAuthored: MIN_AUTHORED,
        minReviews: MIN_REVIEWS,
        ownershipMinShare: OWNERSHIP_MIN_SHARE,
        ownershipMinPrsInArea: OWNERSHIP_MIN_PRS_IN_AREA,
        areaMinTotalPrs: AREA_MIN_TOTAL_PRS,
      },
      reviewBase: REVIEW_BASE,
      typeWeight: TYPE_WEIGHT,
    },
    stats: {
      mergedPrs: stats.uniquePrs,
      humanPrs: stats.humanPrs,
      botPrs: stats.botAuthored,
      totalReviews: stats.totalReviews,
      humanReviews: stats.humanReviews,
      botReviews: stats.botReviews,
      selfReviews: stats.selfReviews,
      conventionalPct: Math.round((stats.conventional / stats.uniquePrs) * 1000) / 10,
      scopedPct: Math.round((stats.scoped / stats.uniquePrs) * 1000) / 10,
      distinctAreas: areas.size,
      // Raw PageRank is unreadable on its own, so the UI expresses it as a
      // multiple of the median engineer.
      medianCentrality: Math.round(median(active.map((p) => p.centralityRaw)) * 1000) / 1000,
      revertPrs: revertTitles.length,
      prsWithNoHumanReview: prs.filter((p) => !p._botAuthored && p._distinctReviewers === 0).length,
      humansSeen: people.size,
      rankedEngineers: active.length,
      revertsMatched,
      botAccounts: botList.length,
      unresolvedAccounts: [...stats.unresolvedAccounts],
    },
    bots: botList.sort((a, b) => a.login.localeCompare(b.login)),
    topAreas,
    engineers: roster,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`Merged PRs: ${stats.uniquePrs} (${stats.humanPrs} human, ${stats.botAuthored} bot-authored)`);
  console.log(
    `Reviews: ${stats.totalReviews} total -> ${stats.humanReviews} human (${Math.round(
      (stats.botReviews / Math.max(stats.totalReviews, 1)) * 100
    )}% were bots)`
  );
  console.log(`Conventional titles: ${out.stats.conventionalPct}% | scoped: ${out.stats.scopedPct}% | areas: ${areas.size}`);
  console.log(`Humans: ${people.size} seen, ${active.length} ranked | reverts matched: ${revertsMatched}`);
  if (out.stats.unresolvedAccounts.length) {
    console.log(`WARNING unresolved accounts: ${out.stats.unresolvedAccounts.slice(0, 20).join(', ')}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, OUT)} (${kb} KB)\n`);
  console.log('Top 10:');
  for (const [i, e] of roster.slice(0, 10).entries()) {
    console.log(
      `${String(i + 1).padStart(2)}. ${String(e.composite).padStart(5)} ${e.login.padEnd(22)} ` +
        `authored=${String(e.raw.authored).padEnd(4)} revGiven=${String(e.raw.reviewsGiven).padEnd(4)} ` +
        `helped=${String(e.raw.authorsHelped).padEnd(4)} areas=${e.raw.loadBearingAreas} ` +
        `med=${e.raw.medianResponseHours}h`
    );
  }
}

main();
