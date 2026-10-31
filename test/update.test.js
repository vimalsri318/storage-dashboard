'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { create } = require('../lib/update');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
  const srv = http.createServer((req, res) => { res.end(Buffer.from('not really a zip')); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.STORAGE_TEST_HOSTS = `127.0.0.1:${srv.address().port}`;
  const u = create({ dataDir: dir, version: '1.0.0', rootDir: path.join(__dirname, '..'), appPath: '' });
  return { u, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
test('telemetry payload contains only the documented fields', async () => {
  const { u, close } = await setup(); const p = await u.payload();
  assert.deepEqual(Object.keys(p).sort(), ['ackNotices', 'arch', 'installId', 'os', 'v', 'version']);
  assert.match(p.installId, /^[0-9a-f-]{36}$/); close();
});
test('telemetry is off until the user opts in', async () => { const { u, close } = await setup(); assert.equal(u.state().telemetry.mode, 'unset'); close(); });
test('refuses releases without a checksum', async () => {
  const { u, base, close } = await setup();
  await assert.rejects(u.prepare({ version: '1.1.0', url: base + '/a.zip', sha256: '' }), /no SHA-256/); close();
});
test('rejects a download whose checksum does not match', async () => {
  const { u, base, close } = await setup();
  await assert.rejects(u.prepare({ version: '1.1.0', url: base + '/a.zip', sha256: 'a'.repeat(64) }), /Checksum mismatch/); close();
});
test('rejects downloads from hosts that are not allow-listed', async () => {
  const { u, close } = await setup();
  await assert.rejects(u.prepare({ version: '1.1.0', url: 'https://evil.example/a.zip', sha256: 'a'.repeat(64) }), /host not allowed/); close();
});
test('install is refused when not running from the app bundle', async () => {
  const { u, close } = await setup(); u._setLatest({ version: '9.9.9', url: 'x', sha256: 'a'.repeat(64) });
  await assert.rejects(u.install(), /only from the Storage app/); close();
});
