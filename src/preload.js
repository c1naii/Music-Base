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
  getWarehouseCatalog: () => ipcRenderer.invoke('warehouse-catalog'),
  checkWarehouseAdmin: () => ipcRenderer.invoke('warehouse-admin-check'),
  verifyWarehouseAdmin: (pin) => ipcRenderer.invoke('warehouse-admin-verify', pin),
  lockWarehouseAdmin: () => ipcRenderer.send('warehouse-admin-lock'),
  pickWarehouseFile: (kind) => ipcRenderer.invoke('warehouse-pick-file', kind),
  saveWarehouseItem: (item) => ipcRenderer.invoke('warehouse-save-item', item),
  deleteWarehouseItem: (id) => ipcRenderer.invoke('warehouse-delete-item', id),
  getWarehouseDownloads: () => ipcRenderer.invoke('warehouse-downloads'),
  downloadWarehouseItem: (id) => ipcRenderer.invoke('warehouse-download-item', id),
  deleteWarehouseDownload: (id) => ipcRenderer.invoke('warehouse-delete-download', id),
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
