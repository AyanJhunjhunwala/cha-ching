const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chaching', {
  request: (req) => ipcRenderer.invoke('kalshi:request', req),
  secureGet: () => ipcRenderer.invoke('secure:get'),
  secureSet: (value) => ipcRenderer.invoke('secure:set', value),
  secureClear: () => ipcRenderer.invoke('secure:clear'),
  socketOpen: (args) => ipcRenderer.invoke('socket:open', args),
  socketSend: (args) => ipcRenderer.invoke('socket:send', args),
  socketClose: (args) => ipcRenderer.invoke('socket:close', args),
  onSocketEvent: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('socket:event', listener);
    return () => ipcRenderer.removeListener('socket:event', listener);
  },
});
