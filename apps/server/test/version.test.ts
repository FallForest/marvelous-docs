import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isNewerVersion } from '../src/lib/version.js';

test('compareVersions compares numeric segments', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2', '2.0.1'), -1);
  assert.equal(compareVersions('0.1', '0.1.0'), 0);
});

test('compareVersions ignores prefixes, prerelease and build metadata', () => {
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0+build.5', '1.2.0'), 0);
});

test('compareVersions treats malformed segments as zero', () => {
  assert.equal(compareVersions('1.x.0', '1.0.0'), 0);
  assert.equal(compareVersions('', '0.0.0'), 0);
});

test('isNewerVersion only reports strictly newer versions', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('0.9.9', '1.0.0'), false);
});
