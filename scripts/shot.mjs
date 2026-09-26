// Renders the built dashboard in Chromium and reports layout/console problems.
// Used to verify the "fits on one laptop screen, no page scroll" requirement.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'out');
const SHOTS = path.join(ROOT, '.cache', 'shots');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(OUT_DIR, p);
  if (!file.startsWith(OUT_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const PORT = 4321;
await new Promise((r) => server.listen(PORT, r));

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const [name, width, height] of [
  ['laptop-1440x900', 1440, 900],
  ['laptop-1280x800', 1280, 800],
  ['large-1728x1080', 1728, 1080],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));

  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  const loadMs = Date.now() - t0;

  const metrics = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    cards: document.querySelectorAll('ol > li').length,
  }));

  const vScroll = metrics.scrollH - metrics.clientH;
  const hScroll = metrics.scrollW - metrics.clientW;
  if (vScroll > 2) problems.push(`[${name}] page scrolls vertically by ${vScroll}px`);
  if (hScroll > 2) problems.push(`[${name}] page scrolls horizontally by ${hScroll}px`);

  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(
    `${name}: load ${loadMs}ms | cards ${metrics.cards} | vScroll ${vScroll}px | hScroll ${hScroll}px`
  );
  await page.close();
}

// Interaction smoke test at laptop size.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => problems.push(`[interact] pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[interact] console: ${m.text()}`);
});
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

const before = await page.locator('ol > li').first().innerText();

await page.getByRole('button', { name: 'Define impact' }).click();
await page.getByRole('button', { name: /Force multiplier/ }).first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(SHOTS, 'interact-force-multiplier.png') });
const after = await page.locator('ol > li').first().innerText();
if (before.split('\n')[0] === after.split('\n')[0]) {
  console.log('note: #1 unchanged by preset (may be legitimate)');
}
console.log(`reweight: #1 "${before.split('@')[1]?.split('\n')[0]}" -> "${after.split('@')[1]?.split('\n')[0]}"`);

await page.getByRole('button', { name: /All \d+ engineers/ }).click();
await page.waitForTimeout(200);
const rows = await page.locator('tbody tr').count();
console.log(`roster rows: ${rows}`);
await page.screenshot({ path: path.join(SHOTS, 'interact-roster.png') });

await page.getByRole('button', { name: /^Why / }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOTS, 'interact-why.png') });

await page.getByRole('button', { name: 'How this is calculated' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, 'interact-methodology.png') });

await browser.close();
server.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\nNo layout or console problems.');
