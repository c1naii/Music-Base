const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createFlStudioInstallerService, officialInstallerName } = require('../src/fl-studio');

function response(body, url = 'https://install.image-line.com/flstudio/flstudio_win64_26.1.6.5639.exe') {
  return {
    ok: true, status: 200, url,
    headers: new Headers({ 'content-length': String(body.length) }),
    body: Readable.toWeb(Readable.from([body]))
  };
}

test('FL Studio installer downloads from Image-Line once, verifies, and opens the saved file', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-fl-studio-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const payload = Buffer.from('signed installer bytes');
  let requests = 0;
  let opened = '';
  const progress = [];
  const service = createFlStudioInstallerService({
    directory,
    fetchImpl: async () => { requests += 1; return response(payload); },
    verifySignature: async (file) => assert.deepEqual(fs.readFileSync(file), payload),
    openPath: async (file) => { opened = file; return ''; }
  });
  assert.equal(service.status().downloaded, false);
  assert.equal((await service.download((percent) => progress.push(percent))).downloaded, true);
  assert.equal(progress.at(-1), 100);
  assert.equal(requests, 1);
  assert.equal((await service.download()).downloaded, true);
  assert.equal(requests, 1);
  await service.open();
  assert.equal(path.basename(opened), 'flstudio_win64_26.1.6.5639.exe');
  const changed = Buffer.from(payload);
  changed[0] ^= 1;
  fs.writeFileSync(opened, changed);
  await assert.rejects(service.open(), /integrity check failed/);
  assert.equal(service.status().downloaded, false);
  assert.equal((await service.download()).downloaded, true);
  assert.equal(requests, 2);
});

test('FL Studio installer rejects other servers and an invalid signature', async (t) => {
  assert.throws(() => officialInstallerName('https://example.com/flstudio/flstudio_win64_26.exe'), /official Image-Line/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-fl-studio-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const payload = Buffer.from('bad installer');
  const service = createFlStudioInstallerService({
    directory, fetchImpl: async () => response(payload),
    verifySignature: async () => { throw new Error('Invalid signature'); },
    openPath: async () => ''
  });
  await assert.rejects(service.download(), /Invalid signature/);
  assert.equal(service.status().downloaded, false);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.part') || name.endsWith('.exe')), []);
});

test('FL Studio installer download can be cancelled and leaves no partial file', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-base-fl-cancel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let service;
  const serviceOptions = {
    directory,
    fetchImpl: async () => ({
      ...response(Buffer.from('partial')),
      headers: new Headers({ 'content-length': '100' }),
      body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('partial')); } })
    }),
    verifySignature: async () => {}, openPath: async () => ''
  };
  service = createFlStudioInstallerService(serviceOptions);
  await assert.rejects(service.download(() => service.cancel()), { name: 'AbortError' });
  assert.equal(service.status().downloaded, false);
  assert.deepEqual(fs.readdirSync(directory), []);
});
