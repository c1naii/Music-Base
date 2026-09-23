const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicBase', {
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreference: (key, value) => ipcRenderer.invoke('set-preference', key, value),
  setLastPlace: (place) => ipcRenderer.invoke('set-last-place', place),
  listNotes: () => ipcRenderer.invoke('notes-list'),
  createNote: (title) => ipcRenderer.invoke('notes-create', title),
  saveNote: (oldTitle, title, content, pinned) => ipcRenderer.invoke('notes-save', oldTitle, title, content, pinned),
  deleteNote: (title) => ipcRenderer.invoke('notes-delete', title),
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
