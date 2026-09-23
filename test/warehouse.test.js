const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWarehouseService, cleanFileName, validateCategory } = require('../src/warehouse');

test('warehouse downloads are saved under their category and can be fully removed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-warehouse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const catalog = {
    schemaVersion: 1,
    items: [{
      id: '30bdfc4a-cc67-41fe-8c9d-bc5070c84c62',
      category: 'drumkits',
      title: 'Test Kit',
      description: 'Local test download',
      fileName: 'Kit.zip',
      fileUrl: 'https://github.com/c1naii/Music-Base/releases/download/v0.5.1/kit.zip',
      imageUrl: 'https://github.com/c1naii/Music-Base/releases/download/v0.5.1/cover.png'
    }]
  };
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://raw.githubusercontent.com/')) return new Response(JSON.stringify(catalog));
    return new Response(Buffer.from('test file bytes'));
  };
  const store = createWarehouseService({
    dataDirectory: path.join(root, 'Data'),
    downloadsDirectory: path.join(root, 'Music Base'),
    fetchImpl,
    tokenProvider: () => null
  });

  const downloaded = await store.downloadItem(catalog.items[0].id);
  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].fileName, 'Kit.zip');
  const filePath = path.join(root, 'Music Base', 'DRUMKITS', 'Kit.zip');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'test file bytes');

  assert.deepEqual(store.deleteDownload(downloaded[0].id), []);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(await store.checkAdmin(), false);
});

test('warehouse rejects invalid categories and unsafe names', () => {
  assert.throws(() => validateCategory('other'));
  assert.equal(cleanFileName('..\\unsafe?.zip'), 'unsafe_.zip');
});

test('only the writable repository owner passes the admin check', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-admin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const makeStore = (login) => createWarehouseService({
    dataDirectory: path.join(root, login, 'Data'),
    downloadsDirectory: path.join(root, login, 'Music Base'),
    tokenProvider: () => 'test-token',
    fetchImpl: async (url) => new Response(JSON.stringify(String(url).endsWith('/user') ?
      { login } : { permissions: { push: true } }))
  });

  assert.equal(await makeStore('c1naii').checkAdmin(), true);
  assert.equal(await makeStore('someone-else').checkAdmin(), false);
  assert.equal(makeStore('c1naii').verifyPin('0079123'), true);
  assert.equal(makeStore('c1naii').verifyPin('wrong'), false);
});
