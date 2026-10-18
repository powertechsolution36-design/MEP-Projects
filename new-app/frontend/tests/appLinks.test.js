// Run: cd new-app/frontend && node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHttpsDownloadUrl, appDownloadOptions } from '../src/utils/appLinks.js';

test('empty or missing values give no link (button stays disabled)', () => {
  for (const v of [undefined, null, '', '   ']) assert.equal(toHttpsDownloadUrl(v), '');
});

test('only absolute https URLs are accepted', () => {
  assert.equal(toHttpsDownloadUrl('https://downloads.example.com/mep-projects.apk'), 'https://downloads.example.com/mep-projects.apk');
  assert.equal(toHttpsDownloadUrl('  https://apps.apple.com/app/id123  '), 'https://apps.apple.com/app/id123');
});

test('http, relative paths, local files and script URLs are rejected', () => {
  for (const v of [
    'http://downloads.example.com/mep.apk',
    '/downloads/mep.apk',
    'mep.apk',
    'file:///C:/Projects/mep.apk',
    'C:\\Projects\\app.apk',
    'javascript:alert(1)',
    'ftp://example.com/mep.apk',
    'https://',
  ]) assert.equal(toHttpsDownloadUrl(v), '', v);
});

test('options: nothing configured -> both buttons disabled, no links', () => {
  const o = appDownloadOptions({});
  assert.deepEqual(o.android, { available: false, url: '' });
  assert.deepEqual(o.ios, { available: false, url: '' });
});

test('options: an Android APK URL only enables Android; iOS never falls back to the APK', () => {
  const o = appDownloadOptions({ androidApkUrl: 'https://downloads.example.com/mep.apk' });
  assert.deepEqual(o.android, { available: true, url: 'https://downloads.example.com/mep.apk' });
  assert.deepEqual(o.ios, { available: false, url: '' });
});

test('options: iOS is never offered an Android package, even over https', () => {
  for (const u of ['https://downloads.example.com/mep-projects.apk', 'https://downloads.example.com/MEP.APK?v=2']) {
    assert.deepEqual(appDownloadOptions({ iosAppUrl: u }).ios, { available: false, url: '' }, u);
  }
});

test('options: an insecure Android URL is treated as not available', () => {
  const o = appDownloadOptions({ androidApkUrl: 'http://downloads.example.com/mep.apk' });
  assert.equal(o.android.available, false);
});
