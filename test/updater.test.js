const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../src/updater');

test('update is offered with release notes and installed only after selection', async () => {
  const engine = new EventEmitter();
  const messages = [];
  let checks = 0;
  let downloads = 0;
  let restarts = 0;
  engine.checkForUpdates = async () => { checks += 1; };
  engine.downloadUpdate = async () => { downloads += 1; };
  engine.quitAndInstall = (silent, runAfter) => {
    assert.equal(silent, true);
    assert.equal(runAfter, true);
    restarts += 1;
  };

  const updater = createUpdater(engine, (message) => messages.push(message), (callback) => callback());
  assert.equal(engine.autoDownload, false);
  assert.equal(engine.autoInstallOnAppQuit, false);
  await updater.check();
  assert.equal(checks, 1);

  engine.emit('update-available', { version: '0.4.0', releaseNotes: '- Исправления\n- Новые материалы' });
  assert.equal(messages.at(-1).notes, '- Исправления\n- Новые материалы');
  assert.equal(downloads, 0);

  await updater.install();
  assert.equal(downloads, 1);
  engine.emit('download-progress', { percent: 47.9 });
  assert.equal(messages.at(-1).percent, 47);
  engine.emit('update-downloaded');
  assert.equal(messages.at(-1).state, 'installing');
  assert.equal(restarts, 1);
});

test('download failure allows another attempt', async () => {
  const engine = new EventEmitter();
  const messages = [];
  let downloads = 0;
  engine.checkForUpdates = async () => {};
  engine.downloadUpdate = async () => {
    downloads += 1;
    if (downloads === 1) throw new Error('network');
  };

  const updater = createUpdater(engine, (message) => messages.push(message));
  engine.emit('update-available', { version: '0.4.0' });
  await updater.install();
  assert.equal(messages.at(-1).state, 'error');
  await updater.install();
  assert.equal(downloads, 2);
});
