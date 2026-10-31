#!/usr/bin/env node
'use strict';
/*
 * Storage Dashboard — local-only server. Zero dependencies.
 *   node server.js            -> http://127.0.0.1:4747
 *
 * Safety model:
 *  - Binds to 127.0.0.1 only; Host header is checked (DNS-rebinding guard).
 *  - Every mutating request needs the per-run token that is embedded in the page.
 *  - /api/clean can only act on items the scanner itself produced (by id).
 *  - /api/trash (Explorer) moves things to the Trash and refuses protected locations.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const HOME = os.homedir();
const PORT = +process.env.PORT || 4747;
const HOST = '127.0.0.1';
const PUB = path.join(__dirname, 'public');
const DATA = process.env.STORAGE_DATA || path.join(__dirname, 'data');
const TOKEN = crypto.randomBytes(16).toString('hex');
const MIN_KB = 20 * 1024; // keep tree entries >= 20 MB
const SUGGEST_MIN_KB = 50 * 1024;
fs.mkdirSync(DATA, { recursive: true });

/* ---------- tiny helpers ---------- */
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { try { fs.writeFileSync(path.join(DATA, f), JSON.stringify(v)); } catch (e) { console.error('write failed', f, e.message); } };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const depth = p => p.slice(HOME.length).split('/').filter(Boolean).length;
const exists = async p => { try { await fsp.lstat(p); return true; } catch { return false; } };

function duKB(p) {
  return new Promise(r => execFile('du', ['-sk', '-x', p], { maxBuffer: 1 << 20, timeout: 180000 }, (_e, so) => {
    const m = /^(\d+)/.exec(so || ''); r(m ? +m[1] : 0);
  }));
}
function find(args, timeout = 240000) {
  return new Promise(r => execFile('find', args, { maxBuffer: 256 << 20, timeout }, (_e, so) => r((so || '').split('\n').filter(Boolean))));
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => null); }
  }));
  return out;
}
function disk() {
  let s; try { s = fs.statfsSync('/System/Volumes/Data'); } catch { s = fs.statfsSync('/'); }
  const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
  return { total, free, used: total - free };
}

/* ---------- persisted state ---------- */
let state = readJSON('scan.json', { finishedAt: 0, scanMs: 90000, tree: {}, suggestions: [] });
let history = readJSON('history.json', []);
let actions = readJSON('actions.json', []);
let scan = { running: false, phase: '', progress: 0, startedAt: 0, current: '', error: null };

function addHistory(force) {
  const d = disk(), last = history[history.length - 1], now = Date.now();
  if (!force && last && now - last.t < 5 * 60e3 && Math.abs(last.free - d.free) < 2e8) return;
  history.push({ t: now, free: d.free, used: d.used, total: d.total });
  if (history.length > 3000) history = history.filter((_, i) => i % 2 === 0 || i > history.length - 500);
  writeJSON('history.json', history);
}

/* ---------- categories (where does the space go) ---------- */
const CATS = [
  { name: 'Dev projects', color: '#0a84ff' },
  { name: 'Developer tools', color: '#ff9f0a' },
  { name: 'AI tools & models', color: '#bf5af2' },
  { name: 'Claude', color: '#30b0c7' },
  { name: 'Virtual machines', color: '#ff453a' },
  { name: 'Apps & app data', color: '#ff6482' },
  { name: 'Caches', color: '#ffd60a' },
  { name: 'Downloads & documents', color: '#30d158' },
  { name: 'Applications', color: '#5e5ce6' },
  { name: 'Anaconda & Homebrew', color: '#ac8e68' },
  { name: 'macOS & system', color: '#8e8e93' },
];
function categorize(p) {
  const rel = p.slice(HOME.length + 1);
  if (rel.startsWith('Downloads/Library/PROJECTS/')) return 'Dev projects';
  if (rel === 'Library/Application Support/Claude' || rel.startsWith('.claude')) return 'Claude';
  if (/^(Parallels|Library\/Parallels)/.test(rel) || rel === 'Library/Containers/com.docker.docker') return 'Virtual machines';
  if (rel === '.Trash') return 'macOS & system';
  if (/^\.(gemini|codeium|hermes|ollama|lmstudio|codex|trae|antigravity|agent-browser|config\/manicode)/.test(rel) ||
      /^Library\/Application Support\/(Antigravity|TRAE|fr\.my-monkey|com\.pais|Wispr|Comet)/.test(rel)) return 'AI tools & models';
  if (rel.startsWith('.') || /^Library\/(Android|Developer|pnpm|Unity)/.test(rel) ||
      /^Library\/Application Support\/(Code|Google\/AndroidStudio|Postman|pyinstaller)/.test(rel)) return 'Developer tools';
  if (rel.startsWith('Library/Caches') || rel.startsWith('Library/Logs')) return 'Caches';
  if (/^(Downloads|Desktop|Documents|Movies|Pictures|Music)(\/|$)/.test(rel)) return 'Downloads & documents';
  if (rel.startsWith('Library/')) return 'Apps & app data';
  return 'macOS & system';
}
const CONTAINERS = new Set([HOME, HOME + '/Library', HOME + '/Library/Application Support', HOME + '/Library/Containers',
  HOME + '/Downloads', HOME + '/Downloads/Library', HOME + '/Downloads/Library/PROJECTS']);
function childrenOf(tree, dir) {
  const pre = dir + '/', out = [];
  for (const p in tree) if (p.startsWith(pre) && !p.slice(pre.length).includes('/')) out.push(p);
  return out;
}
function computeOverview() {
  const tree = state.tree, d = disk(), leaves = [];
  (function expand(dir) {
    const kids = childrenOf(tree, dir); let sum = 0;
    for (const k of kids) { sum += tree[k]; if (CONTAINERS.has(k)) expand(k); else leaves.push({ path: k, kb: tree[k] }); }
    const rest = (tree[dir] || 0) - sum;
    if (rest > 0 && dir !== HOME) leaves.push({ path: dir, kb: rest, loose: true });
  })(HOME);
  const byCat = Object.fromEntries(CATS.map(c => [c.name, 0]));
  leaves.forEach(l => { l.category = l.loose ? categorize(l.path + '/x') : categorize(l.path); byCat[l.category] += l.kb; });
  const sys = state.sys || {};
  byCat['Applications'] = (sys['/Applications'] || 0);
  byCat['Anaconda & Homebrew'] = (sys['/opt'] || 0);
  const accounted = Object.values(byCat).reduce((a, b) => a + b, 0) * 1024;
  byCat['macOS & system'] += Math.max(0, d.used - accounted) / 1024;
  const top = leaves.filter(l => !l.loose).sort((a, b) => b.kb - a.kb).slice(0, 40).map(l => ({ ...l, name: path.basename(l.path) }));
  return { categories: CATS.map(c => ({ ...c, kb: Math.round(byCat[c.name]) })), top };
}

/* ---------- scanning ---------- */
function crawlDu(onTick) {
  return new Promise(resolve => {
    const out = {}; let buf = '', n = 0;
    const p = spawn('du', ['-k', '-x', '-d', '4', HOME], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const t = line.indexOf('\t'); if (t < 0) continue;
        const kb = +line.slice(0, t); if (kb >= MIN_KB) out[line.slice(t + 1)] = kb;
        if (++n % 3000 === 0) onTick(line.slice(t + 1));
      }
    });
    p.on('close', () => resolve(out));
  });
}

function findUp(dir, names, levels = 4) {
  return (async () => {
    let d = dir;
    for (let i = 0; i < levels; i++) {
      for (const n of names) if (await exists(path.join(d, n))) return path.join(d, n);
      const up = path.dirname(d); if (up === d || up.length < HOME.length) break; d = up;
    }
    return null;
  })();
}
async function latestMtime(files) {
  let m = 0; for (const f of files) { try { m = Math.max(m, (await fsp.stat(f)).mtimeMs); } catch { /* skip */ } } return m;
}

const ART = {
  node_modules: { label: 'node_modules', restore: dir => lockHint(dir) },
  '.next': { label: '.next build cache', restore: () => 'Rebuilt on the next `next dev` / `next build`.' },
  '.nuxt': { label: '.nuxt build cache', restore: () => 'Rebuilt on the next dev/build.' },
  '.turbo': { label: 'Turborepo cache', restore: () => 'Rebuilt on the next `turbo run`.' },
  '.parcel-cache': { label: 'Parcel cache', restore: () => 'Rebuilt automatically.' },
  '.svelte-kit': { label: 'SvelteKit cache', restore: () => 'Rebuilt on the next dev/build.' },
  '.angular': { label: 'Angular cache', restore: () => 'Rebuilt on the next build.' },
  Pods: { label: 'CocoaPods', restore: () => 'Run `pod install` in the ios folder.' },
  target: { label: 'Rust build output', restore: () => 'Rebuilt with `cargo build`.' },
  venv: { label: 'Python virtualenv', restore: () => 'Recreate: `python -m venv venv && pip install -r requirements.txt`.' },
  '.venv': { label: 'Python virtualenv', restore: () => 'Recreate: `python -m venv .venv && pip install -r requirements.txt`.' },
};
async function lockHint(dir) {
  const l = await findUp(dir, ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json']);
  const b = l ? path.basename(l) : '';
  const cmd = b === 'pnpm-lock.yaml' ? 'pnpm install' : b === 'yarn.lock' ? 'yarn' : b.startsWith('bun') ? 'bun install' : 'npm install';
  return `Reinstall any time with \`${cmd}\`.`;
}

async function findArtifacts() {
  const names = Object.keys(ART).concat(['DerivedData']);
  const prune = [HOME + '/Library', HOME + '/.Trash', HOME + '/Parallels', HOME + '/Applications', HOME + '/.*', '*/.git'];
  const args = [HOME, '-xdev', '-maxdepth', '9', '('];
  prune.forEach((p, i) => { if (i) args.push('-o'); args.push('-path', p); });
  args.push(')', '-prune', '-o', '-type', 'd', '(');
  names.forEach((n, i) => { if (i) args.push('-o'); args.push('-name', n); });
  args.push(')', '-print', '-prune');
  const found = await find(args);
  const ok = [];
  for (const p of found) {
    const n = path.basename(p), dir = path.dirname(p);
    if (n === 'target' && !(await exists(path.join(dir, 'Cargo.toml')))) continue;
    if ((n === 'venv' || n === '.venv') && !(await exists(path.join(p, 'pyvenv.cfg')))) continue;
    if (n === 'Pods' && !(await exists(path.join(dir, 'Podfile')))) continue;
    ok.push(p);
  }
  return ok;
}

async function artifactSuggestion(p) {
  const kb = await duKB(p); if (kb < SUGGEST_MIN_KB) return null;
  const n = path.basename(p), dir = path.dirname(p), meta = ART[n] || { label: n, restore: () => 'Regenerated by the tool that created it.' };
  const gitDir = await findUp(dir, ['.git']);
  const root = gitDir ? path.dirname(gitDir) : dir;
  const last = Math.max((await fsp.stat(p)).mtimeMs, await latestMtime([
    path.join(dir, 'package.json'), path.join(dir, 'Cargo.toml'), path.join(dir, 'requirements.txt'),
    gitDir ? path.join(gitDir, 'index') : '', gitDir ? path.join(gitDir, 'logs', 'HEAD') : '']));
  const idle = Math.floor((Date.now() - last) / 864e5);
  const proj = path.relative(path.dirname(root).startsWith(HOME) ? path.dirname(root) : HOME, dir) || path.basename(dir);
  return {
    id: sha(p), group: 'dev', kind: n, title: `${proj}`, label: meta.label, path: p, kb,
    risk: idle >= 14 ? 'safe' : 'review', method: 'rm', idleDays: idle, lastActive: last,
    reason: idle >= 14 ? `Project untouched for ${idle} days. Everything inside is regenerated on demand.`
      : `Project active ${idle === 0 ? 'today' : idle === 1 ? 'yesterday' : idle + ' days ago'} — you'd have to rebuild it next time you work on it.`,
    restore: await meta.restore(dir),
  };
}

const CACHE_RULES = [
  { label: 'npm cache', paths: ['.npm/_cacache'], risk: 'safe', reason: 'Downloaded packages npm keeps for speed. Re-downloaded as needed.', restore: 'Rebuilt automatically on your next `npm install`.' },
  { label: 'pnpm store', paths: ['Library/pnpm/store', '.local/share/pnpm/store'], risk: 'safe', reason: 'Shared package store. Projects with pnpm node_modules keep working (files are hard-linked).', restore: 'Refilled on your next `pnpm install`.' },
  { label: 'Yarn cache', paths: ['Library/Caches/Yarn', '.yarn/cache'], risk: 'safe', reason: 'Package download cache.', restore: 'Refilled on next install.' },
  { label: 'Python (uv) cache', paths: ['.cache/uv'], risk: 'safe', reason: 'Python package cache.', restore: 'Refilled on next `uv` / `pip` use.' },
  { label: 'pip cache', paths: ['Library/Caches/pip', '.cache/pip'], risk: 'safe', reason: 'Python package cache.', restore: 'Refilled on next `pip install`.' },
  { label: 'Homebrew downloads', paths: ['Library/Caches/Homebrew'], risk: 'safe', reason: 'Old bottles and downloads Homebrew no longer needs.', restore: 'Re-downloaded by `brew install` when needed.' },
  { label: 'Puppeteer browsers', paths: ['.cache/puppeteer'], risk: 'safe', reason: 'Chromium builds downloaded for Puppeteer.', restore: 'Re-downloaded when a project runs Puppeteer.' },
  { label: 'Playwright browsers', paths: ['Library/Caches/ms-playwright'], risk: 'safe', reason: 'Browser binaries for Playwright tests.', restore: 'Run `npx playwright install`.' },
  { label: 'Prisma engines', paths: ['.cache/prisma'], risk: 'safe', reason: 'Query-engine downloads.', restore: 'Re-downloaded by Prisma.' },
  { label: 'Hugging Face models', paths: ['.cache/huggingface'], risk: 'review', reason: 'Downloaded ML models. Anything that uses them will download them again.', restore: 'Re-downloaded on first use (needs internet).' },
  { label: 'Gradle caches', paths: ['.gradle/caches'], risk: 'safe', reason: 'Android/Java build caches.', restore: 'Rebuilt on the next Gradle build (slower first time).' },
  { label: 'Cargo registry', paths: ['.cargo/registry'], risk: 'safe', reason: 'Downloaded Rust crates.', restore: 'Re-downloaded on the next `cargo build`.' },
  { label: 'Xcode DerivedData', paths: ['Library/Developer/Xcode/DerivedData'], risk: 'safe', reason: 'Xcode build products and indexes.', restore: 'Rebuilt by Xcode.' },
  { label: 'Xcode device support', paths: ['Library/Developer/Xcode/iOS DeviceSupport'], risk: 'safe', reason: 'Symbols copied from devices you plugged in.', restore: 'Re-created when you connect the device.' },
  { label: 'Xcode archives', paths: ['Library/Developer/Xcode/Archives'], risk: 'review', reason: 'Old app archives. Keep the ones you may need to symbolicate or re-submit.', restore: 'Cannot be recreated — rebuild from source.' },
  { label: 'iOS Simulators', paths: ['Library/Developer/CoreSimulator/Devices'], risk: 'review', reason: 'Simulator devices and their app data.', restore: 'Xcode recreates devices; installed test apps are lost.' },
  { label: 'Simulator caches', paths: ['Library/Developer/CoreSimulator/Caches'], risk: 'safe', reason: 'Dyld and runtime caches.', restore: 'Rebuilt automatically.' },
  { label: 'Android SDK downloads', paths: ['Library/Android/sdk/.downloadIntermediates', 'Library/Android/sdk/.temp'], risk: 'safe', reason: 'Half-finished SDK downloads.', restore: 'SDK Manager re-downloads if needed.' },
  { label: 'Android emulators', paths: ['.android/avd'], risk: 'review', reason: 'Virtual devices and their data.', restore: 'Recreate in Android Studio Device Manager.' },
  { label: 'Unity package cache', paths: ['Library/Unity/cache'], risk: 'safe', reason: 'Downloaded Unity packages.', restore: 'Re-downloaded by Unity.' },
  { label: 'Chrome on-device AI model', paths: ['Library/Application Support/Google/Chrome/OptGuideOnDeviceModel'], risk: 'safe', reason: 'Chrome’s local AI model.', restore: 'Chrome downloads it again if it needs it.' },
  { label: 'Google updater cache', paths: ['Library/Application Support/Google/GoogleUpdater/crx_cache'], risk: 'safe', reason: 'Cached extension installers.', restore: 'Rebuilt automatically.' },
  { label: 'System logs (yours)', paths: ['Library/Logs'], risk: 'safe', reason: 'App and crash logs.', restore: 'Apps write new ones.' },
];
async function ruleSuggestions() {
  const jobs = [];
  CACHE_RULES.forEach(r => r.paths.forEach(rel => jobs.push({ r, p: path.join(HOME, rel) })));
  const res = await pool(jobs, 4, async ({ r, p }) => {
    if (!(await exists(p))) return null;
    const kb = await duKB(p); if (kb < SUGGEST_MIN_KB) return null;
    return { id: sha(p), group: 'cache', kind: 'cache', title: r.label, label: 'Cache', path: p, kb, risk: r.risk, method: 'rm', reason: r.reason, restore: r.restore };
  });
  const out = res.filter(Boolean);
  // any other big app cache folders
  const cdir = path.join(HOME, 'Library/Caches');
  let kids = []; try { kids = await fsp.readdir(cdir); } catch { /* ignore */ }
  const known = new Set(out.map(o => o.path));
  const extra = await pool(kids.map(k => path.join(cdir, k)).filter(p => !known.has(p)), 4, async p => {
    const kb = await duKB(p); if (kb < 300 * 1024) return null;
    return { id: sha(p), group: 'cache', kind: 'cache', title: 'App cache · ' + path.basename(p), label: 'App cache', path: p, kb, risk: 'safe', method: 'rm',
      reason: 'Cache kept by an app for speed. Apps rebuild it when they need it.', restore: 'Rebuilt automatically by the app.' };
  });
  out.push(...extra.filter(Boolean));
  // Trash
  const trash = path.join(HOME, '.Trash');
  if (await exists(trash)) {
    const kb = await duKB(trash);
    if (kb >= SUGGEST_MIN_KB) out.push({ id: sha(trash), group: 'trash', kind: 'trash', title: 'Empty the Trash', label: 'Trash', path: trash, kb, risk: 'review', method: 'emptytrash',
      reason: 'Things you already deleted but that still take space.', restore: 'Permanent — items cannot be recovered afterwards.' });
  }
  return out;
}

const DL_EXT = ['dmg', 'pkg', 'iso', 'aab', 'apk', 'ipa', 'zip', 'tar.gz', 'tgz', '7z', 'rar', 'exe', 'msi'];
async function fileSuggestions(skip) {
  const out = [];
  const dl = path.join(HOME, 'Downloads');
  const args = [dl, '-xdev', '-maxdepth', '3', '-path', dl + '/Library/PROJECTS', '-prune', '-o', '-type', 'f', '(' ];
  DL_EXT.forEach((e, i) => { if (i) args.push('-o'); args.push('-iname', '*.' + e); });
  args.push(')', '-size', '+30M', '-print');
  const installers = await find(args);
  for (const p of installers) {
    if (skip.has(p)) continue;
    let st; try { st = await fsp.lstat(p); } catch { continue; }
    const age = Math.floor((Date.now() - st.mtimeMs) / 864e5), kb = Math.round(st.blocks * 512 / 1024);
    const dup = / \(\d+\)\.[^.]+$/.test(p);
    out.push({ id: sha(p), group: 'downloads', kind: 'installer', title: path.basename(p), label: dup ? 'Duplicate download' : 'Installer / archive', path: p, kb,
      risk: 'review', method: 'trash', idleDays: age, lastActive: st.mtimeMs,
      reason: dup ? `Looks like a duplicate download (${age} days old).` : `Downloaded ${age} days ago. Installers are usually not needed once the app is installed.`,
      restore: 'Moved to Trash first, so you can put it back.' });
    skip.add(p);
  }
  const roots = ['Downloads', 'Desktop', 'Documents', 'Movies', 'Pictures', 'Music'].map(d => path.join(HOME, d));
  const big = [];
  for (const r of roots) {
    if (!(await exists(r))) continue;
    big.push(...await find([r, '-xdev', '-type', 'f', '-size', '+300M', '-not', '-path', '*/PROJECTS/*', '-not', '-path', '*.photoslibrary/*', '-not', '-path', '*/node_modules/*']));
  }
  for (const p of big) {
    if (skip.has(p)) continue;
    let st; try { st = await fsp.lstat(p); } catch { continue; }
    const age = Math.floor((Date.now() - st.mtimeMs) / 864e5), kb = Math.round(st.blocks * 512 / 1024);
    out.push({ id: sha(p), group: 'large', kind: 'file', title: path.basename(p), label: 'Large file', path: p, kb, risk: 'review', method: 'trash', idleDays: age, lastActive: st.mtimeMs,
      reason: `Large file, last modified ${age} days ago. Only you know if you still need it.`, restore: 'Moved to Trash first, so you can put it back.' });
  }
  return out;
}

async function runScan() {
  if (scan.running) return;
  scan = { running: true, phase: 'Mapping your disk', progress: 0.02, startedAt: Date.now(), current: '', error: null };
  const prev = state.scanMs || 90000;
  const tick = setInterval(() => { if (scan.phase === 'Mapping your disk') scan.progress = Math.min(0.55, 0.02 + (Date.now() - scan.startedAt) / prev * 0.5); }, 400);
  try {
    const tree = await crawlDu(c => { scan.current = c; });
    clearInterval(tick);
    const mapMs = Date.now() - scan.startedAt;
    scan.phase = 'Finding build folders'; scan.progress = 0.6;
    scan.phase = 'Measuring apps and system folders'; scan.progress = 0.57;
    const sysPaths = ['/Applications', '/opt', '/opt/anaconda3/pkgs', HOME + '/anaconda3/pkgs', HOME + '/miniconda3/pkgs'];
    const sysKb = await pool(sysPaths, 2, duKB);
    const sys = Object.fromEntries(sysPaths.map((p, i) => [p, sysKb[i] || 0]));
    scan.phase = 'Finding build folders'; scan.progress = 0.6;
    const arts = await findArtifacts();
    scan.phase = 'Measuring build folders'; scan.progress = 0.68;
    const artSugs = (await pool(arts, 6, artifactSuggestion)).filter(Boolean);
    scan.phase = 'Checking caches'; scan.progress = 0.82;
    const ruleSugs = await ruleSuggestions();
    scan.phase = 'Looking for old installers & big files'; scan.progress = 0.92;
    const skip = new Set();
    const fileSugs = await fileSuggestions(skip);
    const all = [...artSugs, ...ruleSugs, ...fileSugs].sort((a, b) => b.kb - a.kb);
    let looseDownloads = 0; try { looseDownloads = (await fsp.readdir(path.join(HOME, 'Downloads'))).length; } catch { /* ignore */ }
    state = { finishedAt: Date.now(), scanMs: Math.max(mapMs, 20000), tree, sys, looseDownloads, suggestions: all };
    writeJSON('scan.json', state);
    addHistory(true);
    scan = { ...scan, running: false, phase: 'Done', progress: 1 };
  } catch (e) {
    clearInterval(tick);
    scan = { ...scan, running: false, phase: 'Failed', error: String(e && e.message || e) };
  }
}

/* ---------- Explorer ---------- */
const dirCache = new Map();
async function dirInfo(p) {
  p = path.resolve(p);
  if (p !== HOME && !p.startsWith(HOME + '/')) throw new Error('Outside your home folder');
  const st = await fsp.lstat(p);
  if (!st.isDirectory()) throw new Error('Not a folder');
  const cached = dirCache.get(p);
  if (cached && Date.now() - cached.t < 5 * 60e3) return cached.v;
  let total, rows = [];
  const kidsFromTree = depth(p) <= 3 && state.tree[p] != null;
  if (kidsFromTree) {
    total = state.tree[p];
    rows = childrenOf(state.tree, p).map(k => ({ path: k, kb: state.tree[k], kind: 'dir' }));
  } else {
    const lines = await new Promise(r => execFile('du', ['-k', '-x', '-d', '1', p], { maxBuffer: 64 << 20, timeout: 180000 }, (_e, so) => r((so || '').split('\n').filter(Boolean))));
    for (const l of lines) {
      const t = l.indexOf('\t'); if (t < 0) continue;
      const kb = +l.slice(0, t), q = l.slice(t + 1);
      if (q === p) total = kb; else rows.push({ path: q, kb, kind: 'dir' });
    }
    rows = rows.filter(r => r.kb >= 1024);
  }
  let names = []; try { names = await fsp.readdir(p, { withFileTypes: true }); } catch { /* perms */ }
  const seen = new Set(rows.map(r => r.path));
  for (const e of names) {
    const q = path.join(p, e.name);
    if (e.isFile() && !e.isSymbolicLink()) {
      try { const s = await fsp.lstat(q); const kb = Math.round(s.blocks * 512 / 1024); if (kb >= 1024) rows.push({ path: q, kb, kind: 'file', mtime: s.mtimeMs }); } catch { /* skip */ }
    }
  }
  for (const r of rows) {
    r.name = path.basename(r.path);
    if (r.kind === 'dir' && !r.mtime) { try { r.mtime = (await fsp.lstat(r.path)).mtimeMs; } catch { /* skip */ } }
  }
  rows.sort((a, b) => b.kb - a.kb);
  rows = rows.slice(0, 80);
  if (total == null) total = rows.reduce((a, b) => a + b.kb, 0);
  const shown = rows.reduce((a, b) => a + b.kb, 0);
  const v = { path: p, parent: p === HOME ? null : path.dirname(p), totalKB: total, rows, otherKB: Math.max(0, total - shown), approx: kidsFromTree && !seen.size && false };
  dirCache.set(p, { t: Date.now(), v });
  return v;
}

/* ---------- deleting (always validated server-side) ---------- */
const DENY_SEG = new Set(['Keychains', 'Mobile Documents', '.ssh', '.gnupg', 'Mail', 'Messages', 'Safari', 'Preferences', 'Accounts', 'Cookies', 'iCloud']);
function assertDeletable(p, strict) {
  const rp = path.resolve(p);
  if (!rp.startsWith(HOME + '/')) throw new Error('Outside your home folder');
  const rel = rp.slice(HOME.length + 1).split('/');
  if (rel.length < 2) throw new Error('Top-level folders are protected');
  if (strict) {
    if (rel[0] === 'Library' && rel.length < 3) throw new Error('Protected system folder');
    if (rel[0] === 'Library' && rel[1] === 'Application Support' && rel.length < 4 && false) throw new Error('Protected');
    if (rel.some(s => DENY_SEG.has(s) || /\.photoslibrary$/i.test(s))) throw new Error('This location is protected');
    if (rel[0] === 'Downloads' && rel.length < 2) throw new Error('Protected');
  }
  if (rel.some(s => DENY_SEG.has(s) && (s === '.ssh' || s === '.gnupg' || s === 'Keychains' || s === 'Mobile Documents'))) throw new Error('This location is protected');
  return rp;
}
async function moveToTrash(p) {
  // Finder does the move: it keeps "Put Back" working and needs no Full Disk Access for ~/.Trash.
  const viaFinder = () => new Promise((res, rej) => execFile('osascript',
    ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', p],
    { timeout: 120000 }, (err, _so, se) => err ? rej(new Error((se || err.message).trim())) : res()));
  try { await viaFinder(); return; } catch (finderErr) {
    const trash = path.join(HOME, '.Trash');
    try {
      const base = path.basename(p); let dest = path.join(trash, base), n = 1;
      while (await exists(dest)) dest = path.join(trash, `${base} (${n++})`);
      await fsp.rename(p, dest);
    } catch (e) {
      throw new Error('Could not move to Trash. Allow this app to control Finder (System Settings › Privacy › Automation), or choose “Delete permanently”.');
    }
  }
}
function dropFromTree(p, kb) {
  const tree = state.tree;
  for (const k of Object.keys(tree)) if (k === p || k.startsWith(p + '/')) delete tree[k];
  let a = path.dirname(p);
  while (a.startsWith(HOME)) { if (tree[a] != null) tree[a] = Math.max(0, tree[a] - kb); if (a === HOME) break; a = path.dirname(a); }
  dirCache.clear();
}
async function cleanOne(s, mode) {
  const rp = assertDeletable(s.path, false);
  if (!(await exists(rp))) return { ok: true, note: 'already gone' };
  if (s.method === 'emptytrash') {
    for (const e of await fsp.readdir(rp)) await fsp.rm(path.join(rp, e), { recursive: true, force: true });
    return { ok: true };
  }
  const how = s.method === 'trash' && mode !== 'permanent' ? 'trash' : 'rm';
  if (how === 'trash') await moveToTrash(rp); else await fsp.rm(rp, { recursive: true, force: true });
  return { ok: true, how };
}

/* ---------- checklist (small tasks that actually free space) ---------- */
const tasksState = Object.assign({ done: {}, kept: {}, completed: [] }, readJSON('tasks.json', {}));
const saveTasks = () => writeJSON('tasks.json', tasksState);
const firstExisting = list => list.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
const CONDA = firstExisting(['/opt/anaconda3/bin/conda', HOME + '/anaconda3/bin/conda', HOME + '/miniconda3/bin/conda', '/opt/miniconda3/bin/conda']);
const BREW = firstExisting(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
const RUNNABLE = {
  conda: CONDA && { cmd: CONDA, args: ['clean', '--all', '-y'], label: 'conda clean --all' },
  brew: BREW && { cmd: BREW, args: ['cleanup', '--prune=all'], label: 'brew cleanup' },
  trash: { cmd: 'osascript', args: ['-e', 'tell application "Finder" to empty trash'], label: 'Empty Trash' },
};
const DAY = 864e5;

function suggestionTitle(s) {
  if (s.group === 'dev') return `Remove ${s.label} in ${s.title}`;
  if (s.group === 'cache') return s.title.startsWith('App cache · ') ? `Clear ${s.title.slice(12)} cache` : `Clear ${s.title}`;
  if (s.group === 'downloads') return `Delete installer “${s.title}”`;
  if (s.group === 'large') return `Decide on “${s.title}”`;
  return s.title;
}
function buildTasks() {
  const out = [], sg = state.suggestions || [], now = Date.now();
  const sum = a => a.reduce((x, y) => x + y.kb, 0);
  const safeBig = sg.filter(s => s.risk === 'safe' && s.kb >= 300 * 1024 && s.method !== 'emptytrash');
  const safeSmall = sg.filter(s => s.risk === 'safe' && s.kb < 300 * 1024 && s.method !== 'emptytrash');
  safeBig.forEach(s => out.push({ id: 's:' + s.id, type: 'auto', sids: [s.id], title: suggestionTitle(s), detail: s.reason, undo: s.restore, kb: s.kb, effort: '1 click', risk: 'safe', path: s.path }));
  if (safeSmall.length >= 2) out.push({ id: 'g:small:' + sha(safeSmall.map(s => s.id).join()), type: 'auto', sids: safeSmall.map(s => s.id), title: `Clear ${safeSmall.length} smaller caches`, detail: safeSmall.slice(0, 4).map(s => s.title.replace(/^App cache · /, '')).join(', ') + (safeSmall.length > 4 ? '…' : ''), undo: 'All of them rebuild themselves.', kb: sum(safeSmall), effort: '1 click', risk: 'safe' });
  else safeSmall.forEach(s => out.push({ id: 's:' + s.id, type: 'auto', sids: [s.id], title: suggestionTitle(s), detail: s.reason, undo: s.restore, kb: s.kb, effort: '1 click', risk: 'safe', path: s.path }));
  sg.filter(s => s.risk === 'review' && s.method !== 'emptytrash' && s.kb >= 150 * 1024 && !tasksState.kept['s:' + s.id])
    .forEach(s => out.push({ id: 'r:' + s.id, type: 'review', sids: [s.id], title: suggestionTitle(s), detail: s.reason, undo: s.restore, kb: s.kb, effort: 'Your call', risk: 'review', path: s.path, method: s.method, group: s.group }));
  // things only a command can clean
  const sys = state.sys || {}, condaKB = Math.max(sys['/opt/anaconda3/pkgs'] || 0, sys[HOME + '/anaconda3/pkgs'] || 0, sys[HOME + '/miniconda3/pkgs'] || 0);
  const manual = [];
  if (RUNNABLE.conda && condaKB > 500 * 1024) manual.push({ id: 'm:conda', run: 'conda', title: 'Clean the Anaconda package cache', detail: 'Removes downloaded package archives and unused packages. Your environments keep working.', undo: 'Packages re-download when an install needs them.', kb: condaKB, command: 'conda clean --all -y' });
  if (RUNNABLE.brew) manual.push({ id: 'm:brew', run: 'brew', title: 'Run Homebrew cleanup', detail: 'Deletes old versions of installed formulas and stale downloads.', undo: 'Only the latest installed versions remain, which is what brew uses anyway.', kb: 0, command: 'brew cleanup --prune=all' });
  const trashed = tasksState.trashedKB || 0;
  if (trashed > 50 * 1024) manual.push({ id: 'm:trash', run: 'trash', title: 'Empty the Trash', detail: 'Items you moved to Trash with this app only free space once the Trash is emptied.', undo: 'Permanent — you cannot get them back afterwards.', kb: trashed, command: '' });
  manual.forEach(m => { const d = tasksState.done[m.id]; if (d && now - d < 14 * DAY) return; if (tasksState.kept[m.id]) return; out.push({ ...m, type: 'manual', effort: m.run ? '1 click' : '1 min', risk: 'safe' }); });
  const looseDownloads = state.looseDownloads || 0;
  if (looseDownloads > 200 && !(tasksState.done['h:downloads'] && now - tasksState.done['h:downloads'] < 14 * DAY))
    out.push({ id: 'h:downloads', type: 'open', title: `Tidy up Downloads (${looseDownloads} loose items)`, detail: 'Delete what you no longer need and move the rest into folders. Open it in the Explorer to see the biggest items first.', undo: 'Items you remove go to the Trash.', kb: 0, effort: '5 min', risk: 'review', path: HOME + '/Downloads' });
  out.sort((a, b) => (a.risk === 'safe' ? 0 : 1) - (b.risk === 'safe' ? 0 : 1) || b.kb - a.kb);
  return out;
}
function markCompleted(id, title, kb) {
  tasksState.completed.push({ id, title, kb, t: Date.now() }); tasksState.completed = tasksState.completed.slice(-200);
  tasksState.done[id] = Date.now(); saveTasks();
}
async function runRunnable(key) {
  const r = RUNNABLE[key]; if (!r) throw new Error('Not available on this Mac');
  const before = disk().free;
  const env = { ...process.env, PATH: `${path.dirname(r.cmd)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin` };
  const { err, out } = await new Promise(res => execFile(r.cmd, r.args, { env, timeout: 15 * 60e3, maxBuffer: 8 << 20 }, (err, so, se) => res({ err, out: (so + '\n' + se).trim() })));
  if (err && key !== 'brew') throw new Error((out.split('\n').slice(-3).join(' ') || err.message).slice(0, 300));
  await new Promise(r2 => setTimeout(r2, 1200));
  const freedKB = Math.max(0, Math.round((disk().free - before) / 1024));
  if (key === 'trash') tasksState.trashedKB = 0;
  return { freedKB, output: out.split('\n').slice(-6).join('\n') };
}

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((res, rej) => {
  let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) { req.destroy(); rej(new Error('too large')); } });
  req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } });
});

function fullState() {
  const ov = state.finishedAt ? computeOverview() : { categories: [], top: [] };
  return {
    disk: disk(), scan: { ...scan, finishedAt: state.finishedAt }, categories: ov.categories, top: ov.top,
    suggestions: state.suggestions, history, actions: actions.slice(-200), home: HOME,
    tasks: buildTasks(), completed: tasksState.completed.slice(-60).reverse(), keptCount: Object.keys(tasksState.kept).length,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, { error: 'bad host' });
    const url = new URL(req.url, `http://${host}`);
    const isApi = url.pathname.startsWith('/api/');
    if (req.method === 'POST') {
      if (req.headers['x-token'] !== TOKEN) return send(res, 403, { error: 'bad token' });
    }
    if (!isApi) {
      let f = url.pathname === '/' ? '/index.html' : url.pathname;
      const fp = path.normalize(path.join(PUB, f));
      if (!fp.startsWith(PUB + path.sep)) return send(res, 404, 'not found', 'text/plain');
      let buf; try { buf = await fsp.readFile(fp); } catch { return send(res, 404, 'not found', 'text/plain'); }
      if (f === '/index.html') buf = buf.toString().replace('%%TOKEN%%', TOKEN);
      return send(res, 200, buf, MIME[path.extname(fp)] || 'application/octet-stream');
    }

    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, fullState());
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { disk: disk(), scan: { ...scan, finishedAt: state.finishedAt } });
    if (req.method === 'GET' && url.pathname === '/api/dir') {
      try { return send(res, 200, await dirInfo(url.searchParams.get('path') || HOME)); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/scan') { runScan(); return send(res, 200, { started: true }); }

    if (req.method === 'POST' && url.pathname === '/api/clean') {
      const { ids = [], mode = 'trash', taskId = null, taskTitle = '' } = await readBody(req);
      const byId = new Map(state.suggestions.map(s => [s.id, s]));
      const results = []; let freed = 0;
      for (const id of ids) {
        const s = byId.get(id);
        if (!s) { results.push({ id, ok: false, error: 'Unknown item — rescan first' }); continue; }
        try {
          const r = await cleanOne(s, mode);
          results.push({ id, ok: true, how: r.how || 'rm' });
          dropFromTree(s.path, s.kb);
          state.suggestions = state.suggestions.filter(x => x.id !== id);
          const how = r.how || 'rm';
          if (how === 'rm') freed += s.kb; else if (how === 'trash') tasksState.trashedKB = (tasksState.trashedKB || 0) + s.kb;
          actions.push({ t: Date.now(), title: s.title, label: s.label, path: s.path, kb: s.kb, how });
        } catch (e) { results.push({ id, ok: false, error: e.code === 'EPERM' || e.code === 'EACCES' ? 'Permission denied (macOS blocked it)' : e.message }); }
      }
      const okCount = results.filter(r => r.ok).length;
      if (taskId && okCount && okCount === results.length) markCompleted(taskId, String(taskTitle).slice(0, 120), freed || ids.reduce((a, i) => a + (byId.get(i)?.kb || 0), 0)); else saveTasks();
      writeJSON('scan.json', state); writeJSON('actions.json', actions); addHistory(true);
      return send(res, 200, { results, freedKB: freed, disk: disk() });
    }

    if (req.method === 'POST' && url.pathname === '/api/trash') {
      const { path: p } = await readBody(req);
      try {
        const rp = assertDeletable(p, true);
        const st = await fsp.lstat(rp);
        const kb = st.isDirectory() ? await duKB(rp) : Math.round(st.blocks * 512 / 1024);
        await moveToTrash(rp); dropFromTree(rp, kb);
        state.suggestions = state.suggestions.filter(s => s.path !== rp && !s.path.startsWith(rp + '/'));
        actions.push({ t: Date.now(), title: path.basename(rp), label: 'Explorer', path: rp, kb, how: 'trash' });
        writeJSON('scan.json', state); writeJSON('actions.json', actions); addHistory(true);
        return send(res, 200, { ok: true, kb });
      } catch (e) { return send(res, 400, { error: e.code === 'EPERM' || e.code === 'EACCES' ? 'Permission denied (macOS blocked it)' : e.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      const { path: p } = await readBody(req); const rp = path.resolve(p);
      if (rp !== HOME && !rp.startsWith(HOME + '/')) return send(res, 400, { error: 'Outside your home folder' });
      execFile('open', ['-R', rp], () => {}); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/widget') {
      const d = disk(), tasks = buildTasks(), sg = state.suggestions || [];
      const safeKB = sg.filter(s => s.risk === 'safe').reduce((a, s) => a + s.kb, 0);
      return send(res, 200, { free: d.free, total: d.total, used: d.used, safeKB, openTasks: tasks.length, topTask: tasks[0] ? { title: tasks[0].title, kb: tasks[0].kb } : null, scannedAt: state.finishedAt, updated: Date.now() });
    }
    if (req.method === 'POST' && url.pathname === '/api/task') {
      const { id, action, title = '', kb = 0 } = await readBody(req);
      if (typeof id !== 'string' || !/^[a-z]:[\w:.-]{1,60}$/i.test(id)) return send(res, 400, { error: 'bad id' });
      if (action === 'done') markCompleted(id, String(title).slice(0, 120), +kb || 0);
      else if (action === 'keep') { tasksState.kept[id] = Date.now(); saveTasks(); }
      else if (action === 'reset') { delete tasksState.kept[id]; delete tasksState.done[id]; saveTasks(); }
      else return send(res, 400, { error: 'bad action' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { key, taskId, title = '' } = await readBody(req);
      try {
        const r = await runRunnable(key);
        actions.push({ t: Date.now(), title: String(title).slice(0, 120) || key, label: 'Command', path: RUNNABLE[key].label, kb: r.freedKB, how: 'rm' });
        markCompleted(taskId || 'm:' + key, String(title).slice(0, 120) || key, r.freedKB);
        writeJSON('actions.json', actions); addHistory(true);
        return send(res, 200, { ...r, disk: disk() });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e && e.message || e) }); }
});

server.listen(PORT, HOST, () => {
  console.log(`Storage Dashboard running at http://${HOST}:${PORT}`);
  addHistory(true);
  setInterval(() => addHistory(false), 15 * 60e3);
  if (!state.finishedAt || Date.now() - state.finishedAt > 12 * 3600e3) runScan();
  if (process.argv.includes('--open')) execFile('open', [`http://${HOST}:${PORT}`], () => {});
});
