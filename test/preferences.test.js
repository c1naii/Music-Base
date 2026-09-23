const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPreferences, savePreferences, normalizePreferences } = require('../src/preferences');

test('preferences are validated and saved across launches', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-test-'));
  const file = path.join(directory, 'preferences.json');
  try {
    assert.deepEqual(loadPreferences(file), {
      language: 'ru', showSplash: true, visualEffects: true, bounds: null, maximized: false, lastPlace: null,
      downloadDirectory: null, downloadRoots: [], dawIntegrationTargets: []
    });
    savePreferences(file, {
      language: 'uk', showSplash: false, visualEffects: false,
      bounds: { x: 120, y: 80, width: 940, height: 640 }, maximized: true,
      lastPlace: { type: 'topic', folderId: 'sound', topicId: 'intervals' },
      downloadDirectory: path.join(directory, 'Custom'), downloadRoots: [path.join(directory, 'Custom')],
      dawIntegrationTargets: [path.join(directory, 'Daw')]
    });
    assert.deepEqual(loadPreferences(file), {
      language: 'uk', showSplash: false, visualEffects: false,
      bounds: { x: 120, y: 80, width: 940, height: 640 }, maximized: true,
      lastPlace: { type: 'topic', folderId: 'sound', topicId: 'intervals' },
      downloadDirectory: path.join(directory, 'Custom'), downloadRoots: [path.join(directory, 'Custom')],
      dawIntegrationTargets: [path.join(directory, 'Daw')]
    });
    assert.equal(normalizePreferences({ language: 'invalid', bounds: { width: 1 } }).language, 'ru');
    assert.equal(normalizePreferences({ bounds: { width: 1 } }).bounds, null);
    assert.equal(normalizePreferences({ lastPlace: { type: 'unknown' } }).lastPlace, null);
    assert.deepEqual(normalizePreferences({ lastPlace: { type: 'warehouse', category: 'presets' } }).lastPlace,
      { type: 'warehouse', category: 'presets' });
    assert.equal(normalizePreferences({ lastPlace: { type: 'warehouse', category: '../outside' } }).lastPlace, null);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
