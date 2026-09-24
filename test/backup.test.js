const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackupService } = require('../src/backup');

test('backup copies notes, pin state, download index and favorites without changing source files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const notes = path.join(root, 'Notes');
  const notesPins = path.join(root, 'notes-pins.json');
  const downloads = path.join(root, 'downloads.json');
  const favorites = path.join(root, 'warehouse-favorites.json');
  const backupDirectory = path.join(root, 'Backups');
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'Ideas.txt'), 'ideas');
  fs.writeFileSync(notesPins, '["Ideas"]');
  fs.writeFileSync(downloads, '[{"id":"download-1"}]');
  fs.writeFileSync(favorites, '["item-1"]');

  const backupPath = createBackupService({ notesDirectory: notes, notesPinsPath: notesPins, downloadsIndexPath: downloads,
    favoritesPath: favorites, backupDirectory }).create();
  assert.equal(fs.readFileSync(path.join(backupPath, 'Notes', 'Ideas.txt'), 'utf8'), 'ideas');
  assert.equal(fs.readFileSync(path.join(backupPath, 'notes-pins.json'), 'utf8'), '["Ideas"]');
  assert.equal(fs.readFileSync(path.join(backupPath, 'downloads.json'), 'utf8'), '[{"id":"download-1"}]');
  assert.equal(fs.readFileSync(path.join(backupPath, 'warehouse-favorites.json'), 'utf8'), '["item-1"]');
  assert.equal(fs.readFileSync(path.join(notes, 'Ideas.txt'), 'utf8'), 'ideas');
});
