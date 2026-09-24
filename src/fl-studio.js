const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const INSTALLER_URL = 'https://support.image-line.com/redirect/flstudio_win_installer';
const MAX_INSTALLER_SIZE = 3 * 1024 * 1024 * 1024;
const INSTALLER_NAME = /^flstudio_win64_[\d.]+\.exe$/i;

function officialInstallerName(url) {
  const parsed = new URL(url);
  const name = path.posix.basename(parsed.pathname);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'install.image-line.com' ||
      !parsed.pathname.startsWith('/flstudio/') || !INSTALLER_NAME.test(name)) {
    throw new Error('The download did not come from the official Image-Line installer server');
  }
  return name;
}

async function verifyImageLineSignature(file) {
  if (process.platform !== 'win32') throw new Error('The FL Studio installer is available on Windows only');
  const script = '$s = Get-AuthenticodeSignature -LiteralPath $env:MUSIC_BASE_INSTALLER; ' +
    '[pscustomobject]@{Status=$s.Status.ToString();Subject=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MUSIC_BASE_INSTALLER: file }, windowsHide: true, timeout: 120_000, maxBuffer: 16_384
  });
  const signature = JSON.parse(stdout.trim());
  if (signature.Status !== 'Valid' || !/CN=Image[- ]Line(?:,|$)/i.test(signature.Subject || '')) {
    throw new Error('The installer does not have a valid Image-Line signature');
  }
}

function createFlStudioInstallerService({ directory, fetchImpl = fetch, verifySignature = verifyImageLineSignature, openPath }) {
  const root = path.resolve(directory);
  const metadataFile = path.join(root, 'fl-studio-installer.json');
  let activeDownload = null;

  function readMetadata() {
    try {
      const record = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      if (!INSTALLER_NAME.test(record.name) || !Number.isSafeInteger(record.size) || record.size <= 0 ||
          !/^[a-f0-9]{64}$/i.test(record.sha256)) return null;
      return { ...record, file: path.join(root, record.name) };
    } catch { return null; }
  }

  function readRecord() {
    const record = readMetadata();
    try { return record && fs.statSync(record.file).size === record.size ? record : null; }
    catch { return null; }
  }

  function discardSavedInstaller(record) {
    fs.rmSync(metadataFile, { force: true });
    if (record) fs.rmSync(record.file, { force: true });
  }

  function status() {
    const record = readRecord();
    return record ? { downloaded: true, name: record.name, size: record.size } : { downloaded: false };
  }

  async function download(onProgress = () => {}) {
    if (activeDownload) return activeDownload;
    activeDownload = (async () => {
      const existing = readRecord();
      if (existing) return status();
      const stale = readMetadata();
      if (stale) discardSavedInstaller(stale);
      fs.mkdirSync(root, { recursive: true });
      const response = await fetchImpl(INSTALLER_URL);
      if (!response.ok || !response.body) throw new Error(`Image-Line download failed (${response.status})`);
      const name = officialInstallerName(response.url);
      const expectedSize = Number(response.headers.get('content-length'));
      if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_INSTALLER_SIZE) {
        throw new Error('Invalid installer size');
      }
      const destination = path.join(root, name);
      if (fs.existsSync(destination)) throw new Error('An installer with this name already exists');
      const temporary = path.join(root, `.fl-studio-${crypto.randomUUID()}.part`);
      const hash = crypto.createHash('sha256');
      let received = 0;
      let lastPercent = -1;
      try {
        await pipeline(Readable.fromWeb(response.body), new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > expectedSize) return callback(new Error('Installer exceeds the reported size'));
            hash.update(chunk);
            const percent = Math.min(100, Math.floor(received * 100 / expectedSize));
            if (percent !== lastPercent) { onProgress(percent); lastPercent = percent; }
            callback(null, chunk);
          }
        }), fs.createWriteStream(temporary, { flags: 'wx' }));
        if (received !== expectedSize) throw new Error('Installer download is incomplete');
        await verifySignature(temporary);
        fs.linkSync(temporary, destination);
        try {
          const record = { name, size: received, sha256: hash.digest('hex') };
          const tempMetadata = `${metadataFile}.tmp`;
          fs.writeFileSync(tempMetadata, JSON.stringify(record), 'utf8');
          fs.renameSync(tempMetadata, metadataFile);
        } catch (error) {
          fs.rmSync(destination, { force: true });
          throw error;
        }
        return status();
      } finally {
        try { fs.unlinkSync(temporary); } catch {}
      }
    })();
    try { return await activeDownload; }
    finally { activeDownload = null; }
  }

  async function open() {
    const record = readRecord();
    if (!record) {
      const stale = readMetadata();
      if (stale) discardSavedInstaller(stale);
      throw new Error('The installer has not been downloaded');
    }
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(record.file)) hash.update(chunk);
    if (hash.digest('hex') !== record.sha256) {
      discardSavedInstaller(record);
      throw new Error('Installer integrity check failed');
    }
    try { await verifySignature(record.file); }
    catch (error) { discardSavedInstaller(record); throw error; }
    const result = await openPath(record.file);
    if (result) throw new Error(result);
    return true;
  }

  return { status, download, open };
}

module.exports = { createFlStudioInstallerService, officialInstallerName, verifyImageLineSignature, INSTALLER_URL };
