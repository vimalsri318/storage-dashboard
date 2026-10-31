'use strict';
/*
 * Update + (opt-in) telemetry client.
 *
 *  - Update source: your admin server (if STORAGE_ADMIN_URL / fleet.config.json adminUrl is set AND the user opted in),
 *    otherwise the GitHub Releases of `updateRepo`. The GitHub check sends nothing but a normal HTTPS request.
 *  - Telemetry is OFF until the user opts in, and only ever sends the fields listed in payload().
 *  - Installing: downloads the release zip over HTTPS from an allow-listed host, verifies SHA-256, checks the bundle id
 *    and version, then swaps the app via scripts/apply-update.sh and relaunches ("restart to update").
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { cmp, valid, clean } = require('./semver');

const BUNDLE_ID = 'com.vimalsri318.storage';
const DL_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_ZIP = 120 * 1024 * 1024;
const HOUR = 36e5;

const sha256File = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, ...opts }, (e, so, se) => e ? rej(new Error((se || e.message).trim())) : res(so)));

function create({ dataDir, version, rootDir, appPath }) {
  const cfgFile = path.join(dataDir, 'config.json'), stFile = path.join(dataDir, 'update-state.json');
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const base = readJ(path.join(rootDir, 'fleet.config.json'), {});
  let cfg = { telemetry: 'unset', installId: '', ...readJ(cfgFile, {}) };
  let st = { latest: null, minimum: null, notices: [], acked: [], checkedAt: 0, source: null, error: null, ...readJ(stFile, {}) };
  const saveCfg = () => { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg)); } catch { /* ignore */ } };
  const saveSt = () => { try { fs.writeFileSync(stFile, JSON.stringify(st)); } catch { /* ignore */ } };
  if (!/^[0-9a-f-]{36}$/.test(cfg.installId)) { cfg.installId = crypto.randomUUID(); saveCfg(); }

  const adminUrl = () => {
    const u = process.env.STORAGE_ADMIN_URL || base.adminUrl || '';
    if (!u) return '';
    try { const x = new URL(u); const local = ['127.0.0.1', 'localhost'].includes(x.hostname); if (x.protocol === 'https:' || (local && x.protocol === 'http:')) return x.origin; } catch { /* fallthrough */ }
    return '';
  };
  const repo = () => process.env.STORAGE_UPDATE_REPO || base.updateRepo || '';
  const allowedHosts = () => { const s = new Set(DL_HOSTS); const a = adminUrl(); if (a) s.add(new URL(a).host); if (process.env.STORAGE_TEST_HOSTS) process.env.STORAGE_TEST_HOSTS.split(',').forEach(h => s.add(h)); return s; };

  async function macVersion() { try { return (await run('sw_vers', ['-productVersion'])).trim(); } catch { return '0'; } }
  /** Exactly what telemetry sends. Nothing about files, folders, sizes or your name. */
  async function payload() {
    return { v: 1, installId: cfg.installId, version, os: await macVersion(), arch: process.arch === 'arm64' ? 'arm64' : 'x86_64', ackNotices: st.acked.slice(-20) };
  }

  function setLatest(l) { st.latest = l && valid(l.version) ? l : null; }
  async function viaAdmin() {
    const res = await fetch(adminUrl() + '/api/v1/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await payload()), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('admin server answered ' + res.status);
    const j = await res.json();
    setLatest(j.latest); st.minimum = valid(j.minimum) ? j.minimum : null; st.notices = Array.isArray(j.notices) ? j.notices.slice(0, 5).map(n => ({ id: +n.id, message: String(n.message).slice(0, 300), kind: ['info', 'warn', 'critical'].includes(n.kind) ? n.kind : 'info' })) : [];
    st.acked = [...new Set([...st.acked, ...st.notices.map(n => n.id)])].slice(-50); st.source = 'admin';
  }
  async function viaGitHub() {
    const r = repo(); if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error('no update source configured');
    const res = await fetch(`https://api.github.com/repos/${r}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'storage-dashboard' }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) { setLatest(null); st.source = 'github'; return; }
    if (!res.ok) throw new Error('GitHub answered ' + res.status);
    const j = await res.json(), v = clean(String(j.tag_name || ''));
    const zip = (j.assets || []).find(a => /^Storage-.*\.zip$/.test(a.name)); const shaAsset = (j.assets || []).find(a => zip && a.name === zip.name + '.sha256');
    let sha = ((j.body || '').match(/sha-?256[:\s`]+([0-9a-f]{64})/i) || [])[1] || '';
    if (!sha && shaAsset) { try { sha = ((await (await fetch(shaAsset.browser_download_url, { signal: AbortSignal.timeout(10000) })).text()).match(/[0-9a-f]{64}/i) || [])[0] || ''; } catch { /* ignore */ } }
    setLatest(zip ? { version: v, url: zip.browser_download_url, sha256: sha.toLowerCase(), size: zip.size, notes: String(j.body || '').slice(0, 2000), publishedAt: j.published_at } : null);
    st.minimum = null; st.source = 'github';
  }
  let inflight = null;
  async function check({ force = false } = {}) {
    if (inflight) return inflight;
    if (!force && Date.now() - st.checkedAt < 5 * HOUR) return state();
    inflight = (async () => {
      try {
        if (cfg.telemetry === 'on' && adminUrl()) await viaAdmin(); else await viaGitHub();
        st.error = null;
      } catch (e) { st.error = String(e.message || e).slice(0, 200); }
      st.checkedAt = Date.now(); saveSt(); inflight = null; return state();
    })();
    return inflight;
  }

  function state() {
    const available = !!(st.latest && cmp(st.latest.version, version) > 0);
    const mandatory = !!(st.minimum && cmp(version, st.minimum) < 0);
    const a = adminUrl();
    return {
      version, appManaged: !!appPath, installId: cfg.installId.slice(0, 8),
      update: { available, mandatory, latest: available ? { version: st.latest.version, notes: st.latest.notes || '', publishedAt: st.latest.publishedAt || null, hasChecksum: !!st.latest.sha256 } : null, checkedAt: st.checkedAt, source: st.source, error: st.error, repo: repo() },
      notices: st.notices,
      telemetry: { mode: cfg.telemetry, adminConfigured: !!a, adminHost: a ? new URL(a).host : '' },
    };
  }
  async function setTelemetry(mode) {
    if (!['on', 'off'].includes(mode)) throw new Error('bad mode');
    cfg.telemetry = mode; saveCfg();
    if (mode === 'on') await check({ force: true });
    return state();
  }
  async function forget() {
    const a = adminUrl(); if (!a) return { ok: true };
    const res = await fetch(a + '/api/v1/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installId: cfg.installId }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('admin server answered ' + res.status);
    cfg.installId = crypto.randomUUID(); cfg.telemetry = 'off'; st.acked = []; st.notices = []; saveCfg(); saveSt(); return { ok: true };
  }

  async function download(url, dest) {
    let u = new URL(url); const hosts = allowedHosts();
    for (let hop = 0; hop < 5; hop++) {
      if (!(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) || !hosts.has(u.host)) throw new Error('download host not allowed: ' + u.host);
      const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(180000), headers: { 'user-agent': 'storage-dashboard' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) { u = new URL(res.headers.get('location'), u); continue; }
      if (!res.ok) throw new Error('download failed: ' + res.status);
      const len = +(res.headers.get('content-length') || 0); if (len > MAX_ZIP) throw new Error('download too large');
      let n = 0; const out = fs.createWriteStream(dest);
      for await (const chunk of res.body) { n += chunk.length; if (n > MAX_ZIP) { out.destroy(); throw new Error('download too large'); } if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); }
      await new Promise((r, j) => out.end(e => e ? j(e) : r())); return n;
    }
    throw new Error('too many redirects');
  }
  /** download → verify sha256 → unpack → check bundle id/version/signature. Returns the path of the verified new .app */
  async function prepare(latest) {
    if (!latest || !latest.sha256 || !/^[0-9a-f]{64}$/.test(latest.sha256)) throw new Error('This release has no SHA-256 checksum, so it cannot be installed automatically.');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'storage-update-')), zip = path.join(dir, 'Storage.zip');
    await download(latest.url, zip);
    const got = await sha256File(zip); if (got !== latest.sha256) throw new Error('Checksum mismatch — the download was rejected.');
    const out = path.join(dir, 'x'); await fsp.mkdir(out); await run('ditto', ['-x', '-k', zip, out]);
    const app = path.join(out, 'Storage.app'); const plist = path.join(app, 'Contents/Info.plist');
    const id = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])).trim();
    const ver = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])).trim();
    if (id !== BUNDLE_ID) throw new Error('Unexpected app in the download.');
    if (ver !== latest.version) throw new Error(`Version mismatch (${ver} ≠ ${latest.version}).`);
    await run('codesign', ['--verify', '--deep', '--strict', app]);
    return app;
  }
  async function install() {
    if (!appPath) throw new Error('Updates can be installed automatically only from the Storage app. Run `git pull` (or download the latest release).');
    const s = state(); if (!s.update.available) throw new Error('You are already up to date.');
    try { await fsp.access(path.dirname(appPath), fs.constants.W_OK); } catch { throw new Error('Storage.app is in a folder you cannot write to. Move it to ~/Applications.'); }
    const app = await prepare(st.latest);
    const script = path.join(rootDir, 'scripts/apply-update.sh');
    const child = spawn('/bin/zsh', [script, String(process.ppid), String(process.pid), app, appPath, process.env.STORAGE_UPDATE_NO_RELAUNCH ? '0' : '1'], { detached: true, stdio: 'ignore' });
    child.unref(); return { ok: true, restarting: true, version: st.latest.version };
  }
  return { check, state, setTelemetry, forget, install, prepare, payload, _setLatest: l => { st.latest = l; }, _hosts: allowedHosts };
}
module.exports = { create, sha256File, BUNDLE_ID };
