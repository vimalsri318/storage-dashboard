#!/usr/bin/env node
'use strict';
// Fills a throw-away database with fake devices so you can explore the admin UI.
//   ADMIN_DB=admin/data/demo.db node admin/seed-demo.js && ADMIN_DB=admin/data/demo.db node admin/server.js
// Sign in with  demo / demo-password-123
const crypto = require('crypto');
process.env.ADMIN_DB = process.env.ADMIN_DB || require('path').join(__dirname, 'data', 'demo.db');
process.env.ADMIN_USER = 'demo'; process.env.ADMIN_PASSWORD = 'demo-password-123'; process.env.ALLOW_TEST_URLS = '1';
const { createApp } = require('./server');
const DAY = 864e5, now = Date.now(), app = createApp({ quiet: true });
(async () => {
  await app.bootstrap(); const db = app.db, sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const pepper = db.prepare("SELECT value FROM settings WHERE key='pepper'").get().value;
  const rel = (v, d, rollout = 100, min = null) => db.prepare('INSERT OR REPLACE INTO releases VALUES(?,?,?,?,?,?,?,?,0)').run(v, `https://github.com/vimalsri318/storage-dashboard/releases/download/v${v}/Storage-${v}.zip`, 'b'.repeat(64), 1200000, `Release ${v}\n• Faster scans\n• Checklist improvements`, min, now - d * DAY, rollout);
  rel('1.0.0', 40); rel('1.1.0', 21, 100, '1.0.0'); rel('1.2.0', 6, 60);
  const oses = ['15.1', '15.2', '15.3', '14.7', '26.0', '26.1'], rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  for (let i = 0; i < 260; i++) {
    const id = sha(pepper + crypto.randomUUID()), first = now - rnd(0, 60) * DAY, last = now - (Math.random() < .78 ? rnd(0, 6) : rnd(7, 45)) * DAY;
    const ver = Math.random() < .5 ? '1.2.0' : Math.random() < .7 ? '1.1.0' : '1.0.0';
    db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?,?)').run(id, first, Math.max(first, last), ver, oses[rnd(0, 5)], Math.random() < .88 ? 'arm64' : 'x86_64', rnd(1, 90), ver === '1.2.0' ? null : '1.2.0', ver === '1.2.0' ? null : now - rnd(1, 5) * DAY);
    db.prepare('INSERT INTO version_history VALUES(?,?,?)').run(id, ver, Math.max(first, last));
    for (let d = 0; d < 30; d++) { const t = now - d * DAY; if (t >= first && t <= Math.max(first, last) && Math.random() < .55) db.prepare('INSERT OR IGNORE INTO daily VALUES(?,?)').run(new Date(t).toISOString().slice(0, 10), id); }
  }
  db.prepare("INSERT INTO notices(message,kind,audience,created_at,expires_at) VALUES('Storage 1.2.0 is out — open Settings › Updates and restart to install it.','warn','outdated',?,?)").run(now - 2 * DAY, now + 12 * DAY);
  console.log('Demo data ready. Sign in with demo / demo-password-123'); app.close();
})();
