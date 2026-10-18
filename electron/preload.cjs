const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chaching', {
  request: (req) => ipcRenderer.invoke('kalshi:request', req),
  secureGet: () => ipcRenderer.invoke('secure:get'),
  secureSet: (value) => ipcRenderer.invoke('secure:set', value),
  secureClear: () => ipcRenderer.invoke('secure:clear'),
});
