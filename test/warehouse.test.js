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
  const filePath = path.join(root, 'Music Base', 'Library', 'Drum Kits', 'Test Kit', 'loop.mid');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'MIDI bytes');
  assert.equal(fs.existsSync(path.join(root, 'Music Base', 'Library', 'Drum Kits', 'Kit.zip')), false);
  assert.equal(store.getDragFile(downloaded[0].id), filePath);
  assert.equal(store.getDownloadPath(downloaded[0].id), path.dirname(filePath));
  assert.equal(progress.at(-1), 100);

  assert.equal((await store.downloadItem(catalog.items[0].id)).length, 1);
  assert.equal(fs.readdirSync(path.join(root, 'Music Base', 'Library', 'Drum Kits')).length, 1);
  assert.deepEqual(store.toggleFavorite(catalog.items[0].id), [catalog.items[0].id]);
  assert.deepEqual(store.getFavorites(), [catalog.items[0].id]);
  assert.deepEqual(store.toggleFavorite(catalog.items[0].id), []);

  assert.deepEqual(store.deleteDownload(downloaded[0].id), []);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(await store.checkAdmin(), false);
});

test('category archive installs into the shared Library without replacing existing files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-library-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const item = {
    id: '10000000-0000-4000-8000-000000000001', category: 'drumkits', title: 'Drum Kits', description: '',
    fileName: 'Drum Kits.zip',
    fileUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/Drum%20Kits.zip',
    imageUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/cover.png'
  };
  const zip = zipFile('Drum Kits/Kicks/kick.wav', 'kick sample');
  const library = path.join(root, 'Documents', 'Music Base', 'Library');
  const drumKits = path.join(library, 'Drum Kits');
  fs.mkdirSync(path.join(drumKits, 'Existing'), { recursive: true });
  fs.writeFileSync(path.join(drumKits, 'Existing', 'keep.wav'), 'keep');
  const store = createWarehouseService({
    dataDirectory: path.join(root, 'Data'), downloadsDirectory: path.dirname(library),
    fetchImpl: async (url) => String(url).startsWith('https://raw.githubusercontent.com/')
      ? new Response(JSON.stringify({ schemaVersion: 1, items: [item] })) : new Response(zip)
  });

  const progress = [];
  const downloaded = await store.downloadItem(item.id, (percent, phase) => progress.push({ percent, phase }));
  assert.equal(fs.readFileSync(path.join(drumKits, 'Kicks', 'kick.wav'), 'utf8'), 'kick sample');
  assert.equal(fs.readFileSync(path.join(drumKits, 'Existing', 'keep.wav'), 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(library).sort(), ['Banks', 'Drum Kits', 'MIDI', 'Plugins', 'Presets', 'Projects', 'Samples'].sort());
  assert.ok(progress.some((entry) => entry.phase === 'extracting'));
  assert.ok(progress.some((entry) => entry.phase === 'installing'));
  assert.equal(progress.at(-1).phase, 'done');
  assert.equal(downloaded.length, 1);

  await store.downloadItem(item.id);
  assert.equal(fs.readdirSync(drumKits).filter((name) => name === 'Kicks').length, 1);
  store.deleteDownload(downloaded[0].id);
  assert.equal(fs.existsSync(path.join(drumKits, 'Kicks')), false);
  assert.equal(fs.readFileSync(path.join(drumKits, 'Existing', 'keep.wav'), 'utf8'), 'keep');
});

test('unsafe archive entries are rejected and existing library files stay untouched', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-archive-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const item = {
    id: '20000000-0000-4000-8000-000000000002', category: 'presets', title: 'Unsafe Preset', description: '',
    fileName: 'Unsafe Preset.zip',
    fileUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/unsafe.zip',
    imageUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/cover.png'
  };
  const zip = zipFile('../outside.wav', 'do not install');
  const base = path.join(root, 'Documents', 'Music Base');
  const existingFile = path.join(base, 'Library', 'Presets', 'Existing.fst');
  fs.mkdirSync(path.dirname(existingFile), { recursive: true });
  fs.writeFileSync(existingFile, 'preserve me');
  const store = createWarehouseService({ dataDirectory: path.join(root, 'Data'), downloadsDirectory: base,
    fetchImpl: async (url) => String(url).startsWith('https://raw.githubusercontent.com/')
      ? new Response(JSON.stringify({ schemaVersion: 1, items: [item] })) : new Response(zip) });

  await assert.rejects(store.downloadItem(item.id));
  assert.equal(fs.readFileSync(existingFile, 'utf8'), 'preserve me');
  assert.equal(fs.existsSync(path.join(base, 'Library', 'outside.wav')), false);
  assert.equal(store.listDownloads().length, 0);
});

test('interrupted bank downloads resume from the saved byte and finish once', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from('abcdefghijklmnopqrstuvwxyz');
  const item = {
    id: 'a3326a52-b88a-4f26-8e3a-8888e884497a', category: 'banks', title: 'Test Bank', description: '',
    fileName: 'Bank.fxp',
    fileUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/Bank.fxp',
    imageUrl: 'https://github.com/c1naii/Music-Base/releases/download/test/cover.png'
  };
  let requests = 0;
  let resumeOffset = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith('https://raw.githubusercontent.com/')) return new Response(JSON.stringify({ schemaVersion: 1, items: [item] }));
    requests += 1;
    if (requests === 1) {
      let sent = false;
      return new Response(new ReadableStream({
        async pull(controller) {
          if (!sent) { sent = true; controller.enqueue(bytes.subarray(0, 8)); }
          else { await new Promise((resolve) => setTimeout(resolve, 20)); controller.error(new Error('Connection interrupted')); }
        }
      }), { headers: { 'content-length': String(bytes.length) } });
    }
    resumeOffset = Number(/^bytes=(\d+)-$/.exec(options.headers?.Range || '')?.[1] || 0);
    return new Response(bytes.subarray(resumeOffset), {
      status: 206,
      headers: { 'content-length': String(bytes.length - resumeOffset), 'content-range': `bytes ${resumeOffset}-${bytes.length - 1}/${bytes.length}` }
    });
  };
  const store = createWarehouseService({
    dataDirectory: path.join(root, 'Data'), downloadsDirectory: path.join(root, 'Music Base'), fetchImpl
  });
  const progress = [];
  const records = await store.downloadItem(item.id, (value) => progress.push(value));
  assert.equal(requests, 2);
  assert.equal(resumeOffset, 8);
  assert.equal(progress.at(-1), 100);
  assert.equal(records.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'Music Base', 'Library', 'Banks', 'Bank.fxp')), bytes);
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
