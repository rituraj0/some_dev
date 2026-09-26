// Pulls every merged PR in PostHog/posthog for the analysis window, plus the
// review metadata we need, into .cache/prs.ndjson.
//
// Sharding: GitHub's search API caps any single query at 1000 results. PostHog
// merges ~250 PRs/day, so we shard one day at a time and stay well clear.
//
// We deliberately do NOT request `files` on each PR. PostHog titles are
// conventional-commit formatted (98.8% carry an explicit scope), so the scope
// gives us product area for free at ~4x lower GraphQL point cost.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const OUT = path.join(CACHE_DIR, process.env.OUT_FILE || 'prs.ndjson');
const META = path.join(CACHE_DIR, 'fetch-meta.json');

const REPO = 'PostHog/posthog';
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 90);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const PAGE_SIZE = 50;

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error(
    'Missing GITHUB_TOKEN.\n' +
      'Create a classic PAT with the `public_repo` scope and add it to .env.local:\n' +
      '  GITHUB_TOKEN=ghp_xxx\n'
  );
  process.exit(1);
}

const QUERY = `
query($q: String!, $cursor: String) {
  rateLimit { remaining cost resetAt }
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        createdAt
        mergedAt
        additions
        deletions
        changedFiles
        author { login }
        labels(first: 5) { nodes { name } }
        comments { totalCount }
        participants { totalCount }
        reviews(first: 20) {
          totalCount
          nodes {
            state
            submittedAt
            author { login }
            comments { totalCount }
          }
        }
      }
    }
  }
}`;

async function gql(variables, attempt = 0) {
  let res;
  try {
    res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'posthog-impact-dashboard',
      },
      body: JSON.stringify({ query: QUERY, variables }),
    });
  } catch (err) {
    if (attempt > 6) throw err;
    await sleep(2000 * 2 ** attempt);
    return gql(variables, attempt + 1);
  }

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    if (attempt > 6) throw new Error(`GitHub ${res.status}`);
    await sleep(2000 * 2 ** attempt);
    return gql(variables, attempt + 1);
  }

  if (res.status === 401 || res.status === 403) {
    const retryAfter = Number(res.headers.get('retry-after') || 0);
    const body = await res.text();
    if (res.status === 401) {
      throw new Error(`GITHUB_TOKEN rejected (401). Check the token in .env.local.`);
    }
    // Secondary rate limit / abuse detection: back off and retry.
    if (attempt > 8) throw new Error(`GitHub 403: ${body.slice(0, 200)}`);
    await sleep(Math.max(retryAfter * 1000, 5000 * 2 ** attempt));
    return gql(variables, attempt + 1);
  }

  const json = await res.json();

  if (json.errors) {
    const msg = json.errors.map((e) => e.message).join('; ');
    // Timeouts on heavy pages are transient.
    if (attempt <= 6 && /timeout|rate limit|try again|loading/i.test(msg)) {
      await sleep(3000 * 2 ** attempt);
      return gql(variables, attempt + 1);
    }
    throw new Error(`GraphQL: ${msg}`);
  }
  return json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dayShards(days) {
  // ONLY_DAYS backfills specific dates, e.g. a shard that failed on a previous
  // run: ONLY_DAYS=2026-07-28 APPEND=1 npm run fetch
  if (process.env.ONLY_DAYS) {
    return process.env.ONLY_DAYS.split(',')
      .map((d) => d.trim())
      .filter(Boolean);
  }
  // End the window at "today" (UTC) and walk backwards.
  const out = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(end.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

function flatten(pr) {
  if (!pr || !pr.number) return null;
  const reviews = (pr.reviews?.nodes || [])
    .filter((r) => r && r.author?.login)
    .map((r) => ({
      by: r.author.login,
      state: r.state,
      at: r.submittedAt,
      inline: r.comments?.totalCount ?? 0,
    }));
  return {
    n: pr.number,
    t: pr.title,
    a: pr.author?.login ?? null,
    created: pr.createdAt,
    merged: pr.mergedAt,
    add: pr.additions,
    del: pr.deletions,
    files: pr.changedFiles,
    labels: (pr.labels?.nodes || []).map((l) => l.name),
    comments: pr.comments?.totalCount ?? 0,
    participants: pr.participants?.totalCount ?? 0,
    reviewTotal: pr.reviews?.totalCount ?? 0,
    reviews,
  };
}

async function fetchDay(day, stats) {
  const q = `repo:${REPO} is:pr is:merged merged:${day}`;
  const rows = [];
  let cursor = null;
  let guard = 0;
  for (;;) {
    const data = await gql({ q, cursor });
    const s = data.search;
    for (const node of s.nodes) {
      const row = flatten(node);
      if (row) rows.push(row);
    }
    stats.rateRemaining = data.rateLimit?.remaining ?? stats.rateRemaining;
    if (!s.pageInfo.hasNextPage) break;
    cursor = s.pageInfo.endCursor;
    // search() hard-caps at 1000 results; bail out rather than loop forever.
    if (++guard >= 20) {
      stats.truncatedDays.push(day);
      break;
    }
  }
  return rows;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const shards = dayShards(WINDOW_DAYS);
  const stats = {
    repo: REPO,
    windowDays: WINDOW_DAYS,
    from: shards[0],
    to: shards[shards.length - 1],
    truncatedDays: [],
    rateRemaining: null,
    fetchedAt: new Date().toISOString(),
  };

  console.log(`Fetching ${REPO} merged PRs ${stats.from} -> ${stats.to} (${shards.length} daily shards)`);

  // Analysis dedupes by PR number, so appending a backfill is always safe.
  const append = process.env.APPEND === '1';
  const stream = fs.createWriteStream(OUT, { flags: append ? 'a' : 'w' });
  let done = 0;
  let total = 0;
  const started = Date.now();

  // Simple worker pool over the day shards.
  const queue = [...shards];
  async function worker() {
    for (;;) {
      const day = queue.shift();
      if (!day) return;
      try {
        const rows = await fetchDay(day, stats);
        for (const r of rows) stream.write(JSON.stringify(r) + '\n');
        total += rows.length;
        done++;
        if (done % 5 === 0 || done === shards.length) {
          const secs = ((Date.now() - started) / 1000).toFixed(0);
          console.log(
            `  ${done}/${shards.length} days | ${total} PRs | ${secs}s | rate remaining ${stats.rateRemaining}`
          );
        }
      } catch (err) {
        console.error(`  ! ${day}: ${err.message}`);
        stats.truncatedDays.push(day);
        done++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await new Promise((r) => stream.end(r));

  stats.prCount = total;

  if (append && fs.existsSync(META)) {
    // A backfill must not rewrite the window it was patching.
    const prev = JSON.parse(fs.readFileSync(META, 'utf8'));
    const stillFailing = new Set(stats.truncatedDays);
    prev.truncatedDays = (prev.truncatedDays || []).filter(
      (d) => !shards.includes(d) || stillFailing.has(d)
    );
    prev.prCount = (prev.prCount || 0) + total;
    prev.backfilled = [...(prev.backfilled || []), ...shards.filter((d) => !stillFailing.has(d))];
    fs.writeFileSync(META, JSON.stringify(prev, null, 2));
    console.log(`\nAppended ${total} PRs for ${shards.join(', ')}`);
    console.log(`Remaining days with issues: ${prev.truncatedDays.join(', ') || 'none'}`);
  } else {
    fs.writeFileSync(META, JSON.stringify(stats, null, 2));
    console.log(`\nWrote ${total} PRs to ${path.relative(ROOT, OUT)}`);
    if (stats.truncatedDays.length) {
      console.log(`Days with issues: ${stats.truncatedDays.join(', ')}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
