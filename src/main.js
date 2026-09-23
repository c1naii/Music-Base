const { app, BrowserWindow, ipcMain, screen, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { createUpdater } = require('./updater');
const { loadPreferences, savePreferences } = require('./preferences');
const { createNotesStore } = require('./notes');
const { createWarehouseService } = require('./warehouse');
const { findInstalledDaw } = require('./daw');

const SPLASH_DURATION_MS = 2600;
const FADE_DURATION_MS = 360;
const FADE_STEP_MS = 20;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindow;
let splashWindow;
let updater;
let preferences;
let preferencesFile;
let notesStore;
let warehouseStore;
let defaultDownloadsDirectory;
let warehouseAdminUnlocked = false;

function createWindow(options, page, query) {
  const window = new BrowserWindow({
    backgroundColor: '#080808',
    icon: path.join(__dirname, '..', 'assets', 'sigil.png'),
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    ...options
  });

  window.loadFile(path.join(__dirname, page), query ? { query } : undefined);
  return window;
}

function visibleBounds(bounds) {
  if (!bounds) return { width: 1180, height: 760, center: true };
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  };
}

function publicPreferences() {
  return {
    language: preferences.language,
    showSplash: preferences.showSplash,
    visualEffects: preferences.visualEffects,
    lastPlace: preferences.lastPlace,
    downloadDirectory: preferences.downloadDirectory || defaultDownloadsDirectory,
    downloadDirectoryIsDefault: !preferences.downloadDirectory,
    connectedDaws: preferences.connectedDaws
  };
}

function fadeIn(window) {
  let opacity = 0;
  window.setOpacity(opacity);
  window.show();

  const timer = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(timer);
      return;
    }

    opacity = Math.min(1, opacity + FADE_STEP_MS / FADE_DURATION_MS);
    window.setOpacity(opacity);
    if (opacity === 1) clearInterval(timer);
  }, FADE_STEP_MS);
}

function createApp() {
  mainWindow = createWindow({
    ...visibleBounds(preferences.bounds),
    minWidth: 680,
    minHeight: 480,
    resizable: true,
    movable: true,
    thickFrame: true,
    title: 'Music Base'
  }, 'index.html', {
    language: preferences.language,
    effects: preferences.visualEffects ? 'on' : 'off'
  });

  mainWindow.on('close', () => {
    preferences.bounds = mainWindow.getNormalBounds();
    preferences.maximized = mainWindow.isMaximized();
    savePreferences(preferencesFile, preferences);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const destination = new URL(url);
      const allowedIds = new Set([
        '7gso16ro7Js', '9A8UtGurtwI', '54SH2zWD7u8', 'b4NLHcGRiEY',
        'lt0gH04fed0', 'XXDB4jtEaic', '6oLM0L7_RVM'
      ]);
      if (destination.protocol === 'https:' && destination.hostname === 'www.youtube.com' &&
          destination.pathname === '/watch' && allowedIds.has(destination.searchParams.get('v'))) {
        shell.openExternal(url);
      }
    } catch {
      // Ignore malformed URLs from the renderer.
    }
    return { action: 'deny' };
  });

  let mainReady = false;
  let splashDone = !preferences.showSplash;
  const showMain = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible() || !mainReady || !splashDone) return;
    if (preferences.maximized && !mainWindow.isMaximized()) mainWindow.maximize();
    if (preferences.showSplash) fadeIn(mainWindow);
    else mainWindow.show();
  };

  mainWindow.once('ready-to-show', () => {
    mainReady = true;
    showMain();
  });

  if (preferences.showSplash) {
    splashWindow = createWindow({
      width: 620,
      height: 400,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'Music Base'
    }, 'splash.html', { language: preferences.language });

    splashWindow.once('ready-to-show', () => {
      splashWindow.show();
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      }, SPLASH_DURATION_MS);
    });
    splashWindow.on('closed', () => {
      splashWindow = null;
      splashDone = true;
      showMain();
    });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window-control', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow) return;

  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (action === 'close') window.close();
});

ipcMain.handle('app-version', () => app.getVersion());

function isMainWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) === mainWindow;
}

function requireWarehouseAdmin(event) {
  if (!isMainWindow(event) || !warehouseAdminUnlocked) throw new Error('Admin access required');
}

ipcMain.handle('warehouse-catalog', (event) => isMainWindow(event) ? warehouseStore.getCatalog() : null);
ipcMain.handle('warehouse-admin-check', (event) => isMainWindow(event) ? warehouseStore.checkAdmin() : false);
ipcMain.handle('warehouse-admin-verify', async (event, pin) => {
  if (!isMainWindow(event)) return false;
  warehouseAdminUnlocked = false;
  if (!warehouseStore.verifyPin(pin) || !await warehouseStore.checkAdmin()) return false;
  warehouseAdminUnlocked = true;
  return true;
});
ipcMain.on('warehouse-admin-lock', (event) => {
  if (isMainWindow(event)) warehouseAdminUnlocked = false;
});
ipcMain.handle('warehouse-pick-file', async (event, kind) => {
  requireWarehouseAdmin(event);
  const image = kind === 'image';
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    ...(image ? { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] } : {})
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});
ipcMain.handle('warehouse-save-item', async (event, item) => {
  requireWarehouseAdmin(event);
  return warehouseStore.saveItem(item);
});
ipcMain.handle('warehouse-delete-item', async (event, id) => {
  requireWarehouseAdmin(event);
  return warehouseStore.deleteItem(id);
});
ipcMain.handle('warehouse-downloads', (event) => isMainWindow(event) ? warehouseStore.listDownloads() : null);
ipcMain.handle('warehouse-favorites', (event) => isMainWindow(event) ? warehouseStore.getFavorites() : []);
ipcMain.handle('warehouse-toggle-favorite', (event, id) => isMainWindow(event) ? warehouseStore.toggleFavorite(id) : []);
ipcMain.handle('warehouse-download-item', (event, id) => isMainWindow(event) ? warehouseStore.downloadItem(id,
  (percent) => { if (!event.sender.isDestroyed()) event.sender.send('warehouse-download-progress', { id, percent }); }) : null);
ipcMain.handle('warehouse-delete-download', (event, id) => isMainWindow(event) ? warehouseStore.deleteDownload(id) : null);
ipcMain.handle('warehouse-open-download', async (event, id) => {
  if (!isMainWindow(event)) return false;
  const result = await shell.openPath(warehouseStore.getDownloadPath(id));
  if (result) throw new Error(result);
  return true;
});
ipcMain.on('warehouse-start-drag', (event, id) => {
  if (!isMainWindow(event)) return;
  try {
    const file = warehouseStore.getDragFile(id);
    if (file) event.sender.startDrag({ file, icon: path.join(__dirname, '..', 'assets', 'sigil.png') });
  } catch {}
});

ipcMain.handle('choose-download-directory', async (event) => {
  if (!isMainWindow(event)) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: preferences.language === 'en' ? 'Choose download folder' : preferences.language === 'uk' ? 'Виберіть папку завантаження' : 'Выберите папку загрузки',
    defaultPath: preferences.downloadDirectory || defaultDownloadsDirectory,
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return publicPreferences();
  preferences.downloadDirectory = path.resolve(result.filePaths[0]);
  preferences.downloadRoots = [...new Set([...preferences.downloadRoots, defaultDownloadsDirectory, preferences.downloadDirectory])];
  warehouseStore.setDownloadsDirectory(preferences.downloadDirectory);
  savePreferences(preferencesFile, preferences);
  return publicPreferences();
});

ipcMain.handle('reset-download-directory', (event) => {
  if (!isMainWindow(event)) return null;
  preferences.downloadDirectory = null;
  preferences.downloadRoots = [...new Set([...preferences.downloadRoots, defaultDownloadsDirectory])];
  warehouseStore.setDownloadsDirectory(defaultDownloadsDirectory);
  savePreferences(preferencesFile, preferences);
  return publicPreferences();
});

ipcMain.handle('integrate-daw', (event, daw) => {
  if (!isMainWindow(event) || !['flstudio', 'ableton'].includes(daw)) return null;
  const installed = findInstalledDaw(daw);
  if (!installed) throw new Error('DAW installation was not detected');
  preferences.connectedDaws[daw] = { version: installed.version, installPath: installed.installPath };
  savePreferences(preferencesFile, preferences);
  return installed;
});
ipcMain.handle('get-preferences', (event) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
  return publicPreferences();
});

ipcMain.handle('set-preference', (event, key, value) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
  if (key === 'language' && ['ru', 'en', 'uk'].includes(value)) preferences.language = value;
  else if (['showSplash', 'visualEffects'].includes(key) && typeof value === 'boolean') preferences[key] = value;
  else return null;
  savePreferences(preferencesFile, preferences);
  return publicPreferences();
});

ipcMain.handle('set-last-place', (event, place) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
  const next = require('./preferences').normalizePreferences({ ...preferences, lastPlace: place }).lastPlace;
  if (!next) return null;
  preferences.lastPlace = next;
  savePreferences(preferencesFile, preferences);
  return next;
});

for (const [channel, method] of [['notes-list', 'list'], ['notes-create', 'create'],
  ['notes-save', 'save'], ['notes-delete', 'remove']]) {
  ipcMain.handle(channel, (event, ...args) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return null;
    return notesStore[method](...args);
  });
}

ipcMain.on('install-update', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === mainWindow) updater?.install();
});

app.whenReady().then(() => {
  preferencesFile = path.join(app.getPath('userData'), 'music-base-preferences.json');
  preferences = loadPreferences(preferencesFile);
  const previousConnections = JSON.stringify(preferences.connectedDaws);
  for (const daw of Object.keys(preferences.connectedDaws)) {
    const installed = findInstalledDaw(daw);
    if (installed) preferences.connectedDaws[daw] = { version: installed.version, installPath: installed.installPath };
    else delete preferences.connectedDaws[daw];
  }
  if (JSON.stringify(preferences.connectedDaws) !== previousConnections) savePreferences(preferencesFile, preferences);
  notesStore = createNotesStore(path.join(app.getPath('appData'), 'Music Base', 'Data'));
  defaultDownloadsDirectory = path.join(app.getPath('documents'), 'Music Base');
  warehouseStore = createWarehouseService({
    dataDirectory: path.join(app.getPath('userData'), 'Data'),
    downloadsDirectory: preferences.downloadDirectory || defaultDownloadsDirectory,
    legacyDownloadsDirectory: defaultDownloadsDirectory,
    downloadsIndexPath: path.join(app.getPath('userData'), 'Data', 'downloads.json'),
    downloadRoots: [...preferences.downloadRoots, defaultDownloadsDirectory]
  });
  createApp();
  if (app.isPackaged && process.platform === 'win32') {
    updater = createUpdater(autoUpdater, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', status);
      }
    });
    setTimeout(() => updater.check(), 3500);
    setInterval(() => updater.check(), UPDATE_CHECK_INTERVAL_MS);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createApp();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
