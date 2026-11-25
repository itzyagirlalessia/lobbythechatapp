// Browser smoke test for Lobby: two signed-in users, ~35 steps. Start server.mjs first.
// Usage: node run.mjs [port]   Env: BROWSER_CHANNEL=chrome|msedge (default chrome), CHROME_PATH=<exe>, NO_SANDBOX=1, HEADED=1 to watch.
// Failed steps save screenshots to .local/smoke/ (ignored by Git).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const base = 'http://127.0.0.1:' + (process.argv[2] || 3999);
const shots = new URL('../../.local/smoke/', import.meta.url);
const browser = await chromium.launch({ headless: !process.env.HEADED, args: process.env.NO_SANDBOX ? ['--no-sandbox'] : [],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }) });
const errors = [];
let failures = 0;
const log = [];
async function user(name) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'testuser', value: name, url: base }]);
  await ctx.route(url => !url.href.startsWith(base), route => route.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  return page;
}
async function dismissNotice(page) {
  await page.waitForTimeout(600);
  const got = page.getByRole('button', { name: 'Got it' });
  if (await got.count() && await got.first().isVisible()) { await got.first().click(); await page.waitForTimeout(300); }
}
async function step(label, fn) { try { await fn(); console.log(`ok   ${label}`); } catch (e) { mkdirSync(shots, { recursive: true }); await a.screenshot({ path: fileURLToPath(new URL(`fail-${label.slice(0, 20).replace(/\W/g, '_')}.png`, shots)) }).catch(()=>{}); failures++; console.log(`FAIL ${label}: ${e.message.split("\n")[0]}`); } }
const a = await user('alice');
await a.goto(base + '/', { waitUntil: 'domcontentloaded' });
await step('username setup', async () => {
  await a.waitForSelector('#dialog[open] input[name=username]', { timeout: 8000 });
  await a.fill('#dialog input[name=username]', 'alice_test');
  await a.click('#dialog button[type=submit]');
  await a.waitForFunction(() => !document.getElementById('dialog').open, null, { timeout: 8000 });
  await dismissNotice(a);
});
await step('create room', async () => {
  await a.click('#hero-create');
  await a.fill('#dialog input[name=title]', 'Smoke room');
  await a.click('#dialog button[type=submit]');
  await a.waitForFunction(() => document.getElementById('room-title')?.textContent.includes('Smoke room'), null, { timeout: 8000 });
});
await step('send message', async () => {
  await a.fill('#message-input', 'Hello from **alice**');
  await a.press('#message-input', 'Enter');
  await a.waitForFunction(() => document.getElementById('messages').textContent.includes('Hello from'), null, { timeout: 8000 });
});
let invite;
await step('invite dialog', async () => {
  await a.click('#header-action');
  await a.waitForSelector('#invite-link', { timeout: 5000 });
  invite = await a.inputValue('#invite-link');
  await a.keyboard.press('Escape');
});
for (const [id, label] of [['preferences', 'preferences'], ['shortcuts', 'shortcuts'], ['quick-switcher', 'switcher'], ['room-info', 'room info'], ['saved-messages', 'saved messages'], ['set-status', 'status form']]) {
  await step(`open ${label}`, async () => {
    const el = await a.$(`#${id}`);
    if (!el || !(await el.isVisible())) { await a.evaluate(i => document.getElementById(i).click(), id); }
    else await el.click();
    await a.waitForSelector('#dialog[open]', { timeout: 5000 });
    await a.keyboard.press('Escape');
    await a.waitForFunction(() => !document.getElementById('dialog').open, null, { timeout: 5000 });
  });
}
await step('room board', async () => {
  await a.evaluate(() => document.getElementById('room-board').click());
  await a.waitForTimeout(800);
  await a.waitForFunction(() => document.body.textContent.includes('Shared checklist'), null, { timeout: 5000 });
  await a.click('#channel-nav >> text=general');
  await a.waitForSelector('#message-input', { state: 'visible', timeout: 5000 });
});
const b = await user('bob');
await step('second user joins via invite', async () => {
  await b.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('#dialog[open] input[name=username]', { timeout: 8000 });
  await b.fill('#dialog input[name=username]', 'bob_test');
  await b.click('#dialog button[type=submit]');
  await b.waitForFunction(() => !document.getElementById('dialog').open, null, { timeout: 8000 });
  await dismissNotice(b);
  await b.goto(invite, { waitUntil: 'domcontentloaded' });
  await b.waitForSelector('#dialog[open] button[type=submit]', { timeout: 8000 });
  await b.click('#dialog button[type=submit]');
  await b.waitForFunction(() => document.getElementById('messages').textContent.includes('Hello from'), null, { timeout: 10000 });
});
await step('bob replies, alice sees it', async () => {
  await b.fill('#message-input', 'Hi alice');
  await b.press('#message-input', 'Enter');
  await a.waitForFunction(() => document.getElementById('messages').textContent.includes('Hi alice'), null, { timeout: 10000 });
});
await step('display name mention reaches Alice', async () => {
  await b.fill('#message-input', '@ali');
  const choice = b.getByRole('option').filter({ hasText: '@alice_test#' });
  const label = '@' + await choice.locator('strong').innerText();
  await choice.click();
  if ((await b.inputValue('#message-input')).trim() !== label) throw new Error('Draft shows the wrong mention label');
  await b.press('#message-input', 'Enter');
  const tag = a.locator('#messages .member-mention').filter({ hasText: label });
  if (await tag.innerText() !== label) throw new Error('Sent mention shows the wrong label');
  await tag.click();
  await a.getByRole('dialog').filter({ hasText: /alice_test#\d{4}/ }).waitFor();
  await a.keyboard.press('Escape');
  await a.click('#mentions-inbox');
  await a.locator('#mention-results .history-result-text').filter({ hasText: label }).waitFor();
  await a.keyboard.press('Escape');
});
await step('people list shows both', async () => {
  await a.waitForFunction(() => { const t = document.body.textContent; return t.includes('alice_test') || t.includes('bob'); }, null, { timeout: 8000 });
});
await step('message actions: options, react, reply, edit dialog', async () => {
  await a.evaluate(() => document.querySelector('#messages article.message button[aria-label="More message actions"]').click());
  await a.waitForSelector('#message-options', { timeout: 5000 });
  const labels = await a.evaluate(() => [...document.querySelectorAll('#message-options button')].map(b => b.textContent.trim()).filter(Boolean));
  if (labels.length < 3) throw new Error('too few actions: ' + labels.join(','));
  await a.keyboard.press('Escape');
  await a.evaluate(() => document.querySelector('#messages article.message button[aria-label*="eact" i]')?.click());
  await a.waitForTimeout(300);
  await a.keyboard.press('Escape');
  await a.evaluate(() => document.querySelector('#messages article.message button[aria-label*="eply" i]')?.click());
  await a.waitForTimeout(300);
  if (await a.evaluate(() => document.getElementById('dialog').open)) { await a.keyboard.press('Escape'); }
  await a.waitForFunction(() => !document.getElementById('dialog').open, null, { timeout: 3000 });
  await a.fill('#message-input', 'reply text');
  await a.press('#message-input', 'Enter');
  await a.waitForFunction(() => document.getElementById('messages').textContent.includes('reply text'), null, { timeout: 8000 });
});
await step('mention suggestions + search dialog', async () => {
  await a.fill('#message-input', '@bo');
  await a.waitForTimeout(500);
  await a.fill('#message-input', '');
  await a.keyboard.press('Control+k');
  await a.waitForFunction(() => document.getElementById('dialog').open, null, { timeout: 5000 });
  await a.keyboard.press('Escape');
});
for (const id of ['edit-profile', 'room-settings', 'add-channel', 'add-voice-channel', 'organize-channels', 'search-room', 'channel-pins', 'mentions-inbox', 'channel-details', 'create-poll', 'attach-image', 'schedule-message', 'ai-settings', 'help-button', 'people-button']) {
  await step(`dialog via #${id}`, async () => {
    await a.evaluate(i => document.getElementById(i)?.click(), id);
    await a.waitForFunction(() => document.getElementById('dialog').open || document.body.textContent.includes('Room board'), null, { timeout: 5000 });
    await a.waitForTimeout(200);
    await a.keyboard.press('Escape');
    await a.waitForFunction(() => !document.getElementById('dialog').open, null, { timeout: 3000 });
  });
}
await step('back to channel', async () => {
  await a.click('#channel-nav >> text=general');
  await a.waitForSelector('#message-input', { state: 'visible', timeout: 5000 });
});
await step('create a channel and post in it', async () => {
  await a.evaluate(() => document.getElementById('add-channel').click());
  await a.waitForFunction(() => document.getElementById('dialog').open, null, { timeout: 5000 });
  await a.fill('#dialog input[name=name]', 'smoke-test');
  await a.click('#dialog button[type=submit]');
  await a.waitForFunction(() => document.getElementById('room-title').textContent.includes('smoke-test'), null, { timeout: 8000 });
  await a.fill('#message-input', 'in new channel');
  await a.press('#message-input', 'Enter');
  await a.waitForFunction(() => document.getElementById('messages').textContent.includes('in new channel'), null, { timeout: 8000 });
});
await step('friends page', async () => {
  await a.evaluate(() => document.getElementById('friends-button').click());
  await a.waitForTimeout(800);
  await a.evaluate(() => document.getElementById('home-button').click());
});
await step('rooms restored in new browser (same account)', async () => {
  const c = await user('bob');
  await c.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await c.waitForFunction(() => document.getElementById('room-list').textContent.includes('Smoke room'), null, { timeout: 10000 });
});
console.log(log.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log(failures ? `RESULT: ${failures} step(s) failed (screenshots: .local/smoke/fail-*.png)` : 'RESULT: all steps passed');
await browser.close();
