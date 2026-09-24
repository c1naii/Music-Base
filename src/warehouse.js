const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const extractZip = require('extract-zip');
const sevenZip = require('7zip-bin');

const execFileAsync = promisify(execFile);

const OWNER = 'c1naii';
const REPOSITORY = 'Music-Base';
const BRANCH = 'main';
const CATALOG_PATH = 'warehouse/catalog.json';
const PIN_HASH = '31fa2fe6effab86b748d58a9906ac3d7d53d72e9e3854a7c6de63e860f8e854e';
const CATEGORIES = Object.freeze({
  drumkits: 'DRUMKITS',
  plugins: 'PLUGINS',
  projects: 'PROJECTS',
  presets: 'PRESETS',
  banks: 'BANKS'
});
const LIBRARY_FOLDERS = Object.freeze({
  drumkits: 'Drum Kits', plugins: 'Plugins', projects: 'Projects', presets: 'Presets',
  banks: 'Banks', samples: 'Samples', midi: 'MIDI'
});
const GENRES = Object.freeze(['pop', 'hip-hop', 'rock', 'electronic', 'rnb', 'funk', 'phonk', 'brazilian-phonk', 'ambient', 'jazz']);
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
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      publishedAt: isDateOnly(item.publishedAt) ? item.publishedAt : (isDateOnly(item.createdAt) ? item.createdAt : (typeof item.updatedAt === 'string' && isDateOnly(item.updatedAt.slice(0, 10)) ? item.updatedAt.slice(0, 10) : '')),
      genres: Array.isArray(item.genres) ? [...new Set(item.genres.filter((genre) => GENRES.includes(genre)))] : []
    };
  } catch { return null; }
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
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

function createWarehouseService({ dataDirectory, downloadsDirectory, downloadsIndexPath, legacyDownloadsDirectory = downloadsDirectory, downloadRoots = [], fetchImpl = fetch, tokenProvider = getGitHubToken }) {
  const cacheFile = path.join(dataDirectory, 'warehouse-catalog.json');
  const downloadsIndex = downloadsIndexPath || path.join(dataDirectory, 'downloads.json');
  let currentDownloadsDirectory = path.resolve(downloadsDirectory);
  const favoritesPath = path.join(dataDirectory, 'warehouse-favorites.json');
  const activeDownloads = new Set();
  const knownDownloadRoots = new Set([currentDownloadsDirectory, ...downloadRoots.map((item) => path.resolve(item))]);
  fs.mkdirSync(dataDirectory, { recursive: true });

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
        typeof record.itemId === 'string' && typeof record.fileName === 'string' && typeof record.root === 'string' &&
        Object.hasOwn(CATEGORIES, record.category) && typeof record.relativePath === 'string') : [];
    } catch { return []; }
  }

  function writeDownloads(records) {
    fs.mkdirSync(path.dirname(downloadsIndex), { recursive: true });
    const temporary = `${downloadsIndex}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), 'utf8');
    fs.renameSync(temporary, downloadsIndex);
  }

  function migrateLegacyDownloads() {
    const legacyIndex = path.join(path.resolve(legacyDownloadsDirectory), 'Data', 'downloads.json');
    if (path.resolve(legacyIndex) === path.resolve(downloadsIndex) || !fs.existsSync(legacyIndex)) return;
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyIndex, 'utf8'));
      if (!Array.isArray(legacy)) return;
      const current = readDownloads();
      const known = new Set(current.map((record) => record.id));
      for (const record of legacy) {
        if (!record || typeof record.id !== 'string' || known.has(record.id) || typeof record.itemId !== 'string' ||
            typeof record.title !== 'string' || typeof record.fileName !== 'string' || typeof record.relativePath !== 'string' ||
            !Object.hasOwn(CATEGORIES, record.category)) continue;
        current.push({ ...record, root: path.resolve(legacyDownloadsDirectory), isDirectory: false });
        known.add(record.id);
      }
      writeDownloads(current);
    } catch {}
  }

  function categoryDirectory(category, root = currentDownloadsDirectory) {
    const downloadsRootPath = path.resolve(root);
    fs.mkdirSync(downloadsRootPath, { recursive: true });
    const downloadsRoot = fs.realpathSync(downloadsRootPath);
    const directory = path.join(downloadsRoot, CATEGORIES[validateCategory(category)]);
    fs.mkdirSync(directory, { recursive: true });
    const realDirectory = fs.realpathSync(directory);
    if (!realDirectory.startsWith(`${downloadsRoot}${path.sep}`)) throw new Error('Invalid downloads directory');
    return realDirectory;
  }

  function libraryDirectory(category, root = currentDownloadsDirectory) {
    const categoryName = LIBRARY_FOLDERS[validateCategory(category)];
    fs.mkdirSync(path.resolve(root), { recursive: true });
    const realRoot = fs.realpathSync(path.resolve(root));
    const libraryPath = path.join(realRoot, 'Library');
    fs.mkdirSync(libraryPath, { recursive: true });
    const realLibrary = fs.realpathSync(libraryPath);
    if (!realLibrary.startsWith(`${realRoot}${path.sep}`)) throw new Error('Invalid library directory');
    const target = path.join(realLibrary, categoryName);
    fs.mkdirSync(target, { recursive: true });
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(`${realLibrary}${path.sep}`)) throw new Error('Invalid library category directory');
    return realTarget;
  }

  function ensureLibraryStructure(root = currentDownloadsDirectory) {
    const realRoot = path.resolve(root);
    fs.mkdirSync(realRoot, { recursive: true });
    const rootRealPath = fs.realpathSync(realRoot);
    const libraryPath = path.join(rootRealPath, 'Library');
    fs.mkdirSync(libraryPath, { recursive: true });
    const libraryRealPath = fs.realpathSync(libraryPath);
    if (!libraryRealPath.startsWith(`${rootRealPath}${path.sep}`)) throw new Error('Invalid library directory');
    for (const folder of Object.values(LIBRARY_FOLDERS)) {
      const target = path.join(libraryRealPath, folder);
      fs.mkdirSync(target, { recursive: true });
      if (!fs.realpathSync(target).startsWith(`${libraryRealPath}${path.sep}`)) throw new Error('Invalid library category directory');
    }
  }

  function setDownloadsDirectory(directory, integrationTargets = []) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Invalid downloads directory');
    const previous = currentDownloadsDirectory;
    let previousReal = previous;
    try { previousReal = fs.realpathSync(previous); } catch {}
    currentDownloadsDirectory = path.resolve(directory);
    knownDownloadRoots.add(currentDownloadsDirectory);
    ensureLibraryStructure(currentDownloadsDirectory);
    if (integrationTargets.length) fs.mkdirSync(currentDownloadsDirectory, { recursive: true });
    const currentReal = integrationTargets.length ? fs.realpathSync(currentDownloadsDirectory) : currentDownloadsDirectory;
    for (const parent of integrationTargets) {
      if (typeof parent !== 'string' || !path.isAbsolute(parent) || !fs.existsSync(parent)) continue;
      const link = path.join(fs.realpathSync(parent), 'Music Base');
      if (fs.existsSync(link)) {
        let target = null;
        try { target = fs.realpathSync(link); } catch {}
        if (target === currentReal) continue;
        if (target !== previousReal) continue;
        try { fs.rmdirSync(link); } catch { continue; }
      }
      if (!fs.existsSync(link)) {
        try { fs.symlinkSync(currentReal, link, 'junction'); } catch {}
      }
    }
    return currentDownloadsDirectory;
  }

  function addDownloadRoots(roots = []) {
    for (const root of roots) {
      if (typeof root === 'string' && path.isAbsolute(root)) knownDownloadRoots.add(path.resolve(root));
    }
  }

  function downloadTarget(record) {
    if (!knownDownloadRoots.has(path.resolve(record.root))) throw new Error('Unknown download directory');
    const expectedRoot = record.library === true ? libraryDirectory(record.category, record.root) : categoryDirectory(record.category, record.root);
    const target = path.resolve(fs.realpathSync(record.root), record.relativePath);
    if (!(record.libraryRoot === true && target === expectedRoot) && !target.startsWith(`${expectedRoot}${path.sep}`)) throw new Error('Invalid download path');
    return target;
  }

  function findSevenZip() {
    let candidate = sevenZip.path7za;
    if (candidate.includes('app.asar')) candidate = candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(candidate)) return candidate;
    const systemPaths = [
      path.join(process.env.ProgramFiles || '', '7-Zip', '7z.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', '7-Zip', '7z.exe')
    ];
    return systemPaths.find((item) => item && fs.existsSync(item)) || candidate;
  }

  async function extractArchive(archivePath, destination) {
    const extension = path.extname(archivePath).toLowerCase();
    if (extension === '.zip') return extractZip(archivePath, { dir: destination });
    if (extension === '.rar') {
      const executable = findSevenZip();
      if (!fs.existsSync(executable)) throw new Error('RAR extractor is unavailable');
      await execFileAsync(executable, ['x', archivePath, `-o${destination}`, '-y', '-bd'], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
      return;
    }
  }

  function findDraggableFiles(directory) {
    const matches = [];
    const visit = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (entry.isFile() && /\.(mid|midi|fst|fxp|fxb|vstpreset|adv|adg)$/i.test(entry.name)) matches.push(child);
      }
    };
    visit(directory);
    return matches;
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
    const requestedDate = input?.publishedAt;
    if (requestedDate !== undefined && requestedDate !== '' && !isDateOnly(requestedDate)) throw new Error('Invalid publication date');
    if (input?.genres !== undefined && (!Array.isArray(input.genres) || input.genres.some((genre) => !GENRES.includes(genre)))) throw new Error('Invalid material genres');
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
      publishedAt: requestedDate || old?.publishedAt || new Date().toISOString().slice(0, 10),
      genres: [...new Set(input?.genres || old?.genres || [])],
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

  function getFavorites() {
    try {
      const ids = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
      return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string'))] : [];
    } catch { return []; }
  }

  function toggleFavorite(id) {
    if (typeof id !== 'string' || !id) throw new Error('Invalid warehouse item');
    const favorites = new Set(getFavorites());
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    const temporary = `${favoritesPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...favorites]), 'utf8');
    fs.renameSync(temporary, favoritesPath);
    return [...favorites];
  }

  async function downloadItem(id, onProgress = () => {}) {
    if (activeDownloads.has(id)) throw new Error('Download already in progress');
    activeDownloads.add(id);
    try { return await performDownload(id, onProgress); }
    finally { activeDownloads.delete(id); }
  }

  async function performDownload(id, onProgress) {
    const prior = readDownloads().find((record) => record.itemId === id);
    if (prior) {
      try {
        const target = downloadTarget(prior);
        const existing = Array.isArray(prior.ownedPaths)
          ? prior.ownedPaths.some((relative) => fs.existsSync(path.resolve(prior.root, relative)))
          : fs.existsSync(target);
        if (existing) return listDownloads();
      }
      catch {}
    }
    const item = (await getCatalog()).items.find((entry) => entry.id === id);
    if (!item) throw new Error('Warehouse item not found');
    const root = currentDownloadsDirectory;
    const targetDirectory = libraryDirectory(item.category, root);
    const baseName = cleanFileName(item.fileName);
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    const isArchive = ['.zip', '.rar'].includes(ext.toLowerCase());
    if (isArchive) return installArchive(item, root, targetDirectory, baseName, stem, ext, onProgress);
    let fileName = baseName;
    let target = path.join(targetDirectory, fileName);
    for (let suffix = 2; fs.existsSync(target); suffix += 1) {
      fileName = `${stem} (${suffix})${ext}`;
      target = path.join(targetDirectory, fileName);
    }
    const temporary = path.join(targetDirectory, `.download-${crypto.randomUUID()}${ext}`);
    try {
      await fetchFile(item.fileUrl, temporary, onProgress);
      onProgress(0, 'installing');
      fs.renameSync(temporary, target);
    } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
    const record = {
      id: crypto.randomUUID(), itemId: item.id, title: item.title,
      category: item.category, fileName, root, library: true,
      publishedAt: item.publishedAt, genres: item.genres,
      relativePath: path.relative(root, target), isDirectory: false
    };
    const records = readDownloads();
    records.push(record);
    try { writeDownloads(records); }
    catch (error) { try { fs.unlinkSync(target); } catch {} throw error; }
    onProgress(100, 'done');
    return listDownloads();
  }

  async function installArchive(item, root, targetDirectory, baseName, stem, ext, onProgress) {
    const archivePath = path.join(targetDirectory, `.download-${crypto.randomUUID()}${ext}`);
    const stageDirectory = path.join(targetDirectory, `.install-${crypto.randomUUID()}`);
    const categoryName = LIBRARY_FOLDERS[item.category];
    const matchesCategory = (value) => value.localeCompare(categoryName, undefined, { sensitivity: 'accent' }) === 0;
    const folderName = cleanFileName(item.title || stem || 'Material');
    const installIntoCategory = matchesCategory(stem) || matchesCategory(folderName);
    const installedPaths = [];
    let installedDirectory = null;
    try {
      await fetchFile(item.fileUrl, archivePath, onProgress);
      onProgress(0, 'extracting');
      fs.mkdirSync(stageDirectory, { recursive: false });
      await extractArchive(archivePath, stageDirectory);
      onProgress(0, 'installing');
      const entries = fs.readdirSync(stageDirectory);
      if (!entries.length) throw new Error('Archive is empty');
      let sourceDirectory = stageDirectory;
      if (entries.length === 1) {
        const entry = entries[0];
        const candidate = path.join(stageDirectory, entry);
        if (fs.statSync(candidate).isDirectory() && [stem, folderName, categoryName].some((name) =>
          entry.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) sourceDirectory = candidate;
      }
      if (installIntoCategory) {
        const categoryEntries = fs.readdirSync(sourceDirectory);
        if (!categoryEntries.length) throw new Error('Archive is empty');
        for (const entry of categoryEntries) {
          if (fs.existsSync(path.join(targetDirectory, entry))) throw new Error('Material already exists in the library');
        }
        try {
          for (const entry of categoryEntries) {
            const target = path.join(targetDirectory, entry);
            fs.renameSync(path.join(sourceDirectory, entry), target);
            installedPaths.push(path.relative(root, target));
          }
        } catch (error) {
          for (const relative of [...installedPaths].reverse()) {
            try { fs.renameSync(path.resolve(root, relative), path.join(sourceDirectory, path.basename(relative))); } catch {}
          }
          installedPaths.length = 0;
          throw error;
        }
      } else {
        installedDirectory = path.join(targetDirectory, folderName);
        if (fs.existsSync(installedDirectory)) throw new Error('Material already exists in the library');
        fs.renameSync(sourceDirectory, installedDirectory);
        installedPaths.push(path.relative(root, installedDirectory));
      }
      fs.unlinkSync(archivePath);
      fs.rmSync(stageDirectory, { recursive: true, force: true });
    } catch (error) {
      try { fs.unlinkSync(archivePath); } catch {}
      try { fs.rmSync(stageDirectory, { recursive: true, force: true }); } catch {}
      if (error.message === 'RAR extractor is unavailable' || error.message === 'Archive is empty' || error.message === 'Material already exists in the library') throw error;
      throw new Error(`Archive extraction failed: ${error.message}`);
    }
    const record = {
      id: crypto.randomUUID(), itemId: item.id, title: item.title,
      category: item.category, fileName: baseName, root, library: true,
      publishedAt: item.publishedAt, genres: item.genres,
      relativePath: path.relative(root, installedDirectory || targetDirectory),
      isDirectory: Boolean(installedDirectory),
      ...(installIntoCategory ? { libraryRoot: true, ownedPaths: installedPaths } : {})
    };
    const draggableFiles = installedPaths.flatMap((relative) => {
      const target = path.resolve(root, relative);
      if (fs.statSync(target).isDirectory()) return findDraggableFiles(target);
      return /\.(mid|midi|fst|fxp|fxb|vstpreset|adv|adg)$/i.test(target) ? [target] : [];
    });
    if (draggableFiles.length === 1) record.dragRelativePath = path.relative(root, draggableFiles[0]);
    const records = readDownloads();
    records.push(record);
    try { writeDownloads(records); }
    catch (error) {
      for (const relative of installedPaths) {
        try { fs.rmSync(path.resolve(root, relative), { recursive: true, force: true }); } catch {}
      }
      throw error;
    }
    onProgress(100, 'done');
    return listDownloads();
  }

  async function fetchFile(url, target, onProgress) {
    let lastError;
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let offset = fs.existsSync(target) ? fs.statSync(target).size : 0;
      if (!offset && fs.existsSync(target)) fs.unlinkSync(target);
      try {
        const response = await fetchImpl(url, {
          redirect: 'follow',
          ...(offset ? { headers: { Range: `bytes=${offset}-` } } : {})
        });
        if (!response.ok || !response.body) throw new Error(`File download failed (${response.status})`);
        let total = Number(response.headers.get('content-length')) || 0;
        if (offset && response.status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          if (!range || Number(range[1]) !== offset) throw new Error('Invalid partial response');
          total = Number(range[3]);
        } else if (offset) {
          if (response.status !== 200) throw new Error('Resume not supported');
          fs.unlinkSync(target);
          offset = 0;
        }
        let received = offset;
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (total) onProgress(Math.min(99, Math.floor(received / total * 100)));
            callback(null, chunk);
          }
        });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(target, { flags: offset ? 'a' : 'wx' }));
        if (total && fs.statSync(target).size !== total) throw new Error('Incomplete download');
        onProgress(100);
        return;
      } catch (error) {
        lastError = error;
        if (['EACCES', 'EPERM', 'ENOSPC'].includes(error.code)) break;
        if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * (attempt + 1))));
      }
    }
    throw new Error(`File download failed after retries: ${lastError?.message || 'unknown error'}`);
  }

  function listDownloads() {
    return readDownloads().filter((record) => {
      try {
        const target = downloadTarget(record);
        if (Array.isArray(record.ownedPaths)) return record.ownedPaths.some((relative) => {
          const owned = path.resolve(record.root, relative);
          return owned.startsWith(`${target}${path.sep}`) && fs.existsSync(owned);
        });
        return fs.existsSync(target);
      }
      catch { return false; }
    }).map((record) => ({
      id: record.id, itemId: record.itemId, title: record.title, category: record.category,
      fileName: record.fileName, isDirectory: record.isDirectory === true,
      publishedAt: isDateOnly(record.publishedAt) ? record.publishedAt : '',
      genres: Array.isArray(record.genres) ? record.genres.filter((genre) => GENRES.includes(genre)) : [],
      draggable: typeof record.dragRelativePath === 'string' || (!record.isDirectory && !record.libraryRoot && (record.category === 'presets' || /\.(mid|midi)$/i.test(record.fileName)))
    }));
  }

  function deleteDownload(id) {
    const records = readDownloads();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Download not found');
    const target = downloadTarget(record);
    if (Array.isArray(record.ownedPaths)) {
      for (const relative of record.ownedPaths) {
        const owned = path.resolve(record.root, relative);
        if (owned.startsWith(`${target}${path.sep}`)) {
          try { fs.rmSync(owned, { recursive: true, force: true }); } catch {}
        }
      }
    } else if (fs.existsSync(target)) record.isDirectory ? fs.rmSync(target, { recursive: true, force: true }) : fs.unlinkSync(target);
    writeDownloads(records.filter((item) => item.id !== id));
    return listDownloads();
  }

  function getDownloadPath(id) {
    const record = readDownloads().find((item) => item.id === id);
    if (!record) throw new Error('Download not found');
    const target = downloadTarget(record);
    return record.isDirectory || record.libraryRoot === true ? target : path.dirname(target);
  }

  function getDragFile(id) {
    const record = readDownloads().find((item) => item.id === id);
    if (!record) return null;
    const target = downloadTarget(record);
    if (!record.isDirectory && record.libraryRoot !== true) {
      return fs.statSync(target).isFile() && (record.category === 'presets' || /\.(mid|midi)$/i.test(record.fileName)) ? target : null;
    }
    if (typeof record.dragRelativePath !== 'string') return null;
    const dragPath = path.resolve(fs.realpathSync(record.root), record.dragRelativePath);
    if (!dragPath.startsWith(`${target}${path.sep}`) || !fs.existsSync(dragPath) || !fs.statSync(dragPath).isFile()) return null;
    return dragPath;
  }

  function integrateWithDaw(parentDirectory) {
    if (typeof parentDirectory !== 'string' || !path.isAbsolute(parentDirectory) || !fs.statSync(parentDirectory).isDirectory()) {
      throw new Error('Invalid DAW folder');
    }
    const source = path.resolve(currentDownloadsDirectory);
    fs.mkdirSync(source, { recursive: true });
    const realSource = fs.realpathSync(source);
    const parent = fs.realpathSync(parentDirectory);
    if (parent === realSource || parent.startsWith(`${realSource}${path.sep}`)) throw new Error('Choose a DAW folder outside the downloads directory');
    const link = path.join(parent, 'Music Base');
    if (fs.existsSync(link)) {
      let linkedTo = null;
      try { linkedTo = fs.realpathSync(link); } catch {}
      if (linkedTo === realSource) return link;
      throw new Error('A Music Base folder already exists in the selected DAW location');
    }
    fs.symlinkSync(realSource, link, 'junction');
    return link;
  }

  function verifyPin(pin) {
    if (typeof pin !== 'string') return false;
    const candidate = crypto.createHash('sha256').update(pin).digest();
    const expected = Buffer.from(PIN_HASH, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  addDownloadRoots(downloadRoots);
  ensureLibraryStructure();
  migrateLegacyDownloads();
  return { checkAdmin, getCatalog, saveItem, deleteItem, downloadItem, listDownloads, deleteDownload, getDownloadPath, getDragFile, setDownloadsDirectory, integrateWithDaw, verifyPin, getFavorites, toggleFavorite };
}

module.exports = { createWarehouseService, CATEGORIES, GENRES, parseCatalog, validateCategory, cleanFileName };
