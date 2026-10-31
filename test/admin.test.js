'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), crypto = require('node:crypto');
const { createApp } = require('../admin/server');

async function boot(extra = {}) {
  const app = createApp({ ADMIN_DB: ':memory:', ADMIN_PASSWORD: 'correct-horse-9', PUBLISH_TOKEN: 'ci-secret-token', ALLOW_TEST_URLS: '1', quiet: true, ...extra });
  await app.bootstrap();
  const server = http.createServer(app.handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie, csrf, headers } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf': csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: r.status, json, headers: r.headers };
  };
  const login = async () => { const r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'correct-horse-9' } }); return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.json.csrf }; };
  return { app, call, login, close: () => { server.close(); app.close(); } };
}
const payload = (o = {}) => ({ v: 1, installId: crypto.randomUUID(), version: '1.0.0', os: '15.1', arch: 'arm64', ackNotices: [], ...o });
const sha = 'a'.repeat(64);
const rel = (o = {}) => ({ version: '1.1.0', url: 'https://github.com/x/y/releases/download/v1.1.0/Storage-1.1.0.zip', sha256: sha, size: 1000, notes: 'notes', ...o });

test('rejects malformed check-ins', async () => {
  const t = await boot();
  for (const bad of [{}, payload({ installId: 'nope' }), payload({ version: 'x' }), payload({ arch: 'mips' }), payload({ os: '../../etc' }), payload({ v: 2 })]) assert.equal((await t.call('POST', '/api/v1/checkin', { body: bad })).status, 400);
  t.close();
});
test('check-in registers a device and never stores the raw install id', async () => {
  const t = await boot(); const p = payload();
  const r = await t.call('POST', '/api/v1/checkin', { body: p }); assert.equal(r.status, 200); assert.equal(r.json.latest, null);
  const row = t.app.db.prepare('SELECT * FROM devices').get(); assert.notEqual(row.id, p.installId); assert.equal(row.id.length, 64);
  assert.ok(!JSON.stringify(t.app.db.prepare('SELECT * FROM audit').all()).includes(p.installId));
  t.close();
});
test('publishing needs the CI token and a https GitHub asset + checksum', async () => {
  const t = await boot();
  assert.equal((await t.call('POST', '/api/v1/publish', { body: rel() })).status, 401);
  assert.equal((await t.call('POST', '/api/v1/publish', { body: rel(), headers: { authorization: 'Bearer wrong' } })).status, 401);
  const h = { authorization: 'Bearer ci-secret-token' };
  assert.equal((await t.call('POST', '/api/v1/publish', { body: rel({ url: 'https://evil.example/x.zip' }), headers: h })).status, 400);
  assert.equal((await t.call('POST', '/api/v1/publish', { body: rel({ sha256: 'zz' }), headers: h })).status, 400);
  assert.equal((await t.call('POST', '/api/v1/publish', { body: rel(), headers: h })).status, 200);
  t.close();
});
test('devices on older versions are told to update; status and adoption are tracked', async () => {
  const t = await boot(); const h = { authorization: 'Bearer ci-secret-token' };
  const old = payload(), cur = payload({ version: '1.1.0' });
  await t.call('POST', '/api/v1/checkin', { body: old }); await t.call('POST', '/api/v1/checkin', { body: cur });
  await t.call('POST', '/api/v1/publish', { body: rel({ min_supported: '1.0.0' }), headers: h });
  const r = await t.call('POST', '/api/v1/checkin', { body: old }); assert.equal(r.json.latest.version, '1.1.0'); assert.equal((await t.call('POST', '/api/v1/checkin', { body: cur })).json.latest, null);
  const s = t.app.stats(); assert.equal(s.statuses.outdated, 1); assert.equal(s.statuses.current, 1); assert.equal(s.total, 2);
  const a = t.app.adoption('1.1.0'); assert.equal(a.updated, 1); assert.equal(a.pending.length, 1); assert.ok(a.pending[0].notifiedAt);
  t.close();
});
test('rollout percentage limits who is offered the update', async () => {
  const t = await boot(); const h = { authorization: 'Bearer ci-secret-token' };
  await t.call('POST', '/api/v1/publish', { body: rel({ rollout: 0 }), headers: h });
  assert.equal((await t.call('POST', '/api/v1/checkin', { body: payload() })).json.latest, null);
  t.app.db.prepare('UPDATE releases SET rollout=100').run();
  assert.equal((await t.call('POST', '/api/v1/checkin', { body: payload() })).json.latest.version, '1.1.0');
  t.close();
});
test('notices are delivered, acknowledged and audience-filtered', async () => {
  const t = await boot(); const { cookie, csrf } = await t.login(), h = { authorization: 'Bearer ci-secret-token' };
  await t.call('POST', '/api/v1/publish', { body: rel(), headers: h });
  await t.call('POST', '/api/admin/notices', { cookie, csrf, body: { message: 'Please update to 1.1.0 — restart to apply', kind: 'warn', audience: 'outdated' } });
  const old = payload(); const r = await t.call('POST', '/api/v1/checkin', { body: old }); assert.equal(r.json.notices.length, 1);
  assert.equal((await t.call('POST', '/api/v1/checkin', { body: payload({ version: '1.1.0' }) })).json.notices.length, 0);
  await t.call('POST', '/api/v1/checkin', { body: { ...old, ackNotices: [r.json.notices[0].id] } });
  assert.equal((await t.call('GET', '/api/admin/notices', { cookie })).json.notices[0].delivered, 1);
  t.close();
});
test('admin API needs a session, and writes need the CSRF token', async () => {
  const t = await boot();
  assert.equal((await t.call('GET', '/api/admin/stats')).status, 401);
  const { cookie, csrf } = await t.login();
  assert.equal((await t.call('GET', '/api/admin/stats', { cookie })).status, 200);
  assert.equal((await t.call('POST', '/api/admin/notices', { cookie, body: { message: 'hello world' } })).status, 403);
  assert.equal((await t.call('POST', '/api/admin/notices', { cookie, csrf: 'bad', body: { message: 'hello world' } })).status, 403);
  assert.equal((await t.call('POST', '/api/admin/notices', { cookie, csrf, headers: { origin: 'https://evil.example' }, body: { message: 'hello world' } })).status, 403);
  assert.equal((await t.call('POST', '/api/admin/notices', { cookie, csrf, body: { message: 'hello world' } })).status, 200);
  t.close();
});
test('login is rate limited and failures are audited', async () => {
  const t = await boot(); let last;
  for (let i = 0; i < 6; i++) last = await t.call('POST', '/api/admin/login', { body: { username: 'admin', password: 'wrong-password-1' } });
  assert.equal(last.status, 429);
  assert.ok(t.app.db.prepare("SELECT COUNT(*) c FROM audit WHERE action='login-failed'").get().c >= 5);
  t.close();
});
test('sessions cookie is HttpOnly + SameSite=Strict; security headers are set', async () => {
  const t = await boot(); const r = await t.call('POST', '/api/admin/login', { body: { username: 'admin', password: 'correct-horse-9' } });
  const c = r.headers.get('set-cookie'); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(r.headers.get('x-frame-options'), 'DENY');
  t.close();
});
test('first-run setup needs the one-time token and a strong password', async () => {
  const t = await boot({ ADMIN_PASSWORD: '' }); const tok = t.app._setupToken(); assert.ok(tok);
  assert.equal((await t.call('POST', '/api/admin/setup', { body: { token: 'wrong', username: 'boss', password: 'a-strong-password-1' } })).status, 403);
  assert.equal((await t.call('POST', '/api/admin/setup', { body: { token: tok, username: 'boss', password: 'short' } })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/setup', { body: { token: tok, username: 'boss', password: 'a-strong-password-1' } })).status, 200);
  assert.equal((await t.call('POST', '/api/admin/setup', { body: { token: tok, username: 'x2', password: 'a-strong-password-1' } })).status, 409);
  t.close();
});
test('forget deletes a device and its history', async () => {
  const t = await boot(); const p = payload(); await t.call('POST', '/api/v1/checkin', { body: p });
  assert.equal((await t.call('POST', '/api/v1/forget', { body: { installId: p.installId } })).status, 200);
  assert.equal(t.app.db.prepare('SELECT COUNT(*) c FROM devices').get().c, 0); assert.equal(t.app.db.prepare('SELECT COUNT(*) c FROM daily').get().c, 0);
  t.close();
});
test('static files cannot escape the public folder', async () => {
  const t = await boot();
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/shared/../server.js', '/shared/app.js']) assert.ok([403, 404].includes((await t.call('GET', p)).status));
  assert.equal((await t.call('GET', '/healthz')).status, 200);
  t.close();
});
