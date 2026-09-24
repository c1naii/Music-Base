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
      downloadDirectory: null, downloadRoots: []
    });
    savePreferences(file, {
      language: 'uk', showSplash: false, visualEffects: false,
      bounds: { x: 120, y: 80, width: 940, height: 640 }, maximized: true,
      lastPlace: { type: 'topic', folderId: 'sound', topicId: 'intervals' },
      downloadDirectory: path.join(directory, 'Custom'), downloadRoots: [path.join(directory, 'Custom')],
      dawIntegrationTargets: [path.join(directory, 'Daw')],
      connectedDaws: { flstudio: { version: '2026', installPath: path.join(directory, 'FL Studio 2026') } }
    });
    assert.deepEqual(loadPreferences(file), {
      language: 'uk', showSplash: false, visualEffects: false,
      bounds: { x: 120, y: 80, width: 940, height: 640 }, maximized: true,
      lastPlace: { type: 'topic', folderId: 'sound', topicId: 'intervals' },
      downloadDirectory: path.join(directory, 'Custom'), downloadRoots: [path.join(directory, 'Custom')]
    });
    assert.equal(normalizePreferences({ language: 'invalid', bounds: { width: 1 } }).language, 'ru');
    assert.equal(normalizePreferences({ bounds: { width: 1 } }).bounds, null);
    assert.equal(normalizePreferences({ lastPlace: { type: 'unknown' } }).lastPlace, null);
    assert.deepEqual(normalizePreferences({ lastPlace: { type: 'warehouse', category: 'presets' } }).lastPlace,
      { type: 'warehouse', category: 'presets' });
    assert.equal(normalizePreferences({ lastPlace: { type: 'warehouse', category: '../outside' } }).lastPlace, null);
    assert.deepEqual(normalizePreferences({ lastPlace: { type: 'warehouse-item', itemId: 'd4baccd5-188f-4ac2-90b1-11745ca57cfe' } }).lastPlace,
      { type: 'warehouse-item', itemId: 'd4baccd5-188f-4ac2-90b1-11745ca57cfe' });
    assert.deepEqual(normalizePreferences({ lastPlace: { type: 'warehouse-downloads' } }).lastPlace,
      { type: 'warehouse-downloads' });
    assert.deepEqual(normalizePreferences({ lastPlace: { type: 'warehouse', category: 'banks' } }).lastPlace,
      { type: 'warehouse', category: 'banks' });
    const resume = { ...loadPreferences(file), lastPlace: { type: 'warehouse-item', itemId: 'd4baccd5-188f-4ac2-90b1-11745ca57cfe' } };
    savePreferences(file, resume);
    assert.deepEqual(loadPreferences(file).lastPlace, resume.lastPlace);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
