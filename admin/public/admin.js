'use strict';
/* Storage Fleet Admin — vanilla JS, all text via textContent. */
const S = { me: null, page: 'overview', csrf: '', filter: '', q: '', stats: null };
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in (attrs || {})) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const svgEl = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };
const toast = (m, ms = 3000) => { const t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); };
const ago = ms => { if (!ms) return '—'; const d = Math.floor((Date.now() - ms) / 864e5); if (d <= 0) { const m = Math.floor((Date.now() - ms) / 6e4); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ago'; } return d === 1 ? 'yesterday' : d + ' days ago'; };
const dt = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
async function api(path, body, method) {
  const opt = { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(S.csrf ? { 'x-csrf': S.csrf } : {}) } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt); const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.me) { S.me = null; boot(); }
  if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
const COLORS = { current: 'var(--primary)', outdated: 'var(--orange)', unsupported: 'var(--red)', stale: '#8e8e93' };
const ICON = { home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', devices: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', rocket: '<path d="M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2M14 4c3-1 6-1 7-1 0 1 0 4-1 7l-6 6-5-5 5-7zM9 14l-3-1 2-4 4-1"/>', bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 004 0"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 118 0v4"/>' };
const icon = n => svgEl(`<svg class="ico" viewBox="0 0 24 24" style="width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round">${ICON[n]}</svg>`);

/* ---------- login / setup ---------- */
function authScreen(needsSetup) {
  const err = h('div', { class: 'err' }), u = h('input', { type: 'text', autocomplete: 'username', placeholder: 'admin' }), pw = h('input', { type: 'password', autocomplete: needsSetup ? 'new-password' : 'current-password' }), tok = h('input', { type: 'text', placeholder: 'printed in the server console', autocomplete: 'off' });
  const go = async e => {
    e.preventDefault(); err.textContent = '';
    try {
      if (needsSetup) { await api('/api/admin/setup', { token: tok.value.trim(), username: u.value.trim(), password: pw.value }); toast('Admin created — sign in'); S.needsSetup = false; return boot(); }
      const r = await api('/api/admin/login', { username: u.value.trim(), password: pw.value }); S.csrf = r.csrf; boot();
    } catch (x) { err.textContent = x.message; }
  };
  return h('div', { class: 'login' }, h('form', { class: 'box', onsubmit: go }, h('img', { src: '/shared/logo.svg', alt: '' }), h('h1', null, needsSetup ? 'Set up Fleet Admin' : 'Fleet Admin'), h('div', { class: 'sub' }, needsSetup ? 'Create the first administrator.' : 'Sign in to manage devices and releases.'),
    needsSetup ? h('div', { class: 'field' }, h('label', null, 'Setup token'), tok) : null,
    h('div', { class: 'field' }, h('label', null, 'Username'), u), h('div', { class: 'field' }, h('label', null, needsSetup ? 'Password (12+ characters)' : 'Password'), pw), err,
    h('button', { class: 'btn', style: 'width:100%;padding:12px', type: 'submit' }, needsSetup ? 'Create admin' : 'Sign in')));
}

/* ---------- charts ---------- */
function activityChart(series) {
  const W = 900, H = 240, P = { l: 38, r: 10, t: 12, b: 26 }, mx = Math.max(5, ...series.map(d => Math.max(d.active, d.added))) * 1.15;
  const X = i => P.l + i * (W - P.l - P.r) / (series.length - 1), Y = v => P.t + (1 - v / mx) * (H - P.t - P.b), bw = (W - P.l - P.r) / series.length * .5;
  let g = ''; for (let i = 0; i <= 4; i++) { const v = mx * i / 4; g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const bars = series.map((d, i) => `<rect x="${X(i) - bw / 2}" y="${Y(d.added)}" width="${bw}" height="${H - P.b - Y(d.added)}" rx="3" fill="var(--blue)" opacity=".75"><title>${d.day}: ${d.added} new</title></rect>`).join('');
  const line = series.map((d, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d.active).toFixed(1)).join(' ');
  return svgEl(`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:240px"><defs><linearGradient id="aa" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".25"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>${g}${bars}
    <path d="${line} L${X(series.length - 1)} ${H - P.b} L${X(0)} ${H - P.b} Z" fill="url(#aa)"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <text x="${P.l}" y="${H - 6}">${series[0].day.slice(5)}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${series[series.length - 1].day.slice(5)}</text></svg>`);
}
const hbars = (rows, color) => { const mx = Math.max(1, ...rows.map(r => r.v)); return rows.length ? rows.map(r => h('div', { class: 'hbar' }, h('span', { class: 'mono' }, r.k), h('div', { class: 't' }, h('i', { style: `width:${r.v / mx * 100}%;background:${typeof color === 'function' ? color(r) : color}` })), h('span', { class: 'num', style: 'text-align:right' }, r.v))) : h('div', { class: 'muted small' }, 'No data yet'); };

/* ---------- pages ---------- */
const kpi = (label, value, sub, c) => h('div', { class: 'card stat kpi s3' }, h('div', { class: 'k' }, h('span', { class: 'dot', style: `background:${c}` }), label), h('div', { class: 'v' }, value), h('div', { class: 'd' }, sub));
async function pageOverview() {
  const s = S.stats = await api('/api/admin/stats'), root = h('div'), live = s.total - s.statuses.stale, pct = live ? Math.round(s.statuses.current / live * 100) : 0, behind = s.statuses.outdated + s.statuses.unsupported;
  root.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Fleet'), h('div', { class: 'sub' }, 'Anonymous, opt-in installs of Storage')), h('button', { class: 'btn ghost', onclick: () => render() }, 'Refresh')));
  root.append(h('div', { class: 'grid' }, kpi('Devices', s.total, `${s.new7} new this week · ${s.new30} this month`, 'var(--blue)'), kpi('Active (7 days)', s.active7, `${s.active1} today · ${s.active30} in 30 days`, 'var(--primary)'),
    kpi('On latest version', live ? pct + '%' : '—', s.latest ? `v${s.latest} · ${s.statuses.current} of ${live} active devices` : 'No release published yet', 'var(--primary)'), kpi('Need an update', behind, `${s.statuses.unsupported} below the minimum version`, behind ? 'var(--orange)' : 'var(--primary)')));
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s8' }, h('div', { class: 'card-head' }, h('h2', null, 'Activity · 30 days'), h('div', { class: 'mini-legend', style: 'margin:0' }, h('span', null, h('i', { class: 'legend-sq', style: 'background:var(--primary)' }), 'Active devices'), h('span', null, h('i', { class: 'legend-sq', style: 'background:var(--blue)' }), 'New devices'))), h('div', { class: 'card-body' }, activityChart(s.series))),
    h('div', { class: 'card s4' }, h('div', { class: 'card-head' }, h('h2', null, 'Update status')), h('div', { class: 'card-body' }, ['current', 'outdated', 'unsupported', 'stale'].map(k => h('div', { class: 'hbar', style: 'grid-template-columns:96px 1fr 40px' }, h('span', null, h('i', { class: 'legend-sq', style: `background:${COLORS[k]}` }), k[0].toUpperCase() + k.slice(1)), h('div', { class: 't' }, h('i', { style: `width:${s.total ? s.statuses[k] / s.total * 100 : 0}%;background:${COLORS[k]}` })), h('span', { class: 'num', style: 'text-align:right' }, s.statuses[k]))),
      behind ? h('button', { class: 'btn sm', style: 'margin-top:14px', onclick: () => { S.prefill = `Storage ${s.latest} is available — open Settings › Updates and restart to install it.`; go('notices'); } }, `Notify ${behind} device${behind > 1 ? 's' : ''}`) : h('div', { class: 'muted small', style: 'margin-top:14px' }, 'Everyone active is up to date 🎉')))));
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s6' }, h('div', { class: 'card-head' }, h('h2', null, 'App versions')), h('div', { class: 'card-body' }, hbars(s.versions, r => r.k === s.latest ? 'var(--primary)' : 'var(--orange)'))),
    h('div', { class: 'card s3' }, h('div', { class: 'card-head' }, h('h2', null, 'macOS')), h('div', { class: 'card-body' }, hbars(s.os.map(r => ({ k: 'macOS ' + r.k, v: r.v })), 'var(--blue)'))),
    h('div', { class: 'card s3' }, h('div', { class: 'card-head' }, h('h2', null, 'Chip')), h('div', { class: 'card-body' }, hbars(s.arch.map(r => ({ k: r.k === 'arm64' ? 'Apple silicon' : 'Intel', v: r.v })), '#bf5af2')))));
  return root;
}
async function pageDevices() {
  const r = await api(`/api/admin/devices?limit=100&status=${S.filter}&q=${encodeURIComponent(S.q)}`), root = h('div');
  const tabs = h('div', { class: 'tabs' }, [['', 'All'], ['current', 'Current'], ['outdated', 'Outdated'], ['unsupported', 'Unsupported'], ['stale', 'Stale']].map(([k, l]) => h('button', { class: 'tab' + (S.filter === k ? ' active' : ''), onclick: () => { S.filter = k; render(); } }, l)));
  const search = h('input', { type: 'text', placeholder: 'Search id, version, macOS…', value: S.q, onkeydown: e => { if (e.key === 'Enter') { S.q = e.target.value.trim(); render(); } } });
  root.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Devices'), h('div', { class: 'sub' }, `${r.total} device${r.total === 1 ? '' : 's'} · ids are anonymous hashes`)), h('a', { class: 'btn ghost', href: '/api/admin/devices.csv', download: 'devices.csv' }, 'Export CSV')));
  root.append(h('div', { class: 'toolbar' }, tabs, search));
  root.append(h('div', { class: 'card' }, r.rows.length ? h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Device', 'Version', 'macOS', 'Chip', 'Status', 'Told about update', 'Last seen', 'First seen', ''].map(x => h('th', null, x)))),
    h('tbody', null, r.rows.map(d => h('tr', null, h('td', { class: 'mono' }, d.short), h('td', { class: 'mono' }, 'v' + d.version), h('td', null, d.os), h('td', null, d.arch === 'arm64' ? 'Apple silicon' : 'Intel'), h('td', null, h('span', { class: 'chip ' + d.status }, d.status)),
      h('td', { class: 'muted' }, d.notifiedAt && d.status !== 'current' ? `v${d.notifiedVersion} · ${ago(d.notifiedAt)}` : '—'), h('td', null, ago(d.lastSeen)), h('td', { class: 'muted' }, ago(d.firstSeen)),
      h('td', null, h('button', { class: 'icon-btn', title: 'Forget this device', onclick: () => confirmBox(`Remove device ${d.short}?`, 'It disappears from your stats. If it checks in again it will be re-added.', 'Remove', async () => { await api('/api/admin/devices/delete', { short: d.short }); toast('Removed'); render(); }) }, svgEl('<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'))))))) : h('div', { class: 'empty' }, h('b', null, 'No devices match'), 'Devices appear here once users opt in to anonymous check-ins.')));
  return root;
}
async function pageReleases() {
  const { releases } = await api('/api/admin/releases'), root = h('div');
  root.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Releases'), h('div', { class: 'sub' }, 'Published automatically by your GitHub release workflow, or by hand')), h('button', { class: 'btn', onclick: publishForm }, 'Publish release')));
  root.append(h('div', { class: 'card' }, releases.length ? releases.map(r => {
    const pct = r.adoption.active ? Math.round(r.adoption.updated / r.adoption.active * 100) : 0;
    return h('div', { class: 'rel' }, h('div', null, h('h3', null, 'v' + r.version, r.yanked ? h('span', { class: 'chip unsupported' }, 'yanked') : null, r.min_supported ? h('span', { class: 'chip' }, 'min v' + r.min_supported) : null), h('div', { class: 'small muted', style: 'margin-top:4px' }, `Published ${dt(r.published_at)} · rollout ${r.rollout}%`), h('div', { class: 'small', style: 'margin-top:6px;color:var(--ink-2);white-space:pre-line;max-height:60px;overflow:hidden' }, r.notes || '')),
      h('div', null, h('div', { class: 'small muted', style: 'display:flex;justify-content:space-between' }, h('span', null, 'Updated'), h('b', { style: 'color:var(--ink)' }, `${r.adoption.updated} of ${r.adoption.active} (${pct}%)`)), h('div', { class: 'meter', style: 'margin-top:8px' }, h('i', { style: `width:${pct}%` }))),
      h('div', { class: 'row-acts' }, h('button', { class: 'btn ghost sm', onclick: () => adoptionDetail(r.version) }, 'Who’s pending'), h('button', { class: 'btn ghost sm', onclick: () => rolloutForm(r) }, 'Rollout'), h('button', { class: 'btn ghost sm', onclick: async () => { await api('/api/admin/releases/update', { version: r.version, yanked: !r.yanked }); render(); } }, r.yanked ? 'Restore' : 'Yank')));
  }) : h('div', { class: 'empty' }, h('b', null, 'No releases yet'), 'Push a version tag to GitHub (the release workflow publishes here), or add one manually.')));
  return root;
}
async function pageNotices() {
  const { notices } = await api('/api/admin/notices'), root = h('div'); const prefill = S.prefill || ''; S.prefill = '';
  const msg = h('textarea', { maxlength: 280, placeholder: 'e.g. Storage 1.2.0 fixes a scan bug — open Settings › Updates and restart to install.' }); msg.value = prefill;
  const kind = h('select', null, ...[['info', 'Info'], ['warn', 'Warning'], ['critical', 'Critical']].map(([v, l]) => h('option', { value: v }, l))), aud = h('select', null, h('option', { value: 'outdated' }, 'Only devices that are behind'), h('option', { value: 'all' }, 'Everyone')), days = h('input', { type: 'number', min: 1, max: 90, value: 14 });
  root.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Notices'), h('div', { class: 'sub' }, 'Shown inside the app (banner + badge + macOS notification) the next time a device checks in'))));
  root.append(h('div', { class: 'grid' }, h('form', { class: 'card s5', onsubmit: async e => { e.preventDefault(); try { await api('/api/admin/notices', { message: msg.value, kind: kind.value, audience: aud.value, days: +days.value }); toast('Notice published'); render(); } catch (x) { toast(x.message); } } },
    h('div', { class: 'card-head' }, h('h2', null, 'New notice')), h('div', { class: 'field' }, h('label', null, 'Message (max 280)'), msg), h('div', { class: 'field' }, h('label', null, 'Style'), kind), h('div', { class: 'field' }, h('label', null, 'Audience'), aud), h('div', { class: 'field' }, h('label', null, 'Show for (days)'), days), h('button', { class: 'btn', type: 'submit' }, 'Publish notice')),
    h('div', { class: 'card s7' }, h('div', { class: 'card-head' }, h('h2', null, 'History')), notices.length ? h('div', { class: 'list' }, notices.map(n => h('div', { class: 'row' }, h('div', null, h('div', { style: 'font-weight:600' }, n.message), h('div', { class: 'small muted', style: 'margin-top:4px' }, `${n.kind} · ${n.audience === 'all' ? 'everyone' : 'outdated devices'} · ${ago(n.created_at)} · delivered to ${n.delivered} device${n.delivered === 1 ? '' : 's'}`)),
      n.active && n.expires_at > Date.now() ? h('button', { class: 'btn ghost sm', onclick: async () => { await api('/api/admin/notices/disable', { id: n.id }); render(); } }, 'Stop') : h('span', { class: 'chip stale' }, 'ended')))) : h('div', { class: 'empty' }, 'No notices yet.'))));
  return root;
}
async function pageSecurity() {
  const { rows } = await api('/api/admin/audit?limit=100'), root = h('div');
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' }), days = h('input', { type: 'number', min: 30, max: 3650, value: 365 });
  root.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Security & privacy'), h('div', { class: 'sub' }, `Signed in as ${S.me}`)), h('button', { class: 'btn ghost', onclick: async () => { await api('/api/admin/logout', {}); S.me = null; S.csrf = ''; boot(); } }, 'Sign out')));
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s6' }, h('div', { class: 'card-head' }, h('h2', null, 'What this server stores')),
    h('div', { class: 'note' }, 'Per opted-in device — and nothing else:', h('ul', null, h('li', null, 'a hash of a random install id (not reversible, no hardware or account identifiers)'), h('li', null, 'app version, macOS version, Apple-silicon/Intel'), h('li', null, 'first seen / last seen / number of check-ins, and which update it was told about'))),
    h('div', { class: 'note', style: 'margin-top:12px' }, 'Never collected: IP addresses (only a salted hash for rate-limiting, kept in memory), file names, folder paths, sizes, usernames, or anything from your disk. Users can opt out or delete their record from the app at any time.'),
    h('div', { class: 'field', style: 'margin-top:18px' }, h('label', null, 'Delete devices not seen for (days)'), days), h('button', { class: 'btn ghost sm', style: 'align-self:start', onclick: () => confirmBox('Purge old devices?', 'Devices not seen for the chosen period are removed permanently.', 'Purge', async () => { const r = await api('/api/admin/purge', { days: +days.value }); toast(`Removed ${r.removed} device(s)`); render(); }) }, 'Purge now')),
    h('form', { class: 'card s6', onsubmit: async e => { e.preventDefault(); try { await api('/api/admin/password', { current: cur.value, password: nw.value }); toast('Password changed — other sessions signed out'); cur.value = nw.value = ''; render(); } catch (x) { toast(x.message, 4500); } } },
      h('div', { class: 'card-head' }, h('h2', null, 'Change password')), h('div', { class: 'field' }, h('label', null, 'Current password'), cur), h('div', { class: 'field' }, h('label', null, 'New password (12+ characters)'), nw), h('button', { class: 'btn', type: 'submit' }, 'Update password'),
      h('div', { class: 'note', style: 'margin-top:18px' }, 'Hardening in place: scrypt password hashing, 8-hour sessions in HttpOnly SameSite=Strict cookies, CSRF tokens on every change, login rate limiting, strict CSP, and an audit trail of every admin action. Serve it only over HTTPS.'))));
  root.append(h('div', { class: 'grid' }, h('div', { class: 'card s12' }, h('div', { class: 'card-head' }, h('h2', null, 'Audit log'), h('span', { class: 'muted small' }, 'latest 100')),
    h('table', { class: 'table' }, h('thead', null, h('tr', null, ['When', 'Who', 'Action', 'Detail'].map(x => h('th', null, x)))), h('tbody', null, rows.map(a => h('tr', null, h('td', { class: 'muted', style: 'white-space:nowrap' }, dt(a.t)), h('td', null, a.actor), h('td', null, h('span', { class: 'chip' }, a.action)), h('td', { class: 'mono' }, a.detail))))))));
  return root;
}

/* ---------- dialogs ---------- */
function openModal(content) { const m = document.getElementById('modal'); m.replaceChildren(h('div', { class: 'modal' }, content)); m.hidden = false; m.onclick = e => { if (e.target === m) m.hidden = true; }; return () => m.hidden = true; }
function confirmBox(title, text, label, fn) { let close; close = openModal([h('h3', null, title), h('p', { class: 'lead' }, text), h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn danger', onclick: async () => { try { await fn(); } catch (e) { toast(e.message); } close(); } }, label))]); }
function publishForm() {
  const f = { version: h('input', { type: 'text', placeholder: '1.1.0' }), url: h('input', { type: 'url', placeholder: 'https://github.com/…/releases/download/v1.1.0/Storage-1.1.0.zip' }), sha: h('input', { type: 'text', placeholder: '64 hex characters' }), size: h('input', { type: 'number', placeholder: 'bytes (optional)' }), min: h('input', { type: 'text', placeholder: 'optional, e.g. 1.0.0' }), roll: h('input', { type: 'number', min: 0, max: 100, value: 100 }), notes: h('textarea', { placeholder: 'What’s new' }) };
  const err = h('div', { class: 'err' }); let close;
  const field = (l, el, full) => h('div', { class: 'field' + (full ? ' full' : '') }, h('label', null, l), el);
  close = openModal([h('h3', null, 'Publish release'), h('p', { class: 'lead' }, 'Devices see it on their next check-in. Only GitHub release assets over HTTPS are accepted, and a SHA-256 is required.'),
    h('div', { class: 'form2' }, field('Version', f.version), field('Rollout %', f.roll), field('Download URL', f.url, true), field('SHA-256', f.sha, true), field('Size', f.size), field('Minimum supported version', f.min), field('Release notes', f.notes, true)), err,
    h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn', onclick: async () => { try { await api('/api/admin/releases', { version: f.version.value.trim(), url: f.url.value.trim(), sha256: f.sha.value.trim(), size: +f.size.value || 0, notes: f.notes.value, min_supported: f.min.value.trim() || undefined, rollout: +f.roll.value }); close(); toast('Published'); render(); } catch (e) { err.textContent = e.message; } } }, 'Publish'))]);
}
function rolloutForm(r) { const inp = h('input', { type: 'number', min: 0, max: 100, value: r.rollout }); let close; close = openModal([h('h3', null, `Rollout for v${r.version}`), h('p', { class: 'lead' }, 'Percentage of devices that are offered this release. Raise it gradually; set 0 to pause.'), h('div', { class: 'field' }, inp), h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn', onclick: async () => { try { await api('/api/admin/releases/update', { version: r.version, rollout: +inp.value }); close(); render(); } catch (e) { toast(e.message); } } }, 'Apply'))]); }
async function adoptionDetail(v) {
  const a = await api('/api/admin/releases/' + encodeURIComponent(v) + '/adoption');
  openModal([h('h3', null, `v${a.version} adoption`), h('p', { class: 'lead' }, `${a.updated} of ${a.active} active devices updated` + (a.medianDaysToUpdate != null ? ` · median ${a.medianDaysToUpdate} days to update` : '')),
    a.pending.length ? h('ul', null, a.pending.slice(0, 80).map(d => h('li', null, h('span', { class: 'mono' }, `${d.short}  v${d.version}  macOS ${d.os}`), h('span', { class: 'muted' }, d.notifiedAt ? `told ${ago(d.notifiedAt)}` : 'not yet told')))) : h('p', { class: 'small muted' }, 'Everyone active has this version. 🎉')]);
}

/* ---------- shell ---------- */
const PAGES = { overview: pageOverview, devices: pageDevices, releases: pageReleases, notices: pageNotices, security: pageSecurity };
const NAV = [['overview', 'Overview', 'home'], ['devices', 'Devices', 'devices'], ['releases', 'Releases', 'rocket'], ['notices', 'Notices', 'bell'], ['security', 'Security', 'lock']];
function go(p) { S.page = p; history.replaceState(null, '', '#' + p); render(true); }
async function render(anim) {
  const root = document.getElementById('root'); if (!S.me) return;
  const y = window.scrollY, main = h('main', { class: 'main' + (anim ? ' enter' : '') });
  const side = h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, h('img', { class: 'logo', src: '/shared/logo.svg', alt: '' }), h('span', null, 'Storage'), h('small', null, 'ADMIN')),
    h('nav', { id: 'nav' }, NAV.map(([id, l, ic]) => h('button', { class: 'nav-item' + (S.page === id ? ' active' : ''), onclick: () => go(id) }, icon(ic), l))), h('div', { class: 'side-foot' }, h('b', null, S.me), 'Signed in', h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn ghost sm', onclick: async () => { await api('/api/admin/logout', {}); S.me = null; S.csrf = ''; boot(); } }, 'Sign out'))));
  try { main.append(await PAGES[S.page]()); } catch (e) { main.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('b', null, 'Something went wrong'), e.message))); }
  root.replaceChildren(h('div', { class: 'app' }, side, main)); window.scrollTo(0, anim ? 0 : y);
}
async function boot() {
  const root = document.getElementById('root'), st = await fetch('/api/admin/state').then(r => r.json());
  if (st.loggedIn) { S.me = st.user; S.csrf = S.csrf || st.csrf; if (st.csrf) S.csrf = st.csrf; const p = location.hash.slice(1); if (PAGES[p]) S.page = p; return render(true); }
  S.me = null; root.replaceChildren(authScreen(st.needsSetup));
}
boot();
