const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicBase', {
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreference: (key, value) => ipcRenderer.invoke('set-preference', key, value),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('update-status', (_event, status) => callback(status));
  },
  installUpdate: () => ipcRenderer.send('install-update'),
  windowControl: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) {
      ipcRenderer.send('window-control', action);
    }
  }
});
