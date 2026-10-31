#!/usr/bin/env node
'use strict';
/*
 * Storage Fleet Admin — optional central server for people who distribute Storage to other users.
 * Zero dependencies (Node >= 22.5, built-in node:sqlite). Collects ONLY what the app's opt-in telemetry sends:
 * anonymous install id (stored hashed), app version, macOS version, CPU arch, timestamps. No IPs are stored.
 *
 *   ADMIN_PASSWORD / ADMIN_USER   bootstrap the first admin (otherwise a one-time setup token is printed)
 *   PUBLISH_TOKEN                 bearer token for CI to publish releases (POST /api/v1/publish)
 *   PORT (4849) HOST (127.0.0.1)  TRUST_PROXY=1 behind a TLS proxy · SECURE_COOKIES=1 · RETENTION_DAYS (365)
 *   ADMIN_DB                      path of the SQLite file
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { cmp, valid } = require('../lib/semver');

const DAY = 864e5;
const PUB = path.join(__dirname, 'public'), SHARED = path.join(__dirname, '..', 'public');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DL_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const day = t => new Date(t).toISOString().slice(0, 10);
const tse = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createApp(opts = {}) {
  const env = { ...process.env, ...opts };
  const dbPath = env.ADMIN_DB || path.join(__dirname, 'data', 'fleet.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, first_seen INTEGER, last_seen INTEGER, version TEXT, os TEXT, arch TEXT, checkins INTEGER DEFAULT 0, notified_version TEXT, notified_at INTEGER);
    CREATE TABLE IF NOT EXISTS daily(day TEXT, device TEXT, PRIMARY KEY(day, device));
    CREATE TABLE IF NOT EXISTS version_history(device TEXT, version TEXT, t INTEGER);
    CREATE INDEX IF NOT EXISTS vh ON version_history(device, t);
    CREATE TABLE IF NOT EXISTS releases(version TEXT PRIMARY KEY, url TEXT, sha256 TEXT, size INTEGER, notes TEXT, min_supported TEXT, published_at INTEGER, rollout INTEGER DEFAULT 100, yanked INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, kind TEXT, audience TEXT, created_at INTEGER, expires_at INTEGER, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS notice_acks(notice_id INTEGER, device TEXT, t INTEGER, PRIMARY KEY(notice_id, device));
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE, salt TEXT, hash TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, admin_id INTEGER, csrf TEXT, expires_at INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, actor TEXT, action TEXT, detail TEXT, ip TEXT);`);
  const q = (sql, ...a) => db.prepare(sql).all(...a), q1 = (sql, ...a) => db.prepare(sql).get(...a), ex = (sql, ...a) => db.prepare(sql).run(...a);
  const setting = (k, v) => v === undefined ? q1('SELECT value FROM settings WHERE key=?', k)?.value : ex('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
  if (!setting('pepper')) setting('pepper', crypto.randomBytes(32).toString('hex'));
  const pepper = setting('pepper');
  const secure = env.SECURE_COOKIES === '1';
  const trust = env.TRUST_PROXY === '1';
  const retention = +env.RETENTION_DAYS || 365;
  const publishToken = env.PUBLISH_TOKEN || '';
  const now = () => Date.now();
  const ipOf = req => { const x = trust && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress; return sha(pepper + 'ip' + x).slice(0, 16); };
  const audit = (actor, action, detail, ip) => ex('INSERT INTO audit(t,actor,action,detail,ip) VALUES(?,?,?,?,?)', now(), actor, action, String(detail || '').slice(0, 300), ip || '');

  /* ---- rate limiting (in memory, sliding window) ---- */
  const hits = new Map();
  function limited(key, max, windowMs) {
    const t = now(), arr = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return true; }
    arr.push(t); hits.set(key, arr); if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 36e5) hits.delete(k);
    return false;
  }

  /* ---- passwords ---- */
  const hashPw = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k.toString('hex'))));
  const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
  const okPassword = pw => typeof pw === 'string' && pw.length >= 12 && pw.length <= 200 && /[a-zA-Z]/.test(pw) && /[^a-zA-Z]/.test(pw);
  async function createAdmin(username, pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    ex('INSERT INTO admins(username,salt,hash,created_at) VALUES(?,?,?,?)', username, salt, await hashPw(pw, salt), now());
  }
  let setupToken = '';
  const needsSetup = () => !q1('SELECT 1 x FROM admins LIMIT 1');
  async function bootstrap() {
    if (!needsSetup()) return;
    if (env.ADMIN_PASSWORD) { if (!okPassword(env.ADMIN_PASSWORD)) throw new Error('ADMIN_PASSWORD must be ≥12 chars with letters and non-letters'); await createAdmin(env.ADMIN_USER || 'admin', env.ADMIN_PASSWORD); audit('system', 'bootstrap', 'admin created from env'); }
    else { setupToken = crypto.randomBytes(12).toString('hex'); if (!opts.quiet) console.log(`\n  First run: open the admin page and create the admin account.\n  One-time setup token: ${setupToken}\n`); }
  }

  /* ---- sessions ---- */
  function parseCookies(req) { const o = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
  function session(req) {
    const tok = parseCookies(req).sid; if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
    const s = q1('SELECT s.*, a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id=?', sha(tok));
    if (!s || s.expires_at < now()) return null;
    ex('UPDATE sessions SET expires_at=? WHERE id=?', now() + 8 * 36e5, s.id); return s;
  }
  function startSession(res, adminId) {
    const tok = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(16).toString('hex');
    ex('INSERT INTO sessions VALUES(?,?,?,?,?)', sha(tok), adminId, csrf, now() + 8 * 36e5, now());
    return { csrf, cookie: `sid=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}` };
  }

  /* ---- fleet logic ---- */
  const bucket = id => parseInt(id.slice(0, 6), 16) % 100;
  const liveReleases = () => q('SELECT * FROM releases WHERE yanked=0').sort((a, b) => cmp(b.version, a.version));
  const latestPublished = () => liveReleases()[0] || null;
  const minSupported = () => liveReleases().reduce((m, r) => r.min_supported && valid(r.min_supported) && (!m || cmp(r.min_supported, m) > 0) ? r.min_supported : m, null);
  function statusFor(d, latest, min) {
    if (now() - d.last_seen > 30 * DAY) return 'stale';
    if (min && cmp(d.version, min) < 0) return 'unsupported';
    if (latest && cmp(d.version, latest.version) < 0) return 'outdated';
    return 'current';
  }
  function checkin(b, ip) {
    if (!b || b.v !== 1 || !UUID.test(b.installId || '') || !valid(b.version) || !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(b.os || '') || !['arm64', 'x86_64'].includes(b.arch)) return { code: 400, body: { error: 'invalid payload' } };
    const acks = Array.isArray(b.ackNotices) ? b.ackNotices.filter(n => Number.isInteger(n)).slice(0, 20) : [];
    const id = sha(pepper + b.installId), t = now();
    if (limited('dev:' + id, 30, DAY)) return { code: 429, body: { error: 'too many check-ins' } };
    const cur = q1('SELECT * FROM devices WHERE id=?', id);
    if (!cur) { ex('INSERT INTO devices(id,first_seen,last_seen,version,os,arch,checkins) VALUES(?,?,?,?,?,?,1)', id, t, t, b.version, b.os, b.arch); ex('INSERT INTO version_history VALUES(?,?,?)', id, b.version, t); }
    else { if (cur.version !== b.version) ex('INSERT INTO version_history VALUES(?,?,?)', id, b.version, t); ex('UPDATE devices SET last_seen=?, version=?, os=?, arch=?, checkins=checkins+1 WHERE id=?', t, b.version, b.os, b.arch, id); }
    ex('INSERT OR IGNORE INTO daily VALUES(?,?)', day(t), id);
    const elig = liveReleases().find(r => (r.rollout ?? 100) > bucket(id)) || null;
    const latest = elig && cmp(elig.version, b.version) > 0 ? elig : null;
    if (latest) { const d = q1('SELECT notified_version FROM devices WHERE id=?', id); if (d.notified_version !== latest.version) ex('UPDATE devices SET notified_version=?, notified_at=? WHERE id=?', latest.version, t, id); }
    const pub = latestPublished(), outdated = pub && cmp(b.version, pub.version) < 0;
    const notices = q('SELECT id,message,kind,audience FROM notices WHERE active=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY id DESC LIMIT 5', t).filter(n => n.audience === 'all' || outdated).map(n => ({ id: n.id, message: n.message, kind: n.kind }));
    acks.forEach(n => ex('INSERT OR IGNORE INTO notice_acks VALUES(?,?,?)', n, id, t));
    return { code: 200, body: { latest: latest ? { version: latest.version, url: latest.url, sha256: latest.sha256, size: latest.size, notes: latest.notes, publishedAt: new Date(latest.published_at).toISOString() } : null, minimum: minSupported(), notices, serverTime: t } };
  }
  function stats() {
    const t = now(), latest = latestPublished(), min = minSupported();
    const devs = q('SELECT * FROM devices');
    const active = n => q1('SELECT COUNT(DISTINCT device) c FROM daily WHERE day>=?', day(t - (n - 1) * DAY)).c;
    const statuses = { current: 0, outdated: 0, unsupported: 0, stale: 0 };
    const versions = {}, oses = {}, arches = {};
    devs.forEach(d => { statuses[statusFor(d, latest, min)]++; versions[d.version] = (versions[d.version] || 0) + 1; const m = d.os.split('.')[0]; oses[m] = (oses[m] || 0) + 1; arches[d.arch] = (arches[d.arch] || 0) + 1; });
    const series = []; for (let i = 29; i >= 0; i--) { const dd = day(t - i * DAY); series.push({ day: dd, active: q1('SELECT COUNT(*) c FROM daily WHERE day=?', dd).c, added: devs.filter(d => day(d.first_seen) === dd).length }); }
    const sort = o => Object.entries(o).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    return { total: devs.length, active1: active(1), active7: active(7), active30: active(30), new7: devs.filter(d => t - d.first_seen < 7 * DAY).length, new30: devs.filter(d => t - d.first_seen < 30 * DAY).length,
      latest: latest ? latest.version : null, minimum: min, statuses, versions: sort(versions).sort((a, b) => cmp(b.k, a.k)), os: sort(oses), arch: sort(arches), series };
  }
  function deviceRows({ status, qstr, limit = 50, offset = 0 }) {
    const latest = latestPublished(), min = minSupported();
    let rows = q('SELECT * FROM devices ORDER BY last_seen DESC').map(d => ({ id: d.id, short: d.id.slice(0, 10), version: d.version, os: d.os, arch: d.arch, firstSeen: d.first_seen, lastSeen: d.last_seen, checkins: d.checkins, notifiedVersion: d.notified_version, notifiedAt: d.notified_at, status: statusFor(d, latest, min) }));
    if (status) rows = rows.filter(r => r.status === status);
    if (qstr) rows = rows.filter(r => r.short.startsWith(qstr.toLowerCase()) || r.version.startsWith(qstr) || r.os.startsWith(qstr));
    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }
  function adoption(version) {
    const rel = q1('SELECT * FROM releases WHERE version=?', version); if (!rel) return null;
    const devs = q('SELECT * FROM devices').filter(d => now() - d.last_seen <= 30 * DAY);
    const updated = devs.filter(d => cmp(d.version, version) >= 0), pending = devs.filter(d => cmp(d.version, version) < 0);
    const times = updated.map(d => q1('SELECT MIN(t) t FROM version_history WHERE device=? AND version=?', d.id, version)?.t).filter(Boolean).map(t => (t - rel.published_at) / DAY).filter(x => x >= 0).sort((a, b) => a - b);
    return { version, publishedAt: rel.published_at, active: devs.length, updated: updated.length, medianDaysToUpdate: times.length ? +times[Math.floor(times.length / 2)].toFixed(1) : null,
      pending: pending.sort((a, b) => a.last_seen - b.last_seen).slice(0, 200).map(d => ({ short: d.id.slice(0, 10), version: d.version, os: d.os, lastSeen: d.last_seen, notifiedAt: d.notified_version === version ? d.notified_at : null })) };
  }
  function purge(days) {
    const cut = now() - days * DAY, ids = q('SELECT id FROM devices WHERE last_seen<?', cut).map(r => r.id);
    ids.forEach(id => { ex('DELETE FROM devices WHERE id=?', id); ex('DELETE FROM version_history WHERE device=?', id); ex('DELETE FROM notice_acks WHERE device=?', id); ex('DELETE FROM daily WHERE device=?', id); });
    ex('DELETE FROM daily WHERE day<?', day(now() - 400 * DAY)); ex('DELETE FROM sessions WHERE expires_at<?', now());
    return ids.length;
  }
  purge(retention);

  /* ---- http helpers ---- */
  const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
  const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...SEC, ...(secure ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}), ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  const readBody = (req, max) => new Promise((res, rej) => { let b = ''; req.on('data', d => { b += d; if (b.length > max) { req.destroy(); rej(Object.assign(new Error('too large'), { code: 413 })); } }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(Object.assign(new Error('bad json'), { code: 400 })); } }); });
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`).join(',')).join('\n');

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x'), p = url.pathname, ip = ipOf(req);
      if (p === '/healthz') return send(res, 200, { ok: true });

      /* ----- public device API ----- */
      if (req.method === 'POST' && p === '/api/v1/checkin') {
        if (limited('ip:' + ip, 300, 36e5)) return send(res, 429, { error: 'rate limited' });
        const r = checkin(await readBody(req, 4096), ip); return send(res, r.code, r.body);
      }
      if (req.method === 'POST' && p === '/api/v1/forget') {
        if (limited('ipf:' + ip, 20, 36e5)) return send(res, 429, { error: 'rate limited' });
        const b = await readBody(req, 1024); if (!UUID.test(b.installId || '')) return send(res, 400, { error: 'invalid payload' });
        const id = sha(pepper + b.installId); ['devices', 'version_history', 'notice_acks', 'daily'].forEach(t => ex(`DELETE FROM ${t} WHERE ${t === 'devices' ? 'id' : 'device'}=?`, id));
        audit('device', 'forget', id.slice(0, 10)); return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/v1/publish') {
        if (!publishToken || limited('pub:' + ip, 30, 36e5)) return send(res, publishToken ? 429 : 503, { error: publishToken ? 'rate limited' : 'publishing disabled' });
        const auth = String(req.headers.authorization || ''); if (!auth.startsWith('Bearer ') || !tse(auth.slice(7), publishToken)) { audit('ci', 'publish-denied', '', ip); return send(res, 401, { error: 'unauthorized' }); }
        const r = publish(await readBody(req, 16384), 'ci'); return send(res, r.code, r.body);
      }

      /* ----- admin auth ----- */
      if (req.method === 'GET' && p === '/api/admin/state') { const s = session(req); return send(res, 200, { needsSetup: needsSetup(), loggedIn: !!s, user: s?.username || null, csrf: s?.csrf || null }); }
      if (req.method === 'POST' && p === '/api/admin/setup') {
        if (!needsSetup()) return send(res, 409, { error: 'already set up' });
        if (limited('setup:' + ip, 10, 36e5)) return send(res, 429, { error: 'rate limited' });
        const b = await readBody(req, 2048);
        if (!setupToken || !tse(b.token || '', setupToken)) return send(res, 403, { error: 'invalid setup token' });
        if (!/^[a-zA-Z0-9._-]{3,40}$/.test(b.username || '') || !okPassword(b.password)) return send(res, 400, { error: 'username 3–40 chars; password ≥12 chars with letters and non-letters' });
        await createAdmin(b.username, b.password); setupToken = ''; audit(b.username, 'setup', '', ip); return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/admin/login') {
        if (limited('login:' + ip, 5, 15 * 60e3)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        const b = await readBody(req, 2048), u = q1('SELECT * FROM admins WHERE username=?', String(b.username || ''));
        const h = await hashPw(String(b.password || '').slice(0, 200), u ? u.salt : DUMMY_SALT);
        if (!u || !tse(h, u.hash)) { audit(String(b.username || '?').slice(0, 40), 'login-failed', '', ip); return send(res, 401, { error: 'Wrong username or password.' }); }
        const ss = startSession(res, u.id); audit(u.username, 'login', '', ip); return send(res, 200, { ok: true, csrf: ss.csrf }, undefined, { 'set-cookie': ss.cookie });
      }
      if (p.startsWith('/api/admin/')) {
        const s = session(req); if (!s) return send(res, 401, { error: 'not signed in' });
        if (limited('adm:' + s.id, 900, 60e3)) return send(res, 429, { error: 'slow down' });
        if (req.method !== 'GET') {
          const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'bad origin' });
          if (!tse(req.headers['x-csrf'] || '', s.csrf)) return send(res, 403, { error: 'bad csrf token' });
        }
        const actor = s.username;
        if (req.method === 'POST' && p === '/api/admin/logout') { ex('DELETE FROM sessions WHERE id=?', s.id); return send(res, 200, { ok: true }, undefined, { 'set-cookie': 'sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' }); }
        if (req.method === 'GET' && p === '/api/admin/stats') return send(res, 200, stats());
        if (req.method === 'GET' && p === '/api/admin/devices') return send(res, 200, deviceRows({ status: url.searchParams.get('status') || '', qstr: (url.searchParams.get('q') || '').slice(0, 40), limit: Math.min(200, +url.searchParams.get('limit') || 50), offset: +url.searchParams.get('offset') || 0 }));
        if (req.method === 'GET' && p === '/api/admin/devices.csv') { const r = deviceRows({ limit: 1e6 }).rows; audit(actor, 'export', r.length + ' devices', ip); return send(res, 200, csv([['id', 'version', 'os', 'arch', 'first_seen', 'last_seen', 'checkins', 'status'], ...r.map(d => [d.short, d.version, d.os, d.arch, new Date(d.firstSeen).toISOString(), new Date(d.lastSeen).toISOString(), d.checkins, d.status])]), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="devices.csv"' }); }
        if (req.method === 'POST' && p === '/api/admin/devices/delete') { const b = await readBody(req, 512); const row = q1('SELECT id FROM devices WHERE id LIKE ?', String(b.short || '').replace(/[^0-9a-f]/g, '') + '%'); if (!row || String(b.short).length < 10) return send(res, 404, { error: 'not found' }); ['devices', 'version_history', 'notice_acks', 'daily'].forEach(t => ex(`DELETE FROM ${t} WHERE ${t === 'devices' ? 'id' : 'device'}=?`, row.id)); audit(actor, 'device-delete', String(b.short), ip); return send(res, 200, { ok: true }); }
        if (req.method === 'GET' && p === '/api/admin/releases') return send(res, 200, { releases: q('SELECT * FROM releases').sort((a, b) => cmp(b.version, a.version)).map(r => ({ ...r, adoption: (() => { const a = adoption(r.version); return { updated: a.updated, active: a.active }; })() })) });
        if (req.method === 'GET' && p.startsWith('/api/admin/releases/') && p.endsWith('/adoption')) { const a = adoption(decodeURIComponent(p.split('/')[4])); return a ? send(res, 200, a) : send(res, 404, { error: 'not found' }); }
        if (req.method === 'POST' && p === '/api/admin/releases') { const r = publish(await readBody(req, 16384), actor, ip); return send(res, r.code, r.body); }
        if (req.method === 'POST' && p === '/api/admin/releases/update') {
          const b = await readBody(req, 512); if (!q1('SELECT 1 x FROM releases WHERE version=?', String(b.version))) return send(res, 404, { error: 'not found' });
          if (b.rollout !== undefined) { const r = Math.round(+b.rollout); if (!(r >= 0 && r <= 100)) return send(res, 400, { error: 'rollout 0–100' }); ex('UPDATE releases SET rollout=? WHERE version=?', r, b.version); audit(actor, 'rollout', `${b.version} → ${r}%`, ip); }
          if (b.yanked !== undefined) { ex('UPDATE releases SET yanked=? WHERE version=?', b.yanked ? 1 : 0, b.version); audit(actor, b.yanked ? 'yank' : 'unyank', b.version, ip); }
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && p === '/api/admin/notices') return send(res, 200, { notices: q('SELECT * FROM notices ORDER BY id DESC LIMIT 50').map(n => ({ ...n, delivered: q1('SELECT COUNT(*) c FROM notice_acks WHERE notice_id=?', n.id).c })) });
        if (req.method === 'POST' && p === '/api/admin/notices') {
          const b = await readBody(req, 2048), msg = String(b.message || '').trim();
          if (msg.length < 3 || msg.length > 280) return send(res, 400, { error: 'message must be 3–280 characters' });
          const kind = ['info', 'warn', 'critical'].includes(b.kind) ? b.kind : 'info', aud = b.audience === 'outdated' ? 'outdated' : 'all', days = Math.min(90, Math.max(1, +b.days || 14));
          ex('INSERT INTO notices(message,kind,audience,created_at,expires_at) VALUES(?,?,?,?,?)', msg, kind, aud, now(), now() + days * DAY); audit(actor, 'notice', msg.slice(0, 80), ip); return send(res, 200, { ok: true });
        }
        if (req.method === 'POST' && p === '/api/admin/notices/disable') { const b = await readBody(req, 128); ex('UPDATE notices SET active=0 WHERE id=?', +b.id | 0); audit(actor, 'notice-disable', String(b.id), ip); return send(res, 200, { ok: true }); }
        if (req.method === 'GET' && p === '/api/admin/audit') return send(res, 200, { rows: q('SELECT * FROM audit ORDER BY id DESC LIMIT ?', Math.min(500, +url.searchParams.get('limit') || 100)) });
        if (req.method === 'POST' && p === '/api/admin/purge') { const b = await readBody(req, 128), d = Math.max(30, Math.min(3650, +b.days || retention)); const n = purge(d); audit(actor, 'purge', `${n} devices unseen >${d}d`, ip); return send(res, 200, { removed: n }); }
        if (req.method === 'POST' && p === '/api/admin/password') {
          const b = await readBody(req, 2048), u = q1('SELECT * FROM admins WHERE username=?', actor);
          if (!tse(await hashPw(String(b.current || ''), u.salt), u.hash)) return send(res, 403, { error: 'current password is wrong' });
          if (!okPassword(b.password)) return send(res, 400, { error: 'new password must be ≥12 chars with letters and non-letters' });
          const salt = crypto.randomBytes(16).toString('hex'); ex('UPDATE admins SET salt=?, hash=? WHERE id=?', salt, await hashPw(b.password, salt), u.id);
          ex('DELETE FROM sessions WHERE admin_id=? AND id<>?', u.id, s.id); audit(actor, 'password-change', '', ip); return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'not found' });
      }

      /* ----- static ----- */
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      let file = p === '/' ? path.join(PUB, 'index.html') : p.startsWith('/shared/') ? path.join(SHARED, p.slice(8)) : path.join(PUB, p);
      const root = p.startsWith('/shared/') ? SHARED : PUB; file = path.normalize(file);
      if (!file.startsWith(root + path.sep) || !MIME[path.extname(file)] || (p.startsWith('/shared/') && !['style.css', 'logo.svg'].includes(path.basename(file)))) return send(res, 404, 'not found', 'text/plain');
      try { return send(res, 200, await fsp.readFile(file), MIME[path.extname(file)]); } catch { return send(res, 404, 'not found', 'text/plain'); }
    } catch (e) { return send(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code === 413 ? 'payload too large' : e.code === 400 ? 'bad json' : 'server error' }); }
  }
  function publish(b, actor, ip) {
    if (!valid(b.version)) return { code: 400, body: { error: 'invalid version' } };
    let u; try { u = new URL(String(b.url)); } catch { return { code: 400, body: { error: 'invalid url' } }; }
    const okHost = DL_HOSTS.includes(u.host) || (env.ALLOW_TEST_URLS === '1' && ['127.0.0.1', 'localhost'].includes(u.hostname));
    if (!okHost || !(u.protocol === 'https:' || env.ALLOW_TEST_URLS === '1')) return { code: 400, body: { error: 'download url must be an https GitHub release asset' } };
    if (!/^[0-9a-f]{64}$/.test(String(b.sha256 || '').toLowerCase())) return { code: 400, body: { error: 'sha256 (64 hex chars) is required' } };
    if (b.min_supported && !valid(b.min_supported)) return { code: 400, body: { error: 'invalid min_supported' } };
    const rollout = b.rollout === undefined ? 100 : Math.round(+b.rollout); if (!(rollout >= 0 && rollout <= 100)) return { code: 400, body: { error: 'rollout 0–100' } };
    ex(`INSERT INTO releases(version,url,sha256,size,notes,min_supported,published_at,rollout,yanked) VALUES(?,?,?,?,?,?,?,?,0)
        ON CONFLICT(version) DO UPDATE SET url=excluded.url, sha256=excluded.sha256, size=excluded.size, notes=excluded.notes, min_supported=excluded.min_supported, rollout=excluded.rollout`,
      b.version.replace(/^v/, ''), u.href, String(b.sha256).toLowerCase(), +b.size || 0, String(b.notes || '').slice(0, 4000), b.min_supported || null, now(), rollout);
    audit(actor, 'publish', `${b.version} @${rollout}%`, ip); return { code: 200, body: { ok: true, version: b.version.replace(/^v/, '') } };
  }
  return { handler, db, bootstrap, close: () => db.close(), _hits: hits, _setupToken: () => setupToken, stats, checkin, adoption };
}

module.exports = { createApp };

if (require.main === module) {
  const port = +process.env.PORT || 4849, host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.bootstrap().then(() => http.createServer(app.handler).listen(port, host, () => console.log(`Storage Fleet Admin on http://${host}:${port}`)))
    .catch(e => { console.error(e.message); process.exit(1); });
  setInterval(() => app.db.exec('DELETE FROM sessions WHERE expires_at < ' + Date.now()), 36e5).unref();
}
