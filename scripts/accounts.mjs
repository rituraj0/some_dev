// Resolves every distinct login seen in the PR data to a GitHub account type,
// display name and avatar.
//
// Why this exists: PostHog runs a lot of automation, and in the raw data the
// busiest "reviewers" are all machines (coderabbitai, stamphog, greptile-apps,
// the `posthog` org account...). Rather than maintain a guesswork deny-list, we
// ask GitHub what each account actually is:
//
//   type=User        -> human (unless it trips a bot-name pattern)
//   type=Organization-> GitHub App acting as an org (CodeRabbit, Codex, Copilot)
//   404              -> GitHub App / deleted account (stamphog, veria-ai)
//
// The result is cached so the analysis step stays offline and deterministic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const IN = path.join(CACHE_DIR, process.env.PRS_FILE || 'prs.ndjson');
const OUT = path.join(CACHE_DIR, 'accounts.json');

// Service accounts that pass as type=User but are clearly automation: near-zero
// public repos, no human name, and review volume no person could sustain.
const BOT_LOGINS = new Set([
  'greptile-apps',
  'parameterai',
  'posthog-bot',
  'stamphog',
  'veria-ai',
  'scheduled-actions-posthog',
  'inkeep-docs',
  'posthog',
]);

const BOT_PATTERNS = [
  /\[bot\]$/i,
  /-bot$/i,
  /^bot-/i,
  /^dependabot/i,
  /^renovate/i,
  /^snyk/i,
  /^sentry-io/i,
  /^github-actions/i,
  /^codecov/i,
  /^sourcery-ai/i,
  /^coderabbit/i,
  /^copilot/i,
  /^chatgpt-/i,
  /^devin-/i,
  /^cursor(ai)?-/i,
  /^scheduled-actions/i,
  /^graphite-app/i,
  /^ellipsis-dev/i,
  /^gitguardian/i,
  /^imgbot/i,
  /^pre-commit-ci/i,
];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksLikeBot(login) {
  if (BOT_LOGINS.has(login)) return true;
  return BOT_PATTERNS.some((re) => re.test(login));
}

async function resolve(login, attempt = 0) {
  const headers = { 'User-Agent': 'posthog-impact-dashboard', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = `bearer ${TOKEN}`;
  let res;
  try {
    res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers });
  } catch (err) {
    if (attempt > 5) return { login, type: 'Unknown', error: err.message };
    await sleep(1000 * 2 ** attempt);
    return resolve(login, attempt + 1);
  }
  if (res.status === 404) {
    // GitHub App or deleted account -> not a person.
    return { login, type: 'App', name: null, avatar: null };
  }
  if (res.status === 403 || res.status === 429) {
    if (attempt > 6) return { login, type: 'Unknown' };
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
    const wait = reset ? Math.max(reset - Date.now(), 1000) : 5000 * 2 ** attempt;
    await sleep(Math.min(wait, 60000));
    return resolve(login, attempt + 1);
  }
  if (!res.ok) {
    if (attempt > 5) return { login, type: 'Unknown' };
    await sleep(1000 * 2 ** attempt);
    return resolve(login, attempt + 1);
  }
  const d = await res.json();
  return {
    login,
    type: d.type || 'Unknown',
    name: d.name || null,
    avatar: d.avatar_url || null,
    publicRepos: d.public_repos ?? null,
    company: d.company || null,
  };
}

async function main() {
  if (!fs.existsSync(IN)) {
    console.error(`Missing ${IN}. Run "npm run fetch" first.`);
    process.exit(1);
  }

  const logins = new Set();
  for (const line of fs.readFileSync(IN, 'utf8').split('\n')) {
    if (!line) continue;
    let pr;
    try {
      pr = JSON.parse(line);
    } catch {
      continue;
    }
    if (pr.a) logins.add(pr.a);
    for (const r of pr.reviews || []) if (r.by) logins.add(r.by);
  }

  const cached = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const todo = [...logins].filter((l) => !cached[l]);
  console.log(`${logins.size} distinct logins, ${todo.length} to resolve`);

  const queue = [...todo];
  let done = 0;
  async function worker() {
    for (;;) {
      const login = queue.shift();
      if (!login) return;
      const info = await resolve(login);
      info.isBot = info.type !== 'User' || looksLikeBot(login);
      info.botReason =
        info.type === 'App'
          ? 'GitHub App (account does not exist as a user)'
          : info.type === 'Organization'
            ? 'Organization account used by a GitHub App'
            : looksLikeBot(login)
              ? 'Known automation / service account'
              : null;
      cached[login] = info;
      if (++done % 50 === 0) console.log(`  resolved ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));

  fs.writeFileSync(OUT, JSON.stringify(cached, null, 2));
  const bots = Object.values(cached).filter((a) => a.isBot);
  console.log(`\nResolved ${Object.keys(cached).length} accounts; ${bots.length} classified as automation.`);
  console.log('Automation accounts:', bots.map((b) => b.login).sort().join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
