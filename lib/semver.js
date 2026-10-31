'use strict';
// Minimal semver (major.minor.patch with optional -prerelease) — enough for update checks.
const RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,32}))?$/;
const valid = v => typeof v === 'string' && RE.test(v);
function parse(v) { const m = RE.exec(v); if (!m) throw new Error('bad version: ' + v); return { n: [+m[1], +m[2], +m[3]], pre: m[4] || '' }; }
function cmp(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; if (!y.pre) return -1;     // a release is newer than its prerelease
  return x.pre < y.pre ? -1 : 1;
}
const clean = v => v.replace(/^v/, '');
module.exports = { valid, cmp, clean };
