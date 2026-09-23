const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { createUpdater } = require('./updater');

const SPLASH_DURATION_MS = 2600;
const FADE_DURATION_MS = 360;
const FADE_STEP_MS = 20;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindow;
let splashWindow;
let updater;

function createWindow(options, page) {
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

  window.loadFile(path.join(__dirname, page));
  return window;
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
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'Music Base'
  }, 'index.html');

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

  splashWindow = createWindow({
    width: 620,
    height: 400,
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Music Base'
  }, 'splash.html');

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      if (mainWindow && !mainWindow.isDestroyed()) fadeIn(mainWindow);
    }, SPLASH_DURATION_MS);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  splashWindow.on('closed', () => { splashWindow = null; });
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

ipcMain.on('install-update', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === mainWindow) updater?.install();
});

app.whenReady().then(() => {
  createApp();
  if (app.isPackaged && process.platform === 'win32') {
    updater = createUpdater(autoUpdater, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', status);
      }
    });
    setTimeout(() => updater.check(), 5000);
    setInterval(() => updater.check(), UPDATE_CHECK_INTERVAL_MS);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createApp();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
