const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStartAnimation: (callback) => {
    ipcRenderer.removeAllListeners('start-animation');
    ipcRenderer.on('start-animation', (event, config) => callback(config));
  },
  overlayShown: () => ipcRenderer.send('overlay-shown'),
  dismiss: () => ipcRenderer.send('dismissed'),
  snooze: () => ipcRenderer.send('snooze'),
  onLoadConfig: (callback) => {
    ipcRenderer.removeAllListeners('load-config');
    ipcRenderer.on('load-config', (event, config) => callback(config));
  },
  saveConfig: (config) => ipcRenderer.send('save-config', config),
  closeSettings: () => ipcRenderer.send('close-settings'),
  pickWebmDir: () => ipcRenderer.send('pick-webm-dir'),
  onWebmDirPicked: (callback) => {
    ipcRenderer.removeAllListeners('webm-dir-picked');
    ipcRenderer.on('webm-dir-picked', (event, dir) => callback(dir));
  },
  activate: (serial) => ipcRenderer.send('activate', serial),
  skipActivation: () => ipcRenderer.send('skip-activation'),
  onActivationResult: (callback) => {
    ipcRenderer.removeAllListeners('activation-result');
    ipcRenderer.on('activation-result', (event, result) => callback(result));
  },
  onLicenseStatus: (callback) => {
    ipcRenderer.removeAllListeners('license-status');
    ipcRenderer.on('license-status', (event, status) => callback(status));
  }
});
