const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createWarehouseService, cleanFileName, validateCategory } = require('../src/warehouse');

function zipFile(name, content) {
  const fileName = Buffer.from(name);
  const data = Buffer.from(content);
  const compressed = zlib.deflateRawSync(data);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12); end.writeUInt32LE(local.length + fileName.length + compressed.length, 16);
  return Buffer.concat([local, fileName, compressed, central, fileName, end]);
}

test('ZIP downloads are extracted into their category and can be fully removed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-warehouse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archiveBytes = zipFile('loop.mid', 'MIDI bytes');
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
    return new Response(archiveBytes);
  };
  const store = createWarehouseService({
    dataDirectory: path.join(root, 'Data'),
    downloadsDirectory: path.join(root, 'Music Base'),
    downloadsIndexPath: path.join(root, 'Data', 'downloads.json'),
    fetchImpl,
    tokenProvider: () => null
  });

  const progress = [];
  const downloaded = await store.downloadItem(catalog.items[0].id, (value) => progress.push(value));
  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].fileName, 'Kit.zip');
  assert.equal(downloaded[0].isDirectory, true);
  const filePath = path.join(root, 'Music Base', 'DRUMKITS', 'Kit', 'loop.mid');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'MIDI bytes');
  assert.equal(fs.existsSync(path.join(root, 'Music Base', 'DRUMKITS', 'Kit.zip')), false);
  assert.equal(store.getDragFile(downloaded[0].id), filePath);
  assert.equal(store.getDownloadPath(downloaded[0].id), path.dirname(filePath));
  assert.equal(progress.at(-1), 100);

  assert.equal((await store.downloadItem(catalog.items[0].id)).length, 1);
  assert.equal(fs.readdirSync(path.join(root, 'Music Base', 'DRUMKITS')).length, 1);
  assert.deepEqual(store.toggleFavorite(catalog.items[0].id), [catalog.items[0].id]);
  assert.deepEqual(store.getFavorites(), [catalog.items[0].id]);
  assert.deepEqual(store.toggleFavorite(catalog.items[0].id), []);

  assert.deepEqual(store.deleteDownload(downloaded[0].id), []);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(await store.checkAdmin(), false);
});

test('downloads follow the selected directory and DAW folder link points at it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaultPath = path.join(root, 'Documents', 'Music Base');
  const customPath = path.join(root, 'Custom Music');
  const dawBrowser = path.join(root, 'Daw Browser');
  fs.mkdirSync(dawBrowser);
  const store = createWarehouseService({ dataDirectory: path.join(root, 'Data'), downloadsDirectory: defaultPath,
    downloadsIndexPath: path.join(root, 'Data', 'downloads.json'), tokenProvider: () => null });
  store.setDownloadsDirectory(customPath);
  const link = store.integrateWithDaw(dawBrowser);
  assert.equal(fs.realpathSync(link), fs.realpathSync(customPath));
  const nextPath = path.join(root, 'Another Music Folder');
  store.setDownloadsDirectory(nextPath, [dawBrowser]);
  assert.equal(fs.realpathSync(link), fs.realpathSync(nextPath));
});

test('existing downloads are migrated when the shared index is introduced', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const downloads = path.join(root, 'Documents', 'Music Base');
  const file = path.join(downloads, 'PRESETS', 'Old.fst');
  const oldIndex = path.join(downloads, 'Data', 'downloads.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(oldIndex), { recursive: true });
  fs.writeFileSync(file, 'preset');
  fs.writeFileSync(oldIndex, JSON.stringify([{ id: 'old-id', itemId: 'old-item', title: 'Old', category: 'presets', fileName: 'Old.fst', relativePath: path.join('PRESETS', 'Old.fst') }]));
  const store = createWarehouseService({ dataDirectory: path.join(root, 'Data'), downloadsDirectory: downloads,
    downloadsIndexPath: path.join(root, 'Data', 'downloads.json'), tokenProvider: () => null });
  assert.equal(store.listDownloads()[0].title, 'Old');
  assert.equal(fs.existsSync(path.join(root, 'Data', 'downloads.json')), true);
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
