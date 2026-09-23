const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findInstalledDaw } = require('../src/daw');

test('DAW integration finds the newest installed version without a library folder', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-daw-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const version of ['21', '2026']) {
    const directory = path.join(root, 'Image-Line', `FL Studio ${version}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'FL64.exe'), '');
  }
  const ableton = path.join(root, 'Ableton', 'Live 12 Suite', 'Program');
  fs.mkdirSync(ableton, { recursive: true });
  fs.writeFileSync(path.join(ableton, 'Ableton Live 12 Suite.exe'), '');

  assert.equal(findInstalledDaw('flstudio', [root]).version, '2026');
  assert.equal(findInstalledDaw('ableton', [root]).version, '12');
  assert.equal(findInstalledDaw('ableton', [path.join(root, 'missing')]), null);
});
