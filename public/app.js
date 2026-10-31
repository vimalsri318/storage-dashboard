'use strict';
/* Storage dashboard front-end. No libraries. All text goes through textContent (file names are untrusted). */
const TOKEN = window.__TOKEN__;
const S = { st: null, page: 'overview', filter: 'all', sel: new Set(), dir: null, dirPath: null, range: '7d', loadingDir: false, busy: new Set(), hoverCat: null, tsel: new Set() };

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
const svg = (inner, cls = 'ico') => { const t = document.createElement('template'); t.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24">${inner}</svg>`; return t.content.firstChild; };
const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', broom: '<path d="M14 4l6 6M4 20l6-1 9-9-5-5-9 9-1 6zM8 16l2 2"/>', folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  chart: '<path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7"/>', file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>', reveal: '<path d="M10 14L21 3M21 3h-6M21 3v6M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', list: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>', moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
};
const icon = n => svg(ICON[n]);
const gb = kb => kb * 1024 / 1e9; // macOS style: 1 GB = 1,000,000,000 bytes
function fmt(kb) {
  if (!kb) return '0 KB';
  const g = gb(kb);
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
const copy = async txt => { try { await navigator.clipboard.writeText(txt); toast('Copied: ' + txt); } catch { toast('Copy failed — select it manually'); } };

/* ---------- theme (Auto / Light / Dark) ---------- */
function getTheme() { try { return localStorage.getItem('sd-theme') || 'auto'; } catch { return 'auto'; } }
function setTheme(t) {
  try { localStorage.setItem('sd-theme', t); } catch { /* private mode */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  renderShell();
}
setTheme(getTheme());

/* ---------- derived data ---------- */
const sugs = () => S.st?.suggestions || [];
const tasks = () => S.st?.tasks || [];
const safeKB = () => sugs().filter(s => s.risk === 'safe').reduce((a, s) => a + s.kb, 0);
const reviewKB = () => sugs().filter(s => s.risk === 'review' && s.method !== 'emptytrash').reduce((a, s) => a + s.kb, 0);
const freedKB = () => (S.st?.actions || []).filter(a => a.how === 'rm').reduce((a, x) => a + x.kb, 0);
const doneToday = () => (S.st?.completed || []).filter(c => Date.now() - c.t < 864e5);
function alerts() {
  const d = S.st.disk, pct = d.used / d.total * 100, out = [];
  if (pct >= 90) out.push({ lvl: 'crit', t: `Your disk is ${pct.toFixed(0)}% full`, d: `Only ${fmtB(d.free)} left. macOS slows down and updates can fail below ~10%.`, cta: true });
  else if (pct >= 80) out.push({ lvl: 'warn', t: `Disk is ${pct.toFixed(0)}% full`, d: `${fmtB(d.free)} free. A good time to clear some space.`, cta: true });
  const hs = S.st.history, now = Date.now(), old = hs.find(x => x.t >= now - 36 * 36e5);
  if (old && old.free - d.free > 5e9) out.push({ lvl: 'warn', t: `Free space dropped ${fmtB(old.free - d.free)} in the last day`, d: 'Something is growing quickly — check the Explorer for the biggest folders.' });
  return out;
}

/* ---------- shell ---------- */
const NAV = [['overview', 'Overview', 'home'], ['tasks', 'Checklist', 'list'], ['cleanup', 'Cleanup', 'broom'], ['explorer', 'Explorer', 'folder'], ['history', 'History', 'chart'], ['settings', 'Settings', 'gear']];
function renderShell() {
  const nav = document.getElementById('nav'); nav.replaceChildren();
  if (!S.st) return;
  NAV.forEach(([id, label, ic]) => {
    const n = id === 'tasks' ? tasks().length : id === 'cleanup' ? sugs().length : id === 'settings' ? (S.st.app?.update.available ? 1 : 0) : 0;
    nav.append(h('button', { class: 'nav-item' + (S.page === id ? ' active' : ''), onclick: () => go(id) }, icon(ic), label, n ? h('span', { class: 'pill' }, n) : null));
  });
  const sc = S.st.scan, f = document.getElementById('sideFoot'); f.replaceChildren();
  if (sc.running) f.append(h('b', null, 'Scanning…'), sc.phase, h('div', { class: 'progress' }, h('i', { style: `width:${Math.round(sc.progress * 100)}%` })));
  else f.append(h('b', null, sc.finishedAt ? 'Up to date' : 'Not scanned yet'), sc.finishedAt ? 'Last scan ' + ago(sc.finishedAt) : 'Run a scan to begin',
    h('div', { style: 'margin:10px 0 12px' }, h('button', { class: 'btn ghost sm', onclick: startScan }, 'Rescan')));
  const t = getTheme();
  f.append(h('div', { class: 'theme', role: 'group', 'aria-label': 'Theme' }, [['auto', 'auto', 'Match system'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([k, ic, tip]) =>
    h('button', { class: t === k ? 'on' : '', title: tip, 'aria-label': tip, onclick: () => setTheme(k) }, icon(ic)))));
}
function go(p) { S.page = p; if (p === 'explorer' && !S.dirPath) loadDir(S.st.home); render({ anim: true, top: true }); history.replaceState(null, '', '#' + p); }
async function startScan() { try { await post('/api/scan'); S.st.scan.running = true; S.st.scan.phase = 'Starting…'; S.st.scan.progress = 0.02; render(); poll(); } catch (e) { toast(e.message); } }

function header(title, sub, right) {
  return h('div', { class: 'head' }, h('div', null, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null), right || null);
}
function scanBtn() { return S.st.scan.running ? h('span', { class: 'scanpill' }, h('i', { class: 'mini' }), h('span', { class: 'dots' }, 'Scanning')) : h('button', { class: 'btn', onclick: startScan }, 'Rescan'); }
const SCAN_STEPS = [['Map your disk', ['Starting…', 'Mapping your disk']], ['Apps & system', ['Measuring apps and system folders']], ['Build folders', ['Finding build folders', 'Measuring build folders']], ['Caches', ['Checking caches']], ['Installers & big files', ['Looking for old installers & big files']]];
const scanStep = phase => Math.max(0, SCAN_STEPS.findIndex(s => s[1].includes(phase)));
function scanCard(compact) {
  const sc = S.st.scan; if (!sc.running) return null;
  const radar = h('div', { class: 'radar' }, h('i', { class: 'sweep' }), h('i', { class: 'blip' }), h('i', { class: 'blip' }), h('i', { class: 'blip' }), h('i', { class: 'blip' }));
  return h('div', { class: 'scancard' + (compact ? ' compact' : ''), id: 'scancard' }, radar, h('div', { class: 'body' },
    h('h3', null, 'Scanning your Mac', h('span', { id: 'sc-pct' }, Math.round(sc.progress * 100) + '%')), h('div', { class: 'phase', id: 'sc-phase' }, sc.phase),
    h('div', { class: 'path', id: 'sc-path' }, sc.current ? '\u202A' + rel(sc.current) : ''), h('div', { class: 'bar' }, h('i', { id: 'sc-bar', style: `width:${Math.round(sc.progress * 100)}%` })),
    compact ? null : h('ul', { class: 'steps', id: 'sc-steps', style: 'padding:0;margin:14px 0 0' }, SCAN_STEPS.map(([l], i) => h('li', { class: i < scanStep(sc.phase) ? 'done' : i === scanStep(sc.phase) ? 'on' : '' }, h('i'), l)))));
}
function updateScanCard() {
  const sc = S.st.scan, el = document.getElementById('scancard'); if (!el) return;
  const set = (id, t) => { const n = document.getElementById(id); if (n && n.textContent !== t) n.textContent = t; };
  set('sc-pct', Math.round(sc.progress * 100) + '%'); set('sc-phase', sc.phase); set('sc-path', sc.current ? '\u202A' + rel(sc.current) : '');
  const b = document.getElementById('sc-bar'); if (b) b.style.width = Math.round(sc.progress * 100) + '%';
  document.querySelectorAll('#sc-steps li').forEach((li, i) => { li.className = i < scanStep(sc.phase) ? 'done' : i === scanStep(sc.phase) ? 'on' : ''; });
}
function scanComplete() {
  const kb = safeKB(), w = h('div', { class: 'done-wrap', onclick: () => w.remove() });
  const card = h('div', { class: 'done-card' });
  card.innerHTML = '<svg viewBox="0 0 100 100"><circle class="c1" cx="50" cy="50" r="46"/><path class="c2" d="M30 52l14 14 27-30"/></svg>';
  [[-90, -70], [90, -70], [-110, 10], [110, 10], [-50, -100], [50, -100]].forEach(([x, y]) => { const d = h('i', { class: 'spark', style: `--x:${x}px;--y:${y}px` }); card.append(d); });
  card.append(h('h3', null, 'Scan complete'), h('p', null, kb ? `${fmt(kb)} can be cleaned safely right now.` : 'Your Mac looks tidy.'));
  w.append(card); document.body.append(w); setTimeout(() => w.remove(), 2800);
}
const emptyScan = () => h('div', { class: 'empty' }, S.st.scan.running ? [h('span', { class: 'spin' }), h('div', { style: 'margin-top:12px' }, 'Scanning your Mac for the first time…')] : [h('b', null, 'No scan yet'), h('button', { class: 'btn', style: 'margin-top:12px', onclick: startScan }, 'Scan now')]);
const cardHead = (title, right) => h('div', { class: 'card-head' }, h('h2', null, title), right || null);

/* ---------- charts ---------- */
function ring(d) {
  const R = 100, C = 2 * Math.PI * R, pct = d.used / d.total;
  const col = pct >= .9 ? 'var(--red)' : pct >= .8 ? 'var(--orange)' : 'var(--primary)';
  const wrap = h('div', { class: 'ring' });
  wrap.innerHTML = `<svg viewBox="0 0 230 230"><circle cx="115" cy="115" r="${R}" fill="none" stroke="var(--line)" stroke-width="18"/>
    <circle class="rg" cx="115" cy="115" r="${R}" fill="none" stroke="${col}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)"/></svg>`;
  wrap.append(h('div', { class: 'c' }, h('div', { class: 'big' }, fmtB(d.free)), h('div', { class: 'lbl' }, 'free of ' + fmtB(d.total))));
  requestAnimationFrame(() => requestAnimationFrame(() => { const c = wrap.querySelector('.rg'); if (c) c.style.strokeDashoffset = C * (1 - pct); }));
  return wrap;
}
function donut(cats) {
  const tot = cats.reduce((a, c) => a + c.kb, 0) || 1, R = 84, C = 2 * Math.PI * R, gap = 3;
  const wrap = h('div', { class: 'donut' }), center = h('div', { class: 'c' }, h('b', null, fmt(tot)), h('span', null, 'in your home & apps'));
  let off = 0, html = `<svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--line)" stroke-width="26"/>`;
  cats.forEach((c, i) => { const len = Math.max(0, c.kb / tot * C - gap); html += `<circle class="seg" data-i="${i}" cx="110" cy="110" r="${R}" stroke="${c.color}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`; off += c.kb / tot * C; });
  wrap.innerHTML = html + '</svg>'; wrap.append(center);
  const set = i => {
    S.hoverCat = i; wrap.classList.toggle('hov', i != null);
    wrap.querySelectorAll('.seg').forEach(e => e.classList.toggle('on', +e.dataset.i === i));
    document.querySelectorAll('.legend-row[data-i]').forEach(e => e.classList.toggle('on', +e.dataset.i === i));
    center.replaceChildren(...(i == null ? [h('b', null, fmt(tot)), h('span', null, 'in your home & apps')] : [h('b', null, fmt(cats[i].kb)), h('span', null, cats[i].name + ' · ' + (cats[i].kb / tot * 100).toFixed(0) + '%')]));
  };
  wrap.addEventListener('mouseover', e => { const t = e.target.closest('.seg'); if (t) set(+t.dataset.i); });
  wrap.addEventListener('mouseleave', () => set(null)); wrap.set = set;
  return wrap;
}
function trendChart(data, tip, H = 280) {
  const W = 1000, P = { l: 52, r: 16, t: 14, b: 28 }, t0 = data[0].t, t1 = data[data.length - 1].t;
  const vals = data.map(d => d.free / 1e9), lo = Math.max(0, Math.min(...vals) * .9), hi = Math.max(...vals) * 1.08 + .1;
  const X = t => P.l + (t - t0) / ((t1 - t0) || 1) * (W - P.l - P.r), Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = data.map(d => [X(d.t), Y(d.free / 1e9)]), line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const el = h('div'); let grid = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${P.l - 10}" y="${y + 4}" text-anchor="end">${Math.round(v)} GB</text>`; }
  const fm = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (t1 - t0 < 2 * 864e5 ? ' ' + new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const id = 'ar' + Math.random().toString(36).slice(2, 7);
  el.innerHTML = `<svg class="chart" style="height:${H}px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".28"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${line} L${pts[pts.length - 1][0]} ${H - P.b} L${pts[0][0]} ${H - P.b} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <text x="${P.l}" y="${H - 6}">${fm(t0)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${fm(t1)}</text><circle class="cur" r="5" fill="var(--primary)" stroke="var(--surface)" stroke-width="2.5" display="none"/></svg>`;
  const s = el.firstChild, cur = s.querySelector('.cur');
  s.addEventListener('mousemove', e => {
    const r = s.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i; });
    const p = pts[best]; cur.setAttribute('cx', p[0]); cur.setAttribute('cy', p[1]); cur.setAttribute('display', 'block');
    tip.hidden = false; tip.style.left = (p[0] / W * r.width) + 'px'; tip.style.top = (p[1] / H * r.height + 64) + 'px';
    tip.replaceChildren(h('b', null, fmtB(data[best].free) + ' free'), h('div', { class: 'muted' }, new Date(data[best].t).toLocaleString()));
  });
  s.addEventListener('mouseleave', () => { tip.hidden = true; cur.setAttribute('display', 'none'); });
  return el;
}
function trendCard(range, H, title) {
  const hs = S.st.history, now = Date.now(), span = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, all: Infinity }[range];
  const data = hs.filter(x => now - x.t <= span); if (data.length === 1) data.unshift({ ...data[0], t: data[0].t - 6e4 });
  const delta = data.length > 1 ? data[data.length - 1].free - data[0].free : 0;
  const badge = data.length > 1 ? h('span', { class: 'delta ' + (Math.abs(delta) < 2e8 ? 'flat' : delta > 0 ? 'up' : 'down') }, (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmtB(Math.abs(delta)) + ' · ' + range) : null;
  const card = h('div', { class: 'card', style: 'position:relative' }, cardHead(title, badge));
  if (data.length < 2) card.append(h('div', { class: 'center muted small', style: 'text-align:center;padding:30px 0' }, 'Collecting data — leave the app running and a trend appears here.'));
  else { const tip = h('div', { class: 'tip', hidden: true }); card.append(h('div', { class: 'card-body' }, trendChart(data, tip, H)), tip); }
  return card;
}
const GROUPS = [['dev', 'Project build folders', 'node_modules, build caches and virtualenvs inside your projects'], ['cache', 'Caches & developer tools', 'Things apps and tools download for speed'],
  ['downloads', 'Old installers & downloads', 'Setup files you probably don’t need any more'], ['large', 'Large files', 'Big files in Downloads, Desktop and Documents'], ['trash', 'Trash', 'Already deleted, still using space']];
function reclaimCard() {
  const rows = GROUPS.map(([g, t]) => { const it = sugs().filter(s => s.group === g); return { t, safe: it.filter(s => s.risk === 'safe').reduce((a, s) => a + s.kb, 0), rev: it.filter(s => s.risk === 'review').reduce((a, s) => a + s.kb, 0) }; }).filter(r => r.safe + r.rev > 0);
  const mx = Math.max(1, ...rows.map(r => r.safe + r.rev));
  return h('div', { class: 'card' }, cardHead('What can be reclaimed', h('span', { class: 'muted small' }, 'by type')),
    h('div', { class: 'card-body' }, rows.length ? rows.map(r => h('div', { class: 'gbar' }, h('span', null, r.t.replace('Project build folders', 'Build folders').replace('Caches & developer tools', 'Caches').replace('Old installers & downloads', 'Installers')),
      h('div', { class: 'stk', style: `width:${(r.safe + r.rev) / mx * 100}%` }, r.safe ? h('i', { style: `flex:${r.safe};background:var(--primary)` }) : null, r.rev ? h('i', { style: `flex:${r.rev};background:var(--orange)` }) : null),
      h('span', { class: 'num', style: 'text-align:right' }, fmt(r.safe + r.rev)))) : h('div', { class: 'muted small center' }, 'Nothing to reclaim right now.')),
    h('div', { class: 'mini-legend' }, h('span', null, h('i', { class: 'dot', style: 'background:var(--primary)' }), 'Safe'), h('span', null, h('i', { class: 'dot', style: 'background:var(--orange)' }), 'Needs your review')));
}

/* ---------- checklist ---------- */
function planProgress() {
  const open = tasks(), done = doneToday(), doneKB = done.reduce((a, c) => a + (c.kb || 0), 0), openKB = open.reduce((a, t) => a + (t.kb || 0), 0);
  const total = open.length + done.length;
  return { open, done, doneKB, openKB, pct: total ? done.length / total : 0 };
}
function taskRow(t) {
  const busy = S.busy.has(t.id), run = runnable(t);
  const cb = h('input', { type: 'checkbox', class: 'circle', 'aria-label': run ? 'Select task' : 'Mark as done', disabled: busy,
    title: run ? 'Select it, then press “Run selected”. Nothing happens until you confirm.' : 'Mark as done (nothing is deleted)',
    onchange: e => { if (run) { e.target.checked ? S.tsel.add(t.id) : S.tsel.delete(t.id); updateBar(); } else { e.target.checked = false; markDone(t); } } });
  cb.checked = S.tsel.has(t.id);
  const acts = h('div', { class: 'acts' });
  if (busy) acts.append(h('span', { class: 'muted small' }, h('span', { class: 'spin' }), '  Working…'));
  else if (t.type === 'auto') acts.append(h('button', { class: 'btn sm', onclick: () => primary(t) }, 'Clean up'));
  else if (t.type === 'review') acts.append(h('button', { class: 'btn ghost sm', onclick: () => keepTask(t) }, 'Keep'), h('button', { class: 'btn sm' + (t.method === 'trash' ? '' : ''), onclick: () => primary(t) }, t.method === 'trash' ? 'Move to Trash' : 'Remove'));
  else if (t.type === 'manual') { if (t.run) acts.append(h('button', { class: 'btn sm', onclick: () => primary(t) }, 'Run it')); else acts.append(h('button', { class: 'btn sm', onclick: () => copy(t.command) }, 'Copy command')); acts.append(h('button', { class: 'btn ghost sm', onclick: () => markDone(t) }, 'I did it')); }
  else if (t.type === 'open') acts.append(h('button', { class: 'btn sm', onclick: () => primary(t) }, 'Open folder'), h('button', { class: 'btn ghost sm', onclick: () => markDone(t) }, 'Done'));
  if (t.path && !busy) acts.append(h('button', { class: 'icon-btn', title: 'Show in Finder', onclick: () => post('/api/reveal', { path: t.path }) }, icon('reveal')));
  return h('div', { class: 'task' }, cb,
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, t.title), h('div', { class: 'd' }, t.detail),
      h('div', { class: 'meta' }, h('span', { class: 'chip ' + t.risk }, t.risk === 'safe' ? 'Safe' : 'Review'), h('span', { class: 'chip' }, t.effort), t.command ? h('span', { class: 'cmd' }, '$ ' + t.command) : null,
        t.undo ? h('span', { class: 'u' }, '↺ ' + t.undo) : null)),
    h('div', { class: 'gain' }, t.kb ? ['+' + fmt(t.kb), h('small', null, 'free')] : h('span', { class: 'muted small' }, 'varies')), acts);
}
const runnable = t => t.type === 'auto' || t.type === 'review' || (t.type === 'manual' && !!t.run);
function primary(t) {
  if (t.type === 'open') { loadDir(t.path); go('explorer'); return; }
  if (t.type === 'manual' && !t.run) { copy(t.command); return; }
  confirmTasks([t]);
}
async function executeTask(t, mode) {
  S.busy.add(t.id); render();
  try {
    if (t.type === 'manual') { const r = await post('/api/run', { key: t.run, taskId: t.id, title: t.title }); return { ok: true, kb: r.freedKB }; }
    const r = await post('/api/clean', { ids: t.sids, mode, taskId: t.id, taskTitle: t.title });
    const bad = r.results.filter(x => !x.ok);
    return bad.length ? { ok: false, error: bad[0].error } : { ok: true, kb: r.freedKB };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { S.busy.delete(t.id); S.tsel.delete(t.id); }
}
function confirmTasks(list) {
  const kb = list.reduce((a, t) => a + (t.kb || 0), 0), needsMode = list.some(t => t.type === 'review' && t.method === 'trash');
  const review = list.some(t => t.type === 'review');
  let mode = 'trash';
  const m = document.getElementById('modal'), body = h('div', { class: 'modal' }), opts = h('div');
  const optEl = (v, t, d) => h('label', { class: 'opt' + (mode === v ? ' sel' : ''), onclick: () => { mode = v; drawOpts(); document.getElementById('go').classList.toggle('danger', mode === 'permanent'); } }, h('input', { type: 'radio', name: 'm', checked: mode === v }), h('div', null, h('b', null, t), h('span', null, d)));
  const drawOpts = () => opts.replaceChildren(optEl('trash', 'Move to Trash (recommended)', 'You can put it back. Space is freed once the Trash is emptied.'), optEl('permanent', 'Delete permanently', 'Frees the space right away. Cannot be undone.'));
  drawOpts();
  body.append(h('h3', null, list.length === 1 ? list[0].title + '?' : `Run ${list.length} tasks?`), h('p', { class: 'lead' }, kb ? `This will free about ${fmt(kb)}.` : 'This will run once and report what it freed.'),
    h('ul', null, list.map(t => h('li', null, h('span', null, t.title), h('span', { class: 'num' }, t.kb ? fmt(t.kb) : t.command || '—')))),
    h('p', { class: 'small muted' }, review ? 'Includes items that need your judgement — double-check the list.' : 'Everything here is regenerable: tools rebuild it when they need it.'),
    needsMode ? opts : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.hidden = true }, 'Cancel'),
      h('button', { class: 'btn', id: 'go', onclick: async e => {
        e.target.disabled = true; let freed = 0, fails = [];
        for (let i = 0; i < list.length; i++) {
          e.target.textContent = list.length > 1 ? `Working… ${i + 1} of ${list.length}` : 'Working…';
          const r = await executeTask(list[i], mode); if (r.ok) freed += r.kb || 0; else fails.push(r.error);
        }
        m.hidden = true;
        toast(fails.length ? `${list.length - fails.length} done, ${fails.length} failed: ${fails[0]}` : `Done — freed ${fmt(freed)}` + (mode === 'trash' && needsMode ? ' (empty the Trash to finish)' : ''), 5000);
        await refresh(true);
      } }, 'Run')));
  m.replaceChildren(body); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; };
}
async function markDone(t) { try { await post('/api/task', { id: t.id, action: 'done', title: t.title, kb: 0 }); toast('Marked as done'); } catch (e) { toast(e.message); } await refresh(true); }
async function keepTask(t) { try { await post('/api/task', { id: t.id, action: 'keep' }); toast('Okay — we won’t suggest it again'); } catch (e) { toast(e.message); } await refresh(true); }
function planCard(limit) {
  const p = planProgress(), list = limit ? p.open.slice(0, limit) : p.open;
  const head = h('div', { class: 'plan-head' }, h('div', { class: 'meter' }, h('i', { style: `width:${Math.round(p.pct * 100)}%` })),
    h('span', { class: 'small muted', style: 'white-space:nowrap' }, `${p.done.length} of ${p.open.length + p.done.length} done · ${fmt(p.doneKB)} freed today`));
  const card = h('div', { class: 'card' }, cardHead(limit ? 'Your plan for today' : 'To do', limit ? h('button', { class: 'btn ghost sm', onclick: () => go('tasks') }, 'See all ' + p.open.length) : h('span', { class: 'muted small' }, `${fmt(p.openKB)} available`)), head,
    h('div', { class: 'card-body' }, list.length ? h('div', { class: 'tasks' }, list.map(taskRow)) : h('div', { class: 'empty' }, h('b', null, 'All clear 🎉'), 'Nothing left to do. We’ll add tasks here as your disk fills up again.')));
  return card;
}
function pageTasks() {
  const root = h('div'), p = planProgress();
  root.append(header('Checklist', `${p.open.length} small tasks · ${fmt(p.openKB)} you can free`, scanBtn()));
  root.append(h('div', { class: 'banner ok' }, h('span', { class: 'dot', style: 'background:var(--primary)' }), h('div', { class: 'grow small' },
    h('b', null, 'How it works: '), 'tick the circle to select a task, then press ', h('b', null, 'Run selected'), ' — or use a task’s own button. You always get a confirmation first; nothing is deleted by ticking.')));
  root.append(h('div', { class: 'grid' }, h('div', { class: 's12' }, planCard(0))));
  if (p.done.length || (S.st.completed || []).length) {
    const done = S.st.completed || [];
    root.append(h('div', { class: 'grid' }, h('div', { class: 'card s12' }, cardHead('Completed', h('span', { class: 'muted small' }, `${fmt(done.reduce((a, c) => a + (c.kb || 0), 0))} freed through the checklist`)),
      h('div', { class: 'tasks' }, done.slice(0, 15).map(c => h('div', { class: 'task done' }, h('input', { type: 'checkbox', class: 'circle', checked: true, disabled: true }), h('div', null, h('div', { class: 't' }, c.title), h('div', { class: 'd' }, ago(c.t))), h('div', { class: 'gain' }, c.kb ? '+' + fmt(c.kb) : '✓'), h('span'))))))); }
  if (S.st.keptCount) root.append(h('div', { class: 'muted small', style: 'text-align:center' }, `${S.st.keptCount} suggestion(s) you chose to keep are hidden.`));
  return root;
}

/* ---------- Overview ---------- */
function pageOverview() {
  const d = S.st.disk, cats = S.st.categories.filter(c => c.kb > 0).sort((a, b) => b.kb - a.kb), tot = cats.reduce((a, c) => a + c.kb, 0) || 1;
  const root = h('div');
  root.append(header('Storage', `${S.st.home.split('/').pop()}’s Mac · ${(d.used / d.total * 100).toFixed(0)}% used`, scanBtn()));
  alerts().forEach(a => root.append(h('div', { class: 'banner ' + a.lvl }, h('span', { class: 'dot', style: `background:${a.lvl === 'crit' ? 'var(--red)' : 'var(--orange)'}` }),
    h('div', { class: 'grow' }, h('b', null, a.t), h('div', { class: 'small muted' }, a.d)), a.cta ? h('button', { class: 'btn sm', onclick: () => go('tasks') }, 'Free up space') : null)));

  const dn = donut(cats);
  const legend = h('div', { class: 'legend' }, cats.map((c, i) => h('div', { class: 'legend-row', 'data-i': i, onmouseenter: () => dn.set(i), onmouseleave: () => dn.set(null), onclick: () => { S.dirPath = null; go('explorer'); } },
    h('span', { class: 'dot', style: `background:${c.color}` }), c.name, h('span', { class: 'num' }, fmt(c.kb)), h('span', { class: 'pct' }, (c.kb / tot * 100).toFixed(0) + '%'))));
  root.append(h('div', { class: 'grid' },
    h('div', { class: 'card s5' }, cardHead('Disk', h('span', { class: 'muted small' }, (d.used / d.total * 100).toFixed(0) + '% used')),
      h('div', { class: 'center' }, ring(d)),
      h('div', { class: 'ring-stats' }, h('div', null, h('b', null, fmtB(d.used)), h('span', null, 'Used')), h('div', null, h('b', null, fmtB(d.free)), h('span', null, 'Free')), h('div', null, h('b', null, fmt(safeKB())), h('span', null, 'Safe to clean')))),
    h('div', { class: 'card s7' }, cardHead('Where your space goes', h('span', { class: 'muted small' }, 'Hover to highlight · click to explore')), h('div', { class: 'donut-wrap' }, dn, legend))));

  const p = planProgress();
  root.append(h('div', { class: 'grid' },
    statCard('s4', 'Safe to clean', fmt(safeKB()), `${sugs().filter(s => s.risk === 'safe').length} items that rebuild themselves`, 'var(--primary)', () => { S.filter = 'safe'; go('cleanup'); }),
    statCard('s4', 'Needs your review', fmt(reviewKB()), `${sugs().filter(s => s.risk === 'review' && s.method !== 'emptytrash').length} items only you can judge`, 'var(--orange)', () => { S.filter = 'review'; go('cleanup'); }),
    statCard('s4', 'Freed today', fmt(p.doneKB), `${p.done.length} task${p.done.length === 1 ? '' : 's'} completed · ${fmt(freedKB())} all-time`, 'var(--blue)', () => go('history'))));

  root.append(h('div', { class: 'grid' }, h('div', { class: 's7', style: 'display:grid' }, planCard(5)), h('div', { class: 's5 stack' }, trendCard('7d', 150, 'Free space · 7 days'), reclaimCard())));

  const top = S.st.top.slice(0, 10), mx = top[0]?.kb || 1, cmap = Object.fromEntries(S.st.categories.map(c => [c.name, c.color]));
  const mk = t => h('div', { class: 'row click', onclick: () => { loadDir(t.path); go('explorer'); } }, h('div', { class: 'bar-row' }, h('div', { class: 'name' }, h('span', null, t.name), h('span', { class: 'chip' }, t.category)), h('span', { class: 'num' }, fmt(t.kb)),
    h('div', { class: 'track' }, h('i', { style: `width:${t.kb / mx * 100}%;background:${cmap[t.category] || 'var(--primary)'}` }))));
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s12' }, cardHead('Biggest space users', h('span', { class: 'muted small' }, 'Top 10 folders · click to open')),
    top.length ? h('div', { class: 'cols2' }, h('div', { class: 'list' }, top.slice(0, 5).map(mk)), h('div', { class: 'list' }, top.slice(5).map(mk))) : emptyScan())));
  return root;
}
const statCard = (cls, k, v, d, c, fn) => { const [n, u] = v.split(' '); return h('div', { class: 'card stat ' + cls, style: 'cursor:pointer', onclick: fn },
  h('div', { class: 'k' }, h('span', { class: 'dot', style: `background:${c}` }), k), h('div', { class: 'v' }, n, h('small', null, ' ' + u)), h('div', { class: 'd' }, d)); };

/* ---------- Cleanup ---------- */
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
  return root;
}
function updateBar() {
  document.getElementById('abar')?.remove();
  let label, kb, clear, runAll, extra = null;
  if (S.page === 'cleanup') {
    const picked = sugs().filter(s => S.sel.has(s.id)); if (!picked.length) return;
    label = picked.length + ' selected'; kb = picked.reduce((a, s) => a + s.kb, 0);
    extra = h('button', { class: 'btn ghost sm', onclick: () => { sugs().filter(s => s.risk === 'safe').forEach(s => S.sel.add(s.id)); render(); } }, 'Select all safe');
    clear = () => { S.sel.clear(); render(); }; runAll = () => confirmClean(picked, {});
  } else if (S.page === 'tasks' || S.page === 'overview') {
    const picked = tasks().filter(t => S.tsel.has(t.id)); if (!picked.length) return;
    label = picked.length + ' task' + (picked.length > 1 ? 's' : '') + ' selected'; kb = picked.reduce((a, t) => a + (t.kb || 0), 0);
    clear = () => { S.tsel.clear(); render(); }; runAll = () => confirmTasks(picked);
  } else return;
  document.body.append(h('div', { class: 'actionbar', id: 'abar' }, h('div', { class: 'in' }, h('div', null, h('b', null, label), kb ? h('span', { class: 'muted' }, ' · ' + fmt(kb)) : null),
    extra, h('button', { class: 'btn ghost sm', onclick: clear }, 'Clear'),
    h('button', { class: 'btn', onclick: runAll }, S.page === 'cleanup' ? 'Clean up' : 'Run selected'))));
}
function itemRow(s) {
  const cb = h('input', { type: 'checkbox', class: 'check', onchange: e => { e.target.checked ? S.sel.add(s.id) : S.sel.delete(s.id); updateBar(); } }); cb.checked = S.sel.has(s.id);
  return h('div', { class: 'item' }, cb,
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, s.title, h('span', { class: 'chip' }, s.label), h('span', { class: 'chip ' + s.risk }, s.risk === 'safe' ? 'Safe' : 'Review')),
      h('div', { class: 'p', title: s.path }, rel(s.path)), h('div', { class: 'why' }, s.reason), h('div', { class: 'undo' }, '↺ ' + s.restore)),
    h('button', { class: 'icon-btn', title: 'Show in Finder', onclick: () => post('/api/reveal', { path: s.path }) }, icon('reveal')), h('div', { class: 'sz' }, fmt(s.kb)));
}
function confirmClean(picked, meta) {
  const needsMode = picked.some(s => s.method === 'trash'), kb = picked.reduce((a, s) => a + s.kb, 0), hasTrash = picked.some(s => s.method === 'emptytrash');
  let mode = 'trash';
  const m = document.getElementById('modal'), body = h('div', { class: 'modal' }), opts = h('div');
  const optEl = (v, t, d) => h('label', { class: 'opt' + (mode === v ? ' sel' : ''), onclick: () => { mode = v; drawOpts(); document.getElementById('go').classList.toggle('danger', mode === 'permanent'); } }, h('input', { type: 'radio', name: 'm', checked: mode === v }), h('div', null, h('b', null, t), h('span', null, d)));
  const drawOpts = () => opts.replaceChildren(optEl('trash', 'Move to Trash (recommended)', 'Installers and files can be put back. Space is freed when you empty the Trash.'), optEl('permanent', 'Delete permanently', 'Frees the space right away. Cannot be undone.'));
  drawOpts();
  body.append(h('h3', null, `Clean up ${fmt(kb)}?`), h('p', { class: 'lead' }, `${picked.length} item${picked.length > 1 ? 's' : ''} will be removed.` + (hasTrash ? ' Emptying the Trash is permanent.' : '')),
    h('ul', null, picked.slice(0, 60).map(s => h('li', null, h('span', null, s.title), h('span', { class: 'num' }, fmt(s.kb))))),
    needsMode ? opts : h('p', { class: 'small muted' }, 'These are regenerable files, so they are deleted directly — nothing important is lost.'),
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.hidden = true }, 'Cancel'),
      h('button', { class: 'btn', id: 'go', onclick: async e => {
        e.target.disabled = true; e.target.textContent = 'Cleaning…';
        try {
          const r = await post('/api/clean', { ids: picked.map(s => s.id), mode, taskId: meta.taskId, taskTitle: meta.taskTitle });
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
  S.loadingDir = false; if (S.page === 'explorer') render({ top: true });
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
  root.append(h('div', { class: 'card flat', style: 'padding:14px 18px;margin-bottom:24px;flex-direction:row;justify-content:space-between;align-items:center' }, h('div', { class: 'crumbs' }, crumbs),
    h('div', { class: 'muted' }, h('span', { class: 'num', style: 'color:var(--ink)' }, fmt(d.totalKB)), ' total ', S.loadingDir ? h('span', { class: 'spin' }) : '')));
  const rows = d.rows, mx = rows[0]?.kb || 1, tm = h('div', { class: 'treemap' });
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s12' }, cardHead('Map', h('span', { class: 'muted small' }, 'Bigger box = more space · click a folder to open it')), tm)));
  requestAnimationFrame(() => {
    const W = tm.clientWidth, H = tm.clientHeight, items = rows.slice(0, 24).map((r, i) => ({ r, v: r.kb, c: TM_COLORS[i % TM_COLORS.length] }));
    squarify(items, 0, 0, W, H).forEach(b => tm.append(h('div', { class: 'tm', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`, title: `${b.r.name} · ${fmt(b.r.kb)}`,
      onclick: () => b.r.kind === 'dir' ? loadDir(b.r.path) : post('/api/reveal', { path: b.r.path }) }, h('div', { style: `background:${b.c}` }, b.w > 70 && b.h > 38 ? [h('div', { class: 'n' }, b.r.name), h('div', { class: 's' }, fmt(b.r.kb))] : null))));
  });
  const list = h('div', { class: 'card s12' }, cardHead('Contents', h('span', { class: 'muted small' }, `${rows.length} largest items`)),
    rows.length ? rows.map(r => h('div', { class: 'xrow' }, h('span', null, svg(r.kind === 'dir' ? ICON.folder : ICON.file)),
      h('div', { class: 'nm', onclick: () => r.kind === 'dir' ? loadDir(r.path) : post('/api/reveal', { path: r.path }) }, h('b', { title: r.path }, r.name), h('div', { class: 'track' }, h('i', { style: `width:${r.kb / mx * 100}%` }))),
      h('span', { class: 'num', style: 'text-align:right' }, fmt(r.kb)),
      h('div', { class: 'acts' }, h('span', { class: 'muted small', style: 'align-self:center;margin-right:6px' }, r.mtime ? ago(r.mtime) : ''),
        h('button', { class: 'icon-btn', title: 'Show in Finder', onclick: () => post('/api/reveal', { path: r.path }) }, icon('reveal')),
        h('button', { class: 'icon-btn', title: 'Move to Trash', onclick: () => confirmTrash(r) }, icon('trash'))))) : h('div', { class: 'empty' }, 'No large items in here.'));
  if (d.otherKB > 1024) list.append(h('div', { class: 'xrow muted' }, h('span'), h('div', null, 'Smaller files & folders'), h('span', { class: 'num', style: 'text-align:right' }, fmt(d.otherKB)), h('span')));
  root.append(h('div', { class: 'grid' }, list));
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
  const root = h('div');
  const tabs = h('div', { class: 'tabs' }, ['24h', '7d', '30d', 'all'].map(k => h('button', { class: 'tab' + (S.range === k ? ' active' : ''), onclick: () => { S.range = k; render(); } }, k === 'all' ? 'All' : k)));
  root.append(header('History', 'Free space over time — recorded while the app is running', tabs));
  root.append(h('div', { class: 'grid' }, h('div', { class: 's12', style: 'display:grid' }, trendCard(S.range, 280, 'Free space'))));
  const acts = [...(S.st.actions || [])].reverse();
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s12' }, cardHead('Cleanup log', h('span', { class: 'muted small' }, `${fmt(freedKB())} freed in total`)),
    acts.length ? h('div', { class: 'list' }, acts.slice(0, 40).map(a => h('div', { class: 'row' }, h('div', null, h('div', { style: 'font-weight:600' }, a.title, ' ', h('span', { class: 'chip' }, a.how === 'trash' ? 'Moved to Trash' : 'Deleted')),
      h('div', { class: 'small muted mono' }, rel(a.path)), h('div', { class: 'small muted' }, ago(a.t))), h('span', { class: 'num' }, fmt(a.kb))))) : h('div', { class: 'empty' }, 'Nothing cleaned yet.'))));
  return root;
}

/* ---------- updates, notices, settings ---------- */
const dismissed = () => { try { return JSON.parse(localStorage.getItem('sd-dismissed') || '[]'); } catch { return []; } };
const dismiss = id => { try { localStorage.setItem('sd-dismissed', JSON.stringify([...dismissed(), id].slice(-30))); } catch { /* ignore */ } render(); };
function appBanners() {
  const a = S.st.app, out = []; if (!a) return out;
  if (a.update.available) {
    const v = a.update.latest.version;
    out.push(h('div', { class: 'banner ' + (a.update.mandatory ? 'crit' : 'ok'), style: 'margin-top:-8px' }, h('span', { class: 'dot', style: `background:${a.update.mandatory ? 'var(--red)' : 'var(--primary)'}` }),
      h('div', { class: 'grow' }, h('b', null, a.update.mandatory ? `Update required — Storage ${v}` : `Storage ${v} is available`), h('div', { class: 'small muted' }, a.appManaged ? 'Restart to update. It takes a few seconds and keeps all your data.' : 'Download the latest release to update.')),
      a.appManaged ? h('button', { class: 'btn sm', onclick: confirmUpdate }, 'Restart to update') : h('button', { class: 'btn sm', onclick: () => go('settings') }, 'How to update'),
      a.update.mandatory ? null : h('button', { class: 'btn ghost sm', onclick: () => dismiss('u' + v) }, 'Later')));
    if (!a.update.mandatory && dismissed().includes('u' + v)) out.pop();
  }
  (a.notices || []).filter(n => !dismissed().includes('n' + n.id)).forEach(n => out.push(h('div', { class: 'banner ' + (n.kind === 'critical' ? 'crit' : n.kind === 'warn' ? 'warn' : 'ok'), style: 'margin-top:-8px' },
    h('span', { class: 'dot', style: `background:${n.kind === 'critical' ? 'var(--red)' : n.kind === 'warn' ? 'var(--orange)' : 'var(--primary)'}` }), h('div', { class: 'grow' }, h('b', null, n.message)), h('button', { class: 'btn ghost sm', onclick: () => dismiss('n' + n.id) }, 'Dismiss'))));
  return out;
}
function confirmUpdate() {
  const a = S.st.app, v = a.update.latest.version, m = document.getElementById('modal');
  const body = h('div', { class: 'modal' }, h('h3', null, `Update to Storage ${v}?`), h('p', { class: 'lead' }, 'Storage will download the update, verify it, quit and reopen by itself. Your settings and history are kept.'),
    a.update.latest.notes ? h('div', { class: 'note', style: 'white-space:pre-line;max-height:160px;overflow:auto;margin-bottom:6px' }, a.update.latest.notes) : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => m.hidden = true }, 'Not now'), h('button', { class: 'btn', onclick: async e => {
      e.target.disabled = true; e.target.textContent = 'Downloading & verifying…';
      try { await post('/api/app/install'); m.hidden = true; updatingOverlay(v); } catch (err) { m.hidden = true; toast(err.message, 7000); }
    } }, 'Update & restart')));
  m.replaceChildren(body); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; };
}
function updatingOverlay(v) {
  const w = h('div', { class: 'done-wrap', style: 'cursor:default' }, h('div', { class: 'done-card' }, h('img', { src: '/logo.svg', style: 'width:84px;height:84px;animation:pop-in .6s both' }), h('h3', null, `Updating to ${v}…`), h('p', null, 'Storage is restarting. This window will reconnect on its own.'), h('div', { class: 'bar', style: 'margin-top:18px;height:6px;border-radius:9px;background:var(--line);overflow:hidden' }, h('i', { style: 'display:block;height:100%;width:40%;background:var(--primary);border-radius:9px;animation:glide 1.2s ease-in-out infinite' }))));
  document.body.append(w);
  const t0 = Date.now(), tick = async () => { try { const j = await api('/api/app'); if (j.version === v) return location.reload(); } catch { /* restarting */ } if (Date.now() - t0 > 90000) { w.remove(); toast('The update did not finish — please reopen Storage.', 8000); } else setTimeout(tick, 1500); };
  setTimeout(tick, 4000);
}
function consentModal() {
  const a = S.st.app; if (!a || !a.telemetry.adminConfigured || a.telemetry.mode !== 'unset') return;
  const m = document.getElementById('modal'), choose = async mode => { try { await post('/api/app/telemetry', { mode }); } catch (e) { toast(e.message); } m.hidden = true; await refresh(true); };
  let payloadBox = h('pre', { class: 'note mono', style: 'display:none;white-space:pre-wrap;margin:10px 0 0' });
  api('/api/app').then(j => { payloadBox.textContent = JSON.stringify(j.payload, null, 2); });
  m.replaceChildren(h('div', { class: 'modal' }, h('img', { src: '/logo.svg', style: 'width:56px;height:56px;margin-bottom:10px' }), h('h3', null, 'Help improve Storage?'),
    h('p', { class: 'lead' }, `Share an anonymous check-in with ${a.telemetry.adminHost} so the developer can count installs and tell you when an update is out.`),
    h('ul', { style: 'max-height:none' }, ['Random install id (not tied to you or your Mac)', 'App version, macOS version, Apple silicon / Intel'].map(t => h('li', null, h('span', null, '✓ ' + t)))),
    h('p', { class: 'small muted', style: 'margin:0' }, 'Never sent: file names, folders, sizes, your name, or anything from your disk. Change your mind any time in Settings.'),
    h('button', { class: 'btn ghost sm', style: 'margin-top:12px', onclick: () => { payloadBox.style.display = payloadBox.style.display === 'none' ? 'block' : 'none'; } }, 'Show exactly what is sent'), payloadBox,
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => choose('off') }, 'No thanks'), h('button', { class: 'btn', onclick: () => choose('on') }, 'Share anonymously'))));
  m.hidden = false;
}
function pageSettings() {
  const root = h('div');
  if (!S.info || Date.now() - S.infoAt > 30000) { S.infoAt = Date.now(); api('/api/app').then(j => { S.info = j; S.st.app = { ...j }; if (S.page === 'settings') render(); }).catch(() => {}); }
  const info = S.info || S.st.app;
  const u = info.update, tl = info.telemetry;
  const statusLine = u.available ? `Version ${u.latest.version} is available (you have ${info.version}).` : u.error && !u.checkedAt ? 'Not checked yet.' : `You’re up to date — version ${info.version}.`;
  root.append(header('Settings', 'Updates, privacy and about', null));
  const checkBtn = h('button', { class: 'btn ghost', onclick: async e => { e.target.disabled = true; e.target.textContent = 'Checking…'; try { S.st.app = await post('/api/app/check'); S.info = null; } catch (x) { toast(x.message); } render(); } }, 'Check now');
  const updCard = h('div', { class: 'card s6' }, cardHead('Updates', h('span', { class: 'chip ' + (u.available ? 'review' : 'safe') }, u.available ? 'Update available' : 'Up to date')),
    h('div', { class: 'card-body' }, h('div', { style: 'font-size:17px;font-weight:600' }, statusLine), h('div', { class: 'small muted', style: 'margin-top:6px' }, u.checkedAt ? `Last checked ${ago(u.checkedAt)}${u.source ? ' via ' + (u.source === 'admin' ? tl.adminHost : 'GitHub releases') : ''}` : 'Checks automatically every few hours.'),
      u.error ? h('div', { class: 'small', style: 'margin-top:8px;color:var(--orange)' }, 'Last check failed: ' + u.error) : null,
      u.available && u.latest.notes ? h('div', { class: 'note', style: 'margin-top:14px;white-space:pre-line;max-height:150px;overflow:auto' }, u.latest.notes) : null,
      !info.appManaged ? h('div', { class: 'note', style: 'margin-top:14px' }, 'You’re running from source. Update with ', h('span', { class: 'cmd' }, 'git pull'), ' or rebuild the app with ', h('span', { class: 'cmd' }, './macos/build.sh --install'), '.') : null),
    h('div', { style: 'display:flex;gap:10px;margin-top:18px' }, checkBtn, u.available && info.appManaged ? h('button', { class: 'btn', onclick: confirmUpdate }, 'Restart to update') : null));
  const sw = h('input', { type: 'checkbox', class: 'switch', disabled: !tl.adminConfigured, onchange: async e => { try { S.st.app = await post('/api/app/telemetry', { mode: e.target.checked ? 'on' : 'off' }); S.info = null; toast(e.target.checked ? 'Thanks! Anonymous check-ins are on.' : 'Telemetry is off.'); } catch (x) { toast(x.message); } render(); } }); sw.checked = tl.mode === 'on';
  const privCard = h('div', { class: 'card s6' }, cardHead('Privacy', h('span', { class: 'chip ' + (tl.mode === 'on' ? 'review' : 'safe') }, tl.mode === 'on' ? 'Sharing check-ins' : 'Nothing is sent')),
    h('div', { class: 'card-body' }, tl.adminConfigured ? h('label', { style: 'display:flex;gap:14px;align-items:center;cursor:pointer' }, sw, h('div', null, h('b', null, 'Share anonymous check-ins'), h('div', { class: 'small muted' }, `Sent to ${tl.adminHost} so you get update notices and the developer can count installs.`)))
      : h('div', { class: 'note' }, 'This build has no telemetry server configured, so ', h('b', null, 'nothing is ever sent'), '. Update checks only ask GitHub for the latest release.'),
      h('div', { class: 'small muted', style: 'margin:16px 0 6px' }, 'The complete check-in, exactly as sent:'), h('pre', { class: 'note mono', style: 'white-space:pre-wrap;margin:0' }, info.payload ? JSON.stringify(info.payload, null, 2) : 'Loading…'),
      h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Never sent: file names, folder paths, sizes, your name or IP-linked identifiers.')),
    tl.adminConfigured ? h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn ghost sm', onclick: async () => { try { await post('/api/app/forget'); S.info = null; toast('Your record was deleted from the server.'); await refresh(true); } catch (x) { toast(x.message); } } }, 'Delete my data from the server')) : null);
  const about = h('div', { class: 'card s12', style: 'flex-direction:row;align-items:center;gap:24px' }, h('img', { src: '/logo.svg', style: 'width:72px;height:72px;filter:drop-shadow(0 6px 12px rgba(20,120,80,.3))' }),
    h('div', { style: 'flex:1' }, h('h2', null, 'Storage ' + info.version), h('div', { class: 'small muted', style: 'margin-top:4px' }, `Free & open source · MIT license · install ${info.installId}…`)),
    h('a', { class: 'btn ghost', href: 'https://github.com/' + (u.repo || 'vimalsri318/storage-dashboard'), target: '_blank', rel: 'noopener' }, 'View on GitHub'));
  root.append(h('div', { class: 'grid' }, updCard, privCard, about));
  return root;
}

/* ---------- render loop ----------
 * Re-rendering used to replay the entry animation and jump the scroll, which looked like a page reload on every
 * click. Now the animation only runs on real navigation, and the scroll position is kept on in-page updates. */
const PAGES = { overview: pageOverview, tasks: pageTasks, cleanup: pageCleanup, explorer: pageExplorer, history: pageHistory };
PAGES.settings = pageSettings;
function render(opts = {}) {
  if (!S.st) return;
  const y = window.scrollY;
  renderShell();
  const main = document.getElementById('main');
  const page = PAGES[S.page](), sc = scanCard(S.page !== 'overview');
  const bn = appBanners(); let anchor = page.children[0];
  [...bn].reverse().forEach(b => anchor ? anchor.after(b) : page.append(b));
  if (sc && page.children[0]) page.children[0].after(sc);
  main.replaceChildren(page);
  main.classList.toggle('enter', !!opts.anim);
  if (opts.top) window.scrollTo(0, 0); else window.scrollTo(0, y);
  updateBar();
}
async function refresh(force) {
  try {
    S.st = await api('/api/state');
    const ids = new Set(sugs().map(s => s.id)); [...S.sel].forEach(i => { if (!ids.has(i)) S.sel.delete(i); });
    const tids = new Set(tasks().map(t => t.id)); [...S.tsel].forEach(i => { if (!tids.has(i)) S.tsel.delete(i); });
    render();
  } catch (e) { /* server restarting */ }
}
let polling = false;
async function poll() {
  if (polling) return; polling = true;
  while (S.st?.scan.running) {
    await new Promise(r => setTimeout(r, 700));
    try { const s = await api('/api/status'); const phaseChanged = S.st.scan.phase !== s.scan.phase; S.st.scan = s.scan; S.st.disk = s.disk; updateScanCard(); if (phaseChanged) renderShell(); } catch { /* ignore */ }
    if (!S.st.scan.running) { await refresh(true); scanComplete(); }
  }
  polling = false;
}
(async function init() {
  const h0 = location.hash.slice(1); if (PAGES[h0]) S.page = h0;
  await refresh(true);
  render({ anim: true });
  consentModal();
  setTimeout(() => { const sp = document.getElementById('splash'); if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 600); } }, 900);
  if (S.page === 'explorer') loadDir(S.st.home);
  poll();
  setInterval(async () => {
    if (document.hidden || S.st.scan.running || !document.getElementById('modal').hidden || S.busy.size) return;
    const s = await api('/api/status').catch(() => null); if (!s) return;
    S.st.disk = s.disk; if (S.page === 'overview' || S.page === 'tasks') await refresh();
  }, 30000);
})();
