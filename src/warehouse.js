const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const OWNER = 'c1naii';
const REPOSITORY = 'Music-Base';
const BRANCH = 'main';
const CATALOG_PATH = 'warehouse/catalog.json';
const PIN_HASH = '31fa2fe6effab86b748d58a9906ac3d7d53d72e9e3854a7c6de63e860f8e854e';
const CATEGORIES = Object.freeze({
  drumkits: 'DRUMKITS',
  plugins: 'PLUGINS',
  projects: 'PROJECTS',
  presets: 'PRESETS'
});
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
const RAW_CATALOG = `https://raw.githubusercontent.com/${OWNER}/${REPOSITORY}/${BRANCH}/${CATALOG_PATH}`;

function emptyCatalog() {
  return { schemaVersion: 1, items: [] };
}

function validateCategory(value) {
  if (!Object.hasOwn(CATEGORIES, value)) throw new Error('Invalid warehouse category');
  return value;
}

function validateText(value, name, maxLength) {
  if (typeof value !== 'string') throw new Error(`Invalid ${name}`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength) throw new Error(`Invalid ${name}`);
  return clean;
}

function cleanFileName(value) {
  const base = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!base || base === '.' || base === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(base)) {
    throw new Error('Invalid file name');
  }
  return base.slice(0, 180);
}

function safePublicItem(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' ||
      !Object.hasOwn(CATEGORIES, item.category) || typeof item.title !== 'string' ||
      typeof item.description !== 'string' || typeof item.fileName !== 'string' ||
      typeof item.fileUrl !== 'string' || typeof item.imageUrl !== 'string') return null;
  try {
    const fileUrl = new URL(item.fileUrl);
    const imageUrl = new URL(item.imageUrl);
    if (fileUrl.protocol !== 'https:' || fileUrl.hostname !== 'github.com' ||
        imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'github.com') return null;
    return {
      id: item.id,
      category: item.category,
      title: item.title.slice(0, 120),
      description: item.description.slice(0, 5000),
      fileName: item.fileName.slice(0, 180),
      fileUrl: fileUrl.href,
      imageUrl: imageUrl.href,
      ...(Number.isInteger(item.fileAssetId) ? { fileAssetId: item.fileAssetId } : {}),
      ...(Number.isInteger(item.imageAssetId) ? { imageAssetId: item.imageAssetId } : {}),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
    };
  } catch { return null; }
}

function parseCatalog(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items)) return emptyCatalog();
  return { schemaVersion: 1, items: value.items.map(safePublicItem).filter(Boolean) };
}

function getGitHubToken() {
  try {
    const result = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true
    });
    const password = result.split(/\r?\n/).find((line) => line.startsWith('password='));
    return password?.slice('password='.length) || null;
  } catch { return null; }
}

function apiHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Music-Base',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra
  };
}

async function readJsonResponse(response, action) {
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(`${action} failed (${response.status})`);
  return body;
}

function requestUpload(url, token, filePath, contentType) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const request = https.request(url, {
      method: 'POST',
      headers: apiHeaders(token, {
        'Content-Type': contentType,
        'Content-Length': stat.size
      })
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub asset upload failed (${response.statusCode})`));
        } else resolve(body);
      });
    });
    request.on('error', reject);
    fs.createReadStream(filePath).on('error', reject).pipe(request);
  });
}

function createWarehouseService({ dataDirectory, downloadsDirectory, fetchImpl = fetch, tokenProvider = getGitHubToken }) {
  const cacheFile = path.join(dataDirectory, 'warehouse-catalog.json');
  const downloadsIndex = path.join(downloadsDirectory, 'Data', 'downloads.json');
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(downloadsDirectory, { recursive: true });

  async function authorizeOwner() {
    const token = tokenProvider();
    if (!token) throw new Error('GitHub authentication is required');
    const headers = apiHeaders(token);
    const [userResponse, repoResponse] = await Promise.all([
      fetchImpl('https://api.github.com/user', { headers }),
      fetchImpl(`${API_ROOT}`, { headers })
    ]);
    const [user, repo] = await Promise.all([
      readJsonResponse(userResponse, 'GitHub authentication'),
      readJsonResponse(repoResponse, 'Repository access check')
    ]);
    if (user.login !== OWNER || repo.permissions?.push !== true) {
      throw new Error('This GitHub account cannot administer the warehouse');
    }
    return token;
  }

  async function checkAdmin() {
    try {
      await authorizeOwner();
      return true;
    } catch { return false; }
  }

  async function getCatalog() {
    try {
      const response = await fetchImpl(`${RAW_CATALOG}?_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Catalog unavailable (${response.status})`);
      const catalog = parseCatalog(await response.json());
      fs.writeFileSync(cacheFile, JSON.stringify(catalog), 'utf8');
      return catalog;
    } catch {
      try { return parseCatalog(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))); }
      catch { return emptyCatalog(); }
    }
  }

  function readDownloads() {
    try {
      const records = JSON.parse(fs.readFileSync(downloadsIndex, 'utf8'));
      return Array.isArray(records) ? records.filter((record) => record && typeof record.id === 'string' &&
        typeof record.itemId === 'string' && typeof record.fileName === 'string' &&
        Object.hasOwn(CATEGORIES, record.category) && typeof record.relativePath === 'string') : [];
    } catch { return []; }
  }

  function writeDownloads(records) {
    fs.mkdirSync(path.dirname(downloadsIndex), { recursive: true });
    const temporary = `${downloadsIndex}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), 'utf8');
    fs.renameSync(temporary, downloadsIndex);
  }

  function categoryDirectory(category) {
    const downloadsRoot = fs.realpathSync(downloadsDirectory);
    const directory = path.join(downloadsRoot, CATEGORIES[validateCategory(category)]);
    fs.mkdirSync(directory, { recursive: true });
    const realDirectory = fs.realpathSync(directory);
    if (!realDirectory.startsWith(`${downloadsRoot}${path.sep}`)) throw new Error('Invalid downloads directory');
    return realDirectory;
  }

  async function getRelease(token) {
    const response = await fetchImpl(`${API_ROOT}/releases/latest`, { headers: apiHeaders(token) });
    return readJsonResponse(response, 'Latest release lookup');
  }

  async function currentCatalog(token) {
    const url = `${API_ROOT}/contents/${CATALOG_PATH}?ref=${BRANCH}`;
    const response = await fetchImpl(url, { headers: apiHeaders(token) });
    if (response.status === 404) return { catalog: emptyCatalog(), sha: null };
    const content = await readJsonResponse(response, 'Catalog lookup');
    return { catalog: parseCatalog(JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))), sha: content.sha };
  }

  async function writeCatalog(token, catalog, sha, message) {
    const response = await fetchImpl(`${API_ROOT}/contents/${CATALOG_PATH}`, {
      method: 'PUT',
      headers: apiHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(catalog, null, 2) + '\n').toString('base64'),
        ...(sha ? { sha } : {}),
        branch: BRANCH
      })
    });
    return readJsonResponse(response, 'Catalog update');
  }

  async function uploadFiles(token, files, itemId) {
    if (!files.length) return [];
    const release = await getRelease(token);
    const uploadUrl = release.upload_url.replace(/\{\?.*$/, '');
    const uploaded = [];
    try {
      for (const file of files) {
        const stat = fs.statSync(file.path);
        if (!stat.isFile() || stat.size <= 0 || stat.size > (file.image ? MAX_IMAGE_SIZE : MAX_FILE_SIZE)) {
          throw new Error(file.image ? 'Image must be at most 20 MB' : 'File must be at most 2 GB');
        }
        const ext = path.extname(file.name).toLowerCase();
        if (file.image && !IMAGE_EXTENSIONS.has(ext)) throw new Error('Unsupported image format');
        const suffix = crypto.randomBytes(5).toString('hex');
        const uploadName = `warehouse-${itemId}-${Date.now()}-${suffix}-${file.image ? 'cover' : 'file'}${ext}`;
        const asset = await requestUpload(`${uploadUrl}?name=${encodeURIComponent(uploadName)}`, token, file.path,
          file.image ? `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}` : 'application/octet-stream');
        uploaded.push({ assetId: asset.id, url: asset.browser_download_url, name: file.name, image: file.image });
      }
      return uploaded;
    } catch (error) {
      await Promise.allSettled(uploaded.map((asset) => fetchImpl(`${API_ROOT}/releases/assets/${asset.assetId}`, {
        method: 'DELETE', headers: apiHeaders(token)
      })));
      throw error;
    }
  }

  async function saveItem(input) {
    const token = await authorizeOwner();
    const category = validateCategory(input?.category);
    const title = validateText(input?.title, 'title', 120);
    const description = typeof input?.description === 'string' ? input.description.trim().slice(0, 5000) : '';
    const id = typeof input?.id === 'string' && /^[a-f0-9-]{36}$/i.test(input.id) ? input.id : crypto.randomUUID();
    const { catalog, sha } = await currentCatalog(token);
    const old = catalog.items.find((item) => item.id === id);
    if (!input.filePath && !old) throw new Error('Select a downloadable file');
    if (!input.imagePath && !old) throw new Error('Select a cover image');
    const files = [];
    if (input.filePath) {
      const filePath = path.resolve(input.filePath);
      const name = cleanFileName(path.basename(filePath));
      files.push({ path: filePath, name, image: false });
    }
    if (input.imagePath) {
      const imagePath = path.resolve(input.imagePath);
      const name = cleanFileName(path.basename(imagePath));
      files.push({ path: imagePath, name, image: true });
    }
    const assets = await uploadFiles(token, files, id);
    const fileAsset = assets.find((asset) => !asset.image);
    const imageAsset = assets.find((asset) => asset.image);
    const next = {
      id, category, title, description,
      fileName: fileAsset?.name || old.fileName,
      fileUrl: fileAsset?.url || old.fileUrl,
      imageUrl: imageAsset?.url || old.imageUrl,
      fileAssetId: fileAsset?.assetId || old.fileAssetId,
      imageAssetId: imageAsset?.assetId || old.imageAssetId,
      updatedAt: new Date().toISOString()
    };
    const items = old ? catalog.items.map((item) => item.id === id ? next : item) : [...catalog.items, next];
    try {
      await writeCatalog(token, { schemaVersion: 1, items }, sha, `Warehouse: ${old ? 'update' : 'add'} ${title}`);
    } catch (error) {
      await Promise.allSettled(assets.map((asset) => fetchImpl(`${API_ROOT}/releases/assets/${asset.assetId}`, {
        method: 'DELETE', headers: apiHeaders(token)
      })));
      throw error;
    }
    const obsoleteAssets = [
      fileAsset && old?.fileAssetId && old.fileAssetId !== fileAsset.assetId ? old.fileAssetId : null,
      imageAsset && old?.imageAssetId && old.imageAssetId !== imageAsset.assetId ? old.imageAssetId : null
    ].filter(Boolean);
    await Promise.allSettled(obsoleteAssets.map((assetId) => fetchImpl(`${API_ROOT}/releases/assets/${assetId}`, {
      method: 'DELETE', headers: apiHeaders(token)
    })));
    fs.writeFileSync(cacheFile, JSON.stringify({ schemaVersion: 1, items }), 'utf8');
    return parseCatalog({ schemaVersion: 1, items });
  }

  async function deleteItem(id) {
    const token = await authorizeOwner();
    const { catalog, sha } = await currentCatalog(token);
    const item = catalog.items.find((entry) => entry.id === id);
    if (!item) throw new Error('Warehouse item not found');
    const items = catalog.items.filter((entry) => entry.id !== id);
    await writeCatalog(token, { schemaVersion: 1, items }, sha, `Warehouse: remove ${item.title}`);
    await Promise.allSettled([item.fileAssetId, item.imageAssetId].filter(Boolean).map((assetId) =>
      fetchImpl(`${API_ROOT}/releases/assets/${assetId}`, { method: 'DELETE', headers: apiHeaders(token) })));
    fs.writeFileSync(cacheFile, JSON.stringify({ schemaVersion: 1, items }), 'utf8');
    return parseCatalog({ schemaVersion: 1, items });
  }

  async function downloadItem(id) {
    const item = (await getCatalog()).items.find((entry) => entry.id === id);
    if (!item) throw new Error('Warehouse item not found');
    const targetDirectory = categoryDirectory(item.category);
    const baseName = cleanFileName(item.fileName);
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    let fileName = baseName;
    let target = path.join(targetDirectory, fileName);
    for (let suffix = 2; fs.existsSync(target); suffix += 1) {
      fileName = `${stem} (${suffix})${ext}`;
      target = path.join(targetDirectory, fileName);
    }
    const response = await fetchImpl(item.fileUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`File download failed (${response.status})`);
    const output = fs.createWriteStream(target, { flags: 'wx' });
    try { await pipeline(Readable.fromWeb(response.body), output); }
    catch (error) { try { fs.unlinkSync(target); } catch {} throw error; }
    const record = {
      id: crypto.randomUUID(), itemId: item.id, title: item.title,
      category: item.category, fileName, relativePath: path.relative(downloadsDirectory, target)
    };
    const records = readDownloads();
    records.push(record);
    try { writeDownloads(records); }
    catch (error) { try { fs.unlinkSync(target); } catch {} throw error; }
    return listDownloads();
  }

  function listDownloads() {
    return readDownloads().filter((record) => {
      try {
        const expectedRoot = categoryDirectory(record.category);
        const target = path.resolve(fs.realpathSync(downloadsDirectory), record.relativePath);
        return target.startsWith(`${expectedRoot}${path.sep}`) && fs.existsSync(target);
      } catch { return false; }
    }).map(({ id, itemId, title, category, fileName }) => ({ id, itemId, title, category, fileName }));
  }

  function deleteDownload(id) {
    const records = readDownloads();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Download not found');
    const target = path.resolve(fs.realpathSync(downloadsDirectory), record.relativePath);
    const expectedRoot = categoryDirectory(record.category);
    if (!target.startsWith(`${expectedRoot}${path.sep}`)) throw new Error('Invalid download path');
    if (fs.existsSync(target)) fs.unlinkSync(target);
    writeDownloads(records.filter((item) => item.id !== id));
    return listDownloads();
  }

  function verifyPin(pin) {
    if (typeof pin !== 'string') return false;
    const candidate = crypto.createHash('sha256').update(pin).digest();
    const expected = Buffer.from(PIN_HASH, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  return { checkAdmin, getCatalog, saveItem, deleteItem, downloadItem, listDownloads, deleteDownload, verifyPin };
}

module.exports = { createWarehouseService, CATEGORIES, parseCatalog, validateCategory, cleanFileName };
