'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { cmp, valid, clean } = require('../lib/semver');
test('compares versions', () => {
  assert.equal(cmp('1.0.0', '1.0.0'), 0); assert.equal(cmp('1.2.0', '1.10.0'), -1); assert.equal(cmp('2.0.0', '1.99.99'), 1);
  assert.equal(cmp('1.0.0-beta', '1.0.0'), -1); assert.equal(cmp('v1.0.1', '1.0.0'), 1);
});
test('validates', () => { assert.ok(valid('1.2.3')); assert.ok(valid('v1.2.3-rc1')); assert.ok(!valid('1.2')); assert.ok(!valid('../etc')); assert.ok(!valid(null)); assert.equal(clean('v1.0.0'), '1.0.0'); });
