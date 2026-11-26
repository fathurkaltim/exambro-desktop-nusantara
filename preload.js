const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('exambroSetup', {
  getState: () => ipcRenderer.invoke('exambro:get-state'),
  importConfigFile: () => ipcRenderer.invoke('exambro:import-file'),
  applyConfigCode: (rawCode) => ipcRenderer.invoke('exambro:apply-code', rawCode),
  verifyAdminPin: (pin) => ipcRenderer.invoke('exambro:verify-pin', pin),
  cancelSetup: () => ipcRenderer.invoke('exambro:cancel-setup'),
  quitApp: () => ipcRenderer.invoke('exambro:quit-app')
});