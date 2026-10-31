'use strict';
/* Storage dashboard front-end. No libraries. All text goes through textContent (file names are untrusted). */
const TOKEN = window.__TOKEN__;
const S = { st: null, page: 'overview', filter: 'all', sel: new Set(), dir: null, dirPath: null, range: '7d', loadingDir: false };

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'html') el.innerHTML = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const svg = (inner, cls = 'ico', vb = '0 0 24 24') => h('span', { html: `<svg class="${cls}" viewBox="${vb}">${inner}</svg>`, style: 'display:inline-flex' }).firstChild;
const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', broom: '<path d="M14 4l6 6M4 20l6-1 9-9-5-5-9 9-1 6zM8 16l2 2"/>', folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  chart: '<path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7"/>', file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>', reveal: '<path d="M10 14L21 3M21 3h-6M21 3v6M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
};
const icon = n => svg(ICON[n]);
const gb = kb => kb * 1024 / 1e9; // macOS style: 1 GB = 1,000,000,000 bytes
function fmt(kb) {
  const g = gb(kb);
  if (!kb) return '0 KB';
  if (g >= 100) return Math.round(g) + ' GB'; if (g >= 1) return g.toFixed(1) + ' GB';
  const m = g * 1000; if (m >= 1) return Math.round(m) + ' MB'; return Math.max(1, Math.round(kb)) + ' KB';
}
const fmtB = b => fmt(b / 1024);
const ago = ms => { const d = Math.floor((Date.now() - ms) / 864e5); if (d <= 0) { const m = Math.floor((Date.now() - ms) / 6e4); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ago'; } return d === 1 ? 'yesterday' : d + ' days ago'; };
const rel = p => S.st && p.startsWith(S.st.home) ? '~' + p.slice(S.st.home.length) : p;
async function api(p) { const r = await fetch(p); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
async function post(p, b) {
  const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': TOKEN }, body: JSON.stringify(b || {}) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
function toast(msg, ms = 3200) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ---------- derived data ---------- */
const sugs = () => S.st?.suggestions || [];
const safeKB = () => sugs().filter(s => s.risk === 'safe').reduce((a, s) => a + s.kb, 0);
const reviewKB = () => sugs().filter(s => s.risk === 'review' && s.method !== 'emptytrash').reduce((a, s) => a + s.kb, 0);
const freedKB = () => (S.st?.actions || []).filter(a => a.how === 'rm').reduce((a, x) => a + x.kb, 0);
function alerts() {
  const d = S.st.disk, pct = d.used / d.total * 100, out = [];
  if (pct >= 90) out.push({ lvl: 'crit', t: `Your disk is ${pct.toFixed(0)}% full`, d: `Only ${fmtB(d.free)} left. macOS slows down and updates can fail below ~10%.` });
  else if (pct >= 80) out.push({ lvl: 'warn', t: `Disk is ${pct.toFixed(0)}% full`, d: `${fmtB(d.free)} free. A good time to clear some space.` });
  const hs = S.st.history, now = Date.now(), old = hs.find(x => x.t >= now - 36 * 36e5);
  if (old && old.free - d.free > 5e9) out.push({ lvl: 'warn', t: `Free space dropped ${fmtB(old.free - d.free)} in the last day`, d: 'Something is growing quickly — check the Explorer for the biggest folders.' });
  const s = safeKB();
  if (s > 2e6 && !out.length) out.push({ lvl: 'ok', t: `${fmt(s)} can be cleaned safely right now`, d: 'Caches and build folders that regenerate on their own.', cta: true });
  return out;
}

/* ---------- shell ---------- */
const NAV = [['overview', 'Overview', 'home'], ['cleanup', 'Cleanup', 'broom'], ['explorer', 'Explorer', 'folder'], ['history', 'History', 'chart']];
function renderShell() {
  const nav = document.getElementById('nav'); nav.replaceChildren();
  NAV.forEach(([id, label, ic]) => {
    const n = sugs().length;
    nav.append(h('button', { class: 'nav-item' + (S.page === id ? ' active' : ''), onclick: () => go(id) }, icon(ic), label,
      id === 'cleanup' && n ? h('span', { class: 'pill' }, n) : null));
  });
  const sc = S.st.scan, f = document.getElementById('sideFoot'); f.replaceChildren();
  if (sc.running) f.append(h('b', null, 'Scanning…'), sc.phase, h('div', { class: 'progress' }, h('i', { style: `width:${Math.round(sc.progress * 100)}%` })));
  else f.append(h('b', null, sc.finishedAt ? 'Up to date' : 'Not scanned yet'), sc.finishedAt ? 'Last scan ' + ago(sc.finishedAt) : 'Run a scan to begin',
    h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn ghost sm', onclick: startScan }, 'Rescan')));
}
function go(p) { S.page = p; if (p === 'explorer' && !S.dirPath) loadDir(S.st.home); render(); location.hash = p; window.scrollTo(0, 0); }
async function startScan() { try { await post('/api/scan'); S.st.scan.running = true; S.st.scan.phase = 'Starting…'; S.st.scan.progress = 0.02; render(); poll(); } catch (e) { toast(e.message); } }

function header(title, sub, right) {
  return h('div', { class: 'head' }, h('div', null, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null), right || null);
}
function scanBtn() { return S.st.scan.running ? h('span', { class: 'muted small' }, h('span', { class: 'spin' }), '  ', S.st.scan.phase) : h('button', { class: 'btn', onclick: startScan }, 'Rescan'); }

/* ---------- Overview ---------- */
function ring(d) {
  const R = 100, C = 2 * Math.PI * R, pct = d.used / d.total;
  const col = pct >= .9 ? 'var(--red)' : pct >= .8 ? 'var(--orange)' : 'var(--primary)';
  const wrap = h('div', { class: 'ring' });
  wrap.innerHTML = `<svg viewBox="0 0 230 230"><circle cx="115" cy="115" r="${R}" fill="none" stroke="var(--line)" stroke-width="18"/>
    <circle id="rg" cx="115" cy="115" r="${R}" fill="none" stroke="${col}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"/></svg>`;
  wrap.append(h('div', { class: 'c' }, h('div', { class: 'big' }, fmtB(d.free)), h('div', { class: 'lbl' }, 'free of ' + fmtB(d.total))));
  requestAnimationFrame(() => requestAnimationFrame(() => { const c = wrap.querySelector('#rg'); if (c) c.style.strokeDashoffset = C * (1 - pct); }));
  return wrap;
}
function pageOverview() {
  const d = S.st.disk, cats = S.st.categories, tot = cats.reduce((a, c) => a + c.kb, 0) || 1;
  const root = h('div');
  root.append(header('Storage', `${S.st.home.split('/').pop()}’s Mac · ${(d.used / d.total * 100).toFixed(0)}% used`, scanBtn()));
  alerts().forEach(a => root.append(h('div', { class: 'banner ' + a.lvl }, h('span', { class: 'dot', style: `background:${a.lvl === 'crit' ? 'var(--red)' : a.lvl === 'warn' ? 'var(--orange)' : 'var(--primary)'}` }),
    h('div', { class: 'grow' }, h('b', null, a.t), h('div', { class: 'small muted' }, a.d)), a.cta ? h('button', { class: 'btn sm', onclick: () => go('cleanup') }, 'Review') : null)));

  const hero = h('div', { class: 'card' }, h('div', { class: 'hero' }, ring(d), h('div', null,
    h('div', { class: 'card-head' }, h('h2', null, 'Where your space goes'), h('span', { class: 'muted small' }, 'Click a row to explore')),
    h('div', { class: 'segbar' }, cats.filter(c => c.kb > 0).map(c => h('i', { style: `flex:${c.kb};background:${c.color}`, title: `${c.name} · ${fmt(c.kb)}` }))),
    h('div', { class: 'legend' }, cats.filter(c => c.kb > 0).sort((a, b) => b.kb - a.kb).map(c =>
      h('div', { class: 'legend-row', style: 'cursor:pointer', onclick: () => { S.dirPath = null; go('explorer'); } },
        h('span', { class: 'dot', style: `background:${c.color}` }), c.name, h('span', { class: 'num' }, fmt(c.kb)), h('span', { class: 'pct' }, (c.kb / tot * 100).toFixed(0) + '%')))))));
  root.append(hero);

  root.append(h('div', { class: 'grid g3', style: 'margin-top:20px' },
    stat('Safe to clean', fmt(safeKB()), `${sugs().filter(s => s.risk === 'safe').length} items that rebuild themselves`, 'var(--primary)', () => { S.filter = 'safe'; go('cleanup'); }),
    stat('Needs your review', fmt(reviewKB()), `${sugs().filter(s => s.risk === 'review' && s.method !== 'emptytrash').length} items only you can judge`, 'var(--orange)', () => { S.filter = 'review'; go('cleanup'); }),
    stat('Freed with this app', fmt(freedKB()), `${(S.st.actions || []).length} cleanups so far`, 'var(--blue)', () => go('history'))));

  const top = S.st.top.slice(0, 10), mx = top[0]?.kb || 1, cmap = Object.fromEntries(cats.map(c => [c.name, c.color]));
  const left = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Biggest space users'), h('span', { class: 'muted small' }, 'Top 10 folders')),
    top.length ? h('div', { class: 'list' }, top.map(t => h('div', { class: 'row click', onclick: () => { loadDir(t.path); go('explorer'); } },
      h('div', { class: 'bar-row' }, h('div', { class: 'name' }, h('span', null, t.name), h('span', { class: 'chip' }, t.category)), h('span', { class: 'num' }, fmt(t.kb)),
        h('div', { class: 'track' }, h('i', { style: `width:${t.kb / mx * 100}%;background:${cmap[t.category] || 'var(--primary)'}` })))))) : emptyScan());
  const sg = sugs().slice(0, 5);
  const right = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Suggested for you'), h('button', { class: 'btn ghost sm', onclick: () => go('cleanup') }, 'See all')),
    sg.length ? h('div', { class: 'list' }, sg.map(s => h('div', { class: 'row' }, h('div', null, h('div', { style: 'font-weight:600' }, s.title, ' ', h('span', { class: 'chip ' + s.risk }, s.risk === 'safe' ? 'Safe' : 'Review')),
      h('div', { class: 'small muted', style: 'margin-top:2px' }, s.reason)), h('span', { class: 'num' }, fmt(s.kb))))) : h('div', { class: 'empty' }, h('b', null, 'Nothing to suggest'), 'Your Mac looks tidy.'));
  root.append(h('div', { class: 'grid g2', style: 'margin-top:20px' }, left, right));
  return root;
}
const stat = (k, v, d, c, fn) => { const [n, u] = v.split(' '); return h('div', { class: 'card stat', style: fn ? 'cursor:pointer' : '', onclick: fn },
  h('div', { class: 'k' }, h('span', { class: 'dot', style: `background:${c}` }), k), h('div', { class: 'v' }, n, h('small', null, ' ' + u)), h('div', { class: 'd' }, d)); };
const emptyScan = () => h('div', { class: 'empty' }, S.st.scan.running ? [h('span', { class: 'spin' }), h('div', { style: 'margin-top:12px' }, 'Scanning your Mac for the first time…')] : [h('b', null, 'No scan yet'), h('button', { class: 'btn', style: 'margin-top:12px', onclick: startScan }, 'Scan now')]);

/* ---------- Cleanup ---------- */
const GROUPS = [['dev', 'Project build folders', 'node_modules, build caches and virtualenvs inside your projects'], ['cache', 'Caches & developer tools', 'Things apps and tools download for speed'],
  ['downloads', 'Old installers & downloads', 'Setup files you probably don’t need any more'], ['large', 'Large files', 'Big files in Downloads, Desktop and Documents'], ['trash', 'Trash', 'Already deleted, still using space']];
function pageCleanup() {
  const root = h('div'), all = sugs(), shown = all.filter(s => S.filter === 'all' || s.risk === S.filter);
  const tabs = h('div', { class: 'tabs' }, [['all', 'All'], ['safe', 'Safe'], ['review', 'Review']].map(([k, l]) => h('button', { class: 'tab' + (S.filter === k ? ' active' : ''), onclick: () => { S.filter = k; render(); } }, l)));
  root.append(header('Cleanup', `${fmt(safeKB())} safe to clean · ${fmt(reviewKB())} to review`, tabs));
  if (!all.length) { root.append(h('div', { class: 'card' }, S.st.scan.running ? emptyScan() : h('div', { class: 'empty' }, h('b', null, 'Nothing to clean'), 'Rescan later — the app will suggest things as they pile up.'))); return root; }
  root.append(h('div', { class: 'banner ok' }, h('span', { class: 'dot', style: 'background:var(--primary)' }), h('div', { class: 'grow small' },
    h('b', null, 'Safe'), ' = rebuilds itself, nothing is lost.  ', h('b', null, 'Review'), ' = your call — those go to the Trash first so you can undo.')));
  GROUPS.forEach(([g, title, sub]) => {
    const items = shown.filter(s => s.group === g); if (!items.length) return;
    const tot = items.reduce((a, s) => a + s.kb, 0), ids = items.map(s => s.id), allOn = ids.every(i => S.sel.has(i));
    root.append(h('div', { class: 'group' }, h('div', { class: 'group-h' }, h('div', null, h('h2', null, title), h('div', { class: 'small muted' }, sub)),
      h('div', { style: 'display:flex;gap:12px;align-items:center' }, h('span', { class: 'num' }, fmt(tot)),
        h('button', { class: 'btn ghost sm', onclick: () => { ids.forEach(i => allOn ? S.sel.delete(i) : S.sel.add(i)); render(); } }, allOn ? 'Deselect' : 'Select all'))),
      h('div', { class: 'card flat', style: 'padding:8px 22px' }, items.map(itemRow))));
  });
  const picked = all.filter(s => S.sel.has(s.id));
  if (picked.length) {
    const kb = picked.reduce((a, s) => a + s.kb, 0);
    document.body.append(h('div', { class: 'actionbar', id: 'abar' }, h('div', { class: 'in' }, h('div', null, h('b', null, picked.length + ' selected'), h('span', { class: 'muted' }, ' · ' + fmt(kb))),
      h('button', { class: 'btn ghost sm', onclick: () => { all.filter(s => s.risk === 'safe').forEach(s => S.sel.add(s.id)); render(); } }, 'Select all safe'),
      h('button', { class: 'btn ghost sm', onclick: () => { S.sel.clear(); render(); } }, 'Clear'),
      h('button', { class: 'btn', onclick: () => confirmClean(picked) }, 'Clean up'))));
  }
  return root;
}
function itemRow(s) {
  const cb = h('input', { type: 'checkbox', class: 'check', onchange: e => { e.target.checked ? S.sel.add(s.id) : S.sel.delete(s.id); render(); } }); cb.checked = S.sel.has(s.id);
  return h('div', { class: 'item' }, cb,
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, s.title, h('span', { class: 'chip' }, s.label), h('span', { class: 'chip ' + s.risk }, s.risk === 'safe' ? 'Safe' : 'Review')),
      h('div', { class: 'p', title: s.path }, rel(s.path)), h('div', { class: 'why' }, s.reason), h('div', { class: 'undo' }, '↺ ' + s.restore)),
    h('button', { class: 'icon-btn', title: 'Show in Finder', onclick: () => post('/api/reveal', { path: s.path }) }, icon('reveal')), h('div', { class: 'sz' }, fmt(s.kb)));
}
function confirmClean(picked) {
  const needsMode = picked.some(s => s.method === 'trash'), kb = picked.reduce((a, s) => a + s.kb, 0), hasTrash = picked.some(s => s.method === 'emptytrash');
  let mode = 'trash';
  const m = document.getElementById('modal'), body = h('div', { class: 'modal' });
  const opts = h('div');
  const drawOpts = () => { opts.replaceChildren(
    optEl('trash', 'Move to Trash (recommended)', 'Installers and files can be put back. Space is freed when you empty the Trash.'),
    optEl('permanent', 'Delete permanently', 'Frees the space right away. Cannot be undone.')); };
  const optEl = (v, t, d) => h('label', { class: 'opt' + (mode === v ? ' sel' : ''), onclick: () => { mode = v; drawOpts(); } }, h('input', { type: 'radio', name: 'm', checked: mode === v }), h('div', null, h('b', null, t), h('span', null, d)));
  drawOpts();
  body.append(h('h3', null, `Clean up ${fmt(kb)}?`), h('p', { class: 'lead' }, `${picked.length} item${picked.length > 1 ? 's' : ''} will be removed.` + (hasTrash ? ' Emptying the Trash is permanent.' : '')),
    h('ul', null, picked.slice(0, 60).map(s => h('li', null, h('span', null, s.title), h('span', { class: 'num' }, fmt(s.kb))))),
    needsMode ? opts : h('p', { class: 'small muted' }, 'These are regenerable files, so they are deleted directly — nothing important is lost.'),
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.hidden = true }, 'Cancel'),
      h('button', { class: 'btn' + (mode === 'permanent' ? ' danger' : ''), id: 'go', onclick: async e => {
        e.target.disabled = true; e.target.textContent = 'Cleaning…';
        try {
          const r = await post('/api/clean', { ids: picked.map(s => s.id), mode });
          const ok = r.results.filter(x => x.ok).length, bad = r.results.filter(x => !x.ok);
          m.hidden = true; picked.forEach(s => S.sel.delete(s.id));
          toast(bad.length ? `${ok} cleaned, ${bad.length} failed: ${bad[0].error}` : `Done — freed ${fmt(r.freedKB)}` + (r.freedKB < kb ? ' · empty the Trash to free the rest' : ''), 5000);
          await refresh(true);
        } catch (err) { m.hidden = false; toast(err.message); e.target.disabled = false; e.target.textContent = 'Clean up'; }
      } }, 'Clean up')));
  m.replaceChildren(body); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; };
}

/* ---------- Explorer ---------- */
async function loadDir(p) {
  S.dirPath = p; S.loadingDir = true; if (S.page === 'explorer') render();
  try { S.dir = await api('/api/dir?path=' + encodeURIComponent(p)); } catch (e) { toast(e.message); S.dir = null; }
  S.loadingDir = false; if (S.page === 'explorer') render();
}
const TM_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#bf5af2', '#ff6482', '#5e5ce6', '#ff453a', '#64d2ff', '#a2845e'];
function squarify(items, x, y, w, hh) {
  const out = [], total = items.reduce((a, b) => a + b.v, 0); if (!total) return out;
  const sc = w * hh / total; items = items.map(i => ({ ...i, a: i.v * sc }));
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  while (items.length) {
    const side = Math.min(w, hh); let row = [items[0]], i = 1;
    while (i < items.length && worst(row.concat(items[i]), side) <= worst(row, side)) row.push(items[i++]);
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= hh) { const rw = s / hh; let cy = y; row.forEach(r => { const rh = r.a / rw; out.push({ ...r, x, y: cy, w: rw, h: rh }); cy += rh; }); x += rw; w -= rw; }
    else { const rh = s / w; let cx = x; row.forEach(r => { const rw = r.a / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }); y += rh; hh -= rh; }
    items = items.slice(row.length);
  }
  return out;
}
function pageExplorer() {
  const root = h('div'), d = S.dir;
  root.append(header('Explorer', 'See exactly what is inside any folder', null));
  if (!d) { root.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, S.loadingDir ? [h('span', { class: 'spin' })] : [h('b', null, 'Nothing here'), h('button', { class: 'btn ghost', onclick: () => loadDir(S.st.home) }, 'Back to Home')]))); return root; }
  const parts = d.path.slice(S.st.home.length).split('/').filter(Boolean), crumbs = [h('button', { onclick: () => loadDir(S.st.home) }, 'Home')];
  let acc = S.st.home; parts.forEach(p => { acc += '/' + p; const a = acc; crumbs.push(h('span', { class: 'sep' }, '›'), h('button', { onclick: () => loadDir(a) }, p)); });
  root.append(h('div', { class: 'card flat', style: 'padding:14px 18px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center' }, h('div', { class: 'crumbs' }, crumbs),
    h('div', { class: 'muted' }, h('span', { class: 'num', style: 'color:var(--ink)' }, fmt(d.totalKB)), ' total ', S.loadingDir ? h('span', { class: 'spin' }) : '')));
  const rows = d.rows, mx = rows[0]?.kb || 1;
  const tm = h('div', { class: 'treemap' });
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Map'), h('span', { class: 'muted small' }, 'Bigger box = more space · click a folder to open it')), tm);
  root.append(card);
  requestAnimationFrame(() => {
    const W = tm.clientWidth, H = tm.clientHeight, items = rows.slice(0, 24).map((r, i) => ({ r, v: r.kb, c: TM_COLORS[i % TM_COLORS.length] }));
    squarify(items, 0, 0, W, H).forEach(b => {
      const el = h('div', { class: 'tm', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`, title: `${b.r.name} · ${fmt(b.r.kb)}`,
        onclick: () => b.r.kind === 'dir' ? loadDir(b.r.path) : post('/api/reveal', { path: b.r.path }) },
        h('div', { style: `background:${b.c}` }, b.w > 70 && b.h > 38 ? [h('div', { class: 'n' }, b.r.name), h('div', { class: 's' }, fmt(b.r.kb))] : null));
      tm.append(el);
    });
  });
  const list = h('div', { class: 'card', style: 'margin-top:20px' }, h('div', { class: 'card-head' }, h('h2', null, 'Contents'), h('span', { class: 'muted small' }, `${rows.length} largest items`)),
    rows.length ? rows.map(r => h('div', { class: 'xrow' }, h('span', null, svg(r.kind === 'dir' ? ICON.folder : ICON.file)),
      h('div', { class: 'nm', onclick: () => r.kind === 'dir' ? loadDir(r.path) : post('/api/reveal', { path: r.path }) }, h('b', { title: r.path }, r.name), h('div', { class: 'track' }, h('i', { style: `width:${r.kb / mx * 100}%` }))),
      h('span', { class: 'num', style: 'text-align:right' }, fmt(r.kb)),
      h('div', { class: 'acts' }, h('span', { class: 'muted small', style: 'align-self:center;margin-right:6px' }, r.mtime ? ago(r.mtime) : ''),
        h('button', { class: 'icon-btn', title: 'Show in Finder', onclick: () => post('/api/reveal', { path: r.path }) }, icon('reveal')),
        h('button', { class: 'icon-btn', title: 'Move to Trash', onclick: () => confirmTrash(r) }, icon('trash'))))) : h('div', { class: 'empty' }, 'No large items in here.'));
  if (d.otherKB > 1024) list.append(h('div', { class: 'xrow muted' }, h('span'), h('div', null, 'Smaller files & folders'), h('span', { class: 'num', style: 'text-align:right' }, fmt(d.otherKB)), h('span')));
  root.append(list);
  return root;
}
function confirmTrash(r) {
  const m = document.getElementById('modal'), body = h('div', { class: 'modal' });
  body.append(h('h3', null, `Move “${r.name}” to Trash?`), h('p', { class: 'lead' }, `${fmt(r.kb)} · ${rel(r.path)}`),
    h('p', { class: 'small muted' }, 'It stays in your Trash until you empty it, so you can still put it back from Finder.'),
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.hidden = true }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: async () => { try { await post('/api/trash', { path: r.path }); m.hidden = true; toast('Moved to Trash'); await refresh(true); loadDir(S.dirPath); } catch (e) { toast(e.message); m.hidden = true; } } }, 'Move to Trash')));
  m.replaceChildren(body); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; };
}

/* ---------- History ---------- */
function pageHistory() {
  const root = h('div'), hs = S.st.history, now = Date.now(), span = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, all: Infinity }[S.range];
  const data = hs.filter(x => now - x.t <= span); if (data.length === 1) data.unshift({ ...data[0], t: data[0].t - 6e4 });
  const tabs = h('div', { class: 'tabs' }, ['24h', '7d', '30d', 'all'].map(k => h('button', { class: 'tab' + (S.range === k ? ' active' : ''), onclick: () => { S.range = k; render(); } }, k === 'all' ? 'All' : k)));
  root.append(header('History', 'Free space over time — the app records it while it is running', tabs));
  const card = h('div', { class: 'card', style: 'position:relative' }, h('div', { class: 'card-head' }, h('h2', null, 'Free space'), h('span', { class: 'muted small' }, data.length ? `${fmtB(data[data.length - 1].free)} now` : '')));
  if (data.length < 2) card.append(h('div', { class: 'empty' }, h('b', null, 'Collecting data'), 'Leave the dashboard running and a trend line will appear here.'));
  else { const tip = h('div', { class: 'tip', hidden: true }); card.append(chart(data, tip), tip); }
  root.append(card);
  const acts = [...(S.st.actions || [])].reverse();
  root.append(h('div', { class: 'card', style: 'margin-top:20px' }, h('div', { class: 'card-head' }, h('h2', null, 'Cleanup log'), h('span', { class: 'muted small' }, `${fmt(freedKB())} freed in total`)),
    acts.length ? h('div', { class: 'list' }, acts.slice(0, 40).map(a => h('div', { class: 'row' }, h('div', null, h('div', { style: 'font-weight:600' }, a.title, ' ', h('span', { class: 'chip' }, a.how === 'trash' ? 'Moved to Trash' : 'Deleted')),
      h('div', { class: 'small muted mono' }, rel(a.path)), h('div', { class: 'small muted' }, ago(a.t))), h('span', { class: 'num' }, fmt(a.kb))))) : h('div', { class: 'empty' }, 'Nothing cleaned yet.')));
  return root;
}
function chart(data, tip) {
  const W = 1000, H = 280, P = { l: 52, r: 16, t: 14, b: 28 }, t0 = data[0].t, t1 = data[data.length - 1].t;
  const vals = data.map(d => d.free / 1e9), lo = Math.max(0, Math.min(...vals) * .9), hi = Math.max(...vals) * 1.08 + .1;
  const X = t => P.l + (t - t0) / ((t1 - t0) || 1) * (W - P.l - P.r), Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = data.map(d => [X(d.t), Y(d.free / 1e9)]), line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const el = h('div'); let grid = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${P.l - 10}" y="${y + 4}" text-anchor="end">${Math.round(v)} GB</text>`; }
  const fm = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (t1 - t0 < 2 * 864e5 ? ' ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="ar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".28"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${line} L${pts[pts.length - 1][0]} ${H - P.b} L${pts[0][0]} ${H - P.b} Z" fill="url(#ar)"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <text x="${P.l}" y="${H - 6}">${fm(t0)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${fm(t1)}</text><circle id="cur" r="5" fill="var(--primary)" stroke="var(--surface)" stroke-width="2.5" display="none"/></svg>`;
  const s = el.firstChild, cur = s.querySelector('#cur');
  s.addEventListener('mousemove', e => {
    const r = s.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i; });
    const p = pts[best]; cur.setAttribute('cx', p[0]); cur.setAttribute('cy', p[1]); cur.setAttribute('display', 'block');
    tip.hidden = false; tip.style.left = (p[0] / W * r.width) + 'px'; tip.style.top = (p[1] / H * r.height + 70) + 'px';
    tip.replaceChildren(h('b', null, fmtB(data[best].free) + ' free'), h('div', { class: 'muted' }, new Date(data[best].t).toLocaleString()));
  });
  s.addEventListener('mouseleave', () => { tip.hidden = true; cur.setAttribute('display', 'none'); });
  return el;
}

/* ---------- render loop ---------- */
function render() {
  if (!S.st) return;
  document.getElementById('abar')?.remove();
  renderShell();
  const main = document.getElementById('main'), page = { overview: pageOverview, cleanup: pageCleanup, explorer: pageExplorer, history: pageHistory }[S.page]();
  main.replaceChildren(page); main.style.animation = 'none'; void main.offsetWidth; main.style.animation = '';
}
async function refresh(force) {
  try {
    const wasRunning = S.st?.scan.running;
    S.st = await api('/api/state');
    const ids = new Set(sugs().map(s => s.id)); [...S.sel].forEach(i => { if (!ids.has(i)) S.sel.delete(i); });
    if (force || !wasRunning || !S.st.scan.running || true) render();
  } catch (e) { /* server restarting */ }
}
let polling = false;
async function poll() {
  if (polling) return; polling = true;
  while (S.st?.scan.running) { await new Promise(r => setTimeout(r, 1500)); try { const s = await api('/api/status'); S.st.scan = s.scan; S.st.disk = s.disk; renderShell(); } catch { /* ignore */ } if (!S.st.scan.running) await refresh(true); }
  polling = false;
}
(async function init() {
  const h0 = location.hash.slice(1); if (['overview', 'cleanup', 'explorer', 'history'].includes(h0)) S.page = h0;
  await refresh(true);
  if (S.page === 'explorer') loadDir(S.st.home);
  poll();
  setInterval(async () => { if (document.hidden || S.st.scan.running || !document.getElementById('modal').hidden) return; const keep = S.page === 'cleanup' || S.page === 'explorer'; const s = await api('/api/status').catch(() => null); if (s) { S.st.disk = s.disk; if (!keep) await refresh(); } }, 30000);
})();
