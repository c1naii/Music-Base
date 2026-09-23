const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { createUpdater } = require('./updater');
const { loadPreferences, savePreferences } = require('./preferences');
const { createNotesStore } = require('./notes');

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
    lastPlace: preferences.lastPlace
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

  if (preferences.maximized) mainWindow.maximize();

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
  notesStore = createNotesStore(path.join(app.getPath('appData'), 'Music Base', 'Data'));
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
