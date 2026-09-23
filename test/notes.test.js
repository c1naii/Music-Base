const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNotesStore } = require('../src/notes');

test('notes use individual TXT files and keep pin state across launches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-notes-'));
  try {
    const data = path.join(root, 'Data');
    const store = createNotesStore(data);
    store.create('Идеи для битов');
    assert.equal(fs.readFileSync(path.join(data, 'Notes', 'Идеи для битов.txt'), 'utf8'), '');
    store.save('Идеи для битов', 'Ритмы', 'Новый рисунок ударных', true);
    assert.equal(fs.existsSync(path.join(data, 'Notes', 'Идеи для битов.txt')), false);
    assert.equal(fs.readFileSync(path.join(data, 'Notes', 'Ритмы.txt'), 'utf8'), 'Новый рисунок ударных');
    assert.deepEqual(createNotesStore(data).list(), [{ title: 'Ритмы', content: 'Новый рисунок ударных', pinned: true }]);
    assert.throws(() => store.create('../outside'), /Invalid/);
    assert.throws(() => store.create('ритмы'), /already exists/);
    store.remove('Ритмы');
    assert.equal(fs.existsSync(path.join(data, 'Notes', 'Ритмы.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
