const { app, BrowserWindow, globalShortcut, Menu, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const userConfigPath = path.join(app.getPath('userData'), 'exambro-universal-config.json');
let mainWindow = null;
let allowForceQuit = false;
let requirePinOnSetup = false;
const pressedKeys = new Set();

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest('hex');
}

function parseConfigPayload(rawInput) {
  const text = String(rawInput || '').trim();
  if (!text) return null;

  let jsonStr = text;
  if (text.startsWith('CBTNFC1:')) {
    const b64 = text.slice('CBTNFC1:'.length).trim();
    jsonStr = Buffer.from(b64, 'base64url').toString('utf8');
  }

  const obj = JSON.parse(jsonStr);
  if (!obj || obj.app !== 'CBT_NUSANTARA_EXAMBRO') return null;

  const serverUrl = String(obj.server_url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(serverUrl)) return null;

  return {
    app: 'CBT_NUSANTARA_EXAMBRO',
    v: obj.v || 1,
    school_name: String(obj.school_name || 'CBT Nusantara').trim(),
    server_url: serverUrl,
    lock_server: obj.lock_server !== false,
    admin_pin_sha256: String(obj.admin_pin_sha256 || '').trim(),
    updated_at: obj.updated_at || new Date().toISOString()
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(userConfigPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function tryLoadSeedConfigFile() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'exambro-config.cbtcfg'),
    path.join(process.resourcesPath || '', 'exambro-config.cbtcfg'),
    path.join(__dirname, 'exambro-config.cbtcfg')
  ];
  for (const filePath of candidates) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        const parsed = parseConfigPayload(fs.readFileSync(filePath, 'utf8'));
        if (parsed) return saveConfig(parsed);
      }
    } catch (e) {}
  }
  return null;
}

function readConfig() {
  try {
    if (fs.existsSync(userConfigPath)) {
      const parsed = parseConfigPayload(fs.readFileSync(userConfigPath, 'utf8'));
      if (parsed) return parsed;
    }
  } catch (e) {}
  return tryLoadSeedConfigFile();
}

function openSetupPage(needPin) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  requirePinOnSetup = Boolean(needPin);
  mainWindow.loadFile(path.join(__dirname, 'setup.html'));
}

function loadActiveServerOrSetup() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cfg = readConfig();
  if (cfg && cfg.server_url) {
    mainWindow.setTitle(`${cfg.school_name} - Exambro Nusantara`);
    mainWindow.loadURL(cfg.server_url);
  } else {
    openSetupPage(false);
  }
}

function forceExitApp() {
  allowForceQuit = true;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
      mainWindow.setAlwaysOnTop(false);
    }
  } catch (e) {}
  app.quit();
}

function isLocalSetupFrame(event) {
  try {
    const url = event.senderFrame ? event.senderFrame.url : '';
    return url.startsWith('file://');
  } catch (e) {
    return false;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('exambro:get-state', (event) => {
    if (!isLocalSetupFrame(event)) return { ok: false };
    return {
      ok: true,
      requirePin: requirePinOnSetup,
      currentConfig: readConfig()
    };
  });

  ipcMain.handle('exambro:verify-pin', (event, pin) => {
    if (!isLocalSetupFrame(event)) return { ok: false, message: 'Akses ditolak.' };
    const cfg = readConfig();
    if (!cfg || !cfg.lock_server || !cfg.admin_pin_sha256) {
      requirePinOnSetup = false;
      return { ok: true };
    }
    if (sha256Hex(String(pin || '').trim()).toLowerCase() === cfg.admin_pin_sha256.toLowerCase()) {
      requirePinOnSetup = false;
      return { ok: true };
    }
    return { ok: false, message: 'PIN Admin salah! Coba lagi.' };
  });

  ipcMain.handle('exambro:apply-code', (event, rawCode) => {
    if (!isLocalSetupFrame(event)) return { ok: false, message: 'Akses ditolak.' };
    if (requirePinOnSetup) return { ok: false, message: 'Verifikasi PIN Admin terlebih dahulu.' };
    try {
      const parsed = parseConfigPayload(rawCode);
      if (!parsed) return { ok: false, message: 'Kode konfigurasi tidak valid! Pastikan kode berawalan CBTNFC1:.' };
      saveConfig(parsed);
      setTimeout(() => loadActiveServerOrSetup(), 350);
      return { ok: true, message: `Terhubung & terkunci ke ${parsed.school_name}` };
    } catch (e) {
      return { ok: false, message: 'Gagal membaca kode konfigurasi.' };
    }
  });

  ipcMain.handle('exambro:import-file', async (event) => {
    if (!isLocalSetupFrame(event)) return { ok: false, message: 'Akses ditolak.' };
    if (requirePinOnSetup) return { ok: false, message: 'Verifikasi PIN Admin terlebih dahulu.' };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Pilih File Konfigurasi Exambro (.cbtcfg)',
      properties: ['openFile'],
      filters: [
        { name: 'Exambro Config', extensions: ['cbtcfg', 'json'] },
        { name: 'Semua File', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
      return { canceled: true };
    }
    try {
      const content = fs.readFileSync(res.filePaths[0], 'utf8');
      const parsed = parseConfigPayload(content);
      if (!parsed) return { ok: false, message: 'Format file .cbtcfg tidak valid!' };
      saveConfig(parsed);
      setTimeout(() => loadActiveServerOrSetup(), 350);
      return { ok: true, message: `Terhubung & terkunci ke ${parsed.school_name}` };
    } catch (e) {
      return { ok: false, message: 'Gagal membaca file konfigurasi.' };
    }
  });

  ipcMain.handle('exambro:cancel-setup', (event) => {
    if (!isLocalSetupFrame(event)) return;
    requirePinOnSetup = false;
    loadActiveServerOrSetup();
  });

  ipcMain.handle('exambro:quit-app', (event) => {
    if (!isLocalSetupFrame(event)) return;
    forceExitApp();
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const isMac = process.platform === 'darwin';
  const uaPlatform = isMac
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'Windows NT 10.0; Win64; x64';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: true,
    fullscreen: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      userAgent: `Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ExambroDesktop/2.0 ExambroNusantara/2.0`
    }
  });

  mainWindow.setContentProtection(true);
  loadActiveServerOrSetup();

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();

    if (input.type === 'keyDown') {
      pressedKeys.add(key);
      const hasMod = input.control || input.meta || pressedKeys.has('control') || pressedKeys.has('meta');

      // Keluar aplikasi: Ctrl/Cmd + C + B
      if (hasMod && pressedKeys.has('c') && pressedKeys.has('b')) {
        event.preventDefault();
        pressedKeys.clear();
        forceExitApp();
        return;
      }

      // Ganti server (Admin): Ctrl/Cmd + S + B ATAU Ctrl/Cmd + Shift + Alt + S
      const isAdminShortcut =
        (hasMod && pressedKeys.has('s') && pressedKeys.has('b')) ||
        (hasMod && input.shift && input.alt && key === 's');

      if (isAdminShortcut) {
        event.preventDefault();
        pressedKeys.clear();
        const cfg = readConfig();
        const needPin = Boolean(cfg && cfg.lock_server && cfg.admin_pin_sha256);
        openSetupPage(needPin);
        return;
      }
    } else if (input.type === 'keyUp') {
      pressedKeys.delete(key);
    }

    if (
      key === 'f12' ||
      key === 'escape' ||
      key === 'f11' ||
      (input.alt && key === 'f4') ||
      (input.alt && key === 'tab') ||
      ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key)) ||
      ((input.control || input.meta) && ['w', 'n', 't', 'r'].includes(key))
    ) {
      event.preventDefault();
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (!allowForceQuit && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
    }
  });

  mainWindow.on('close', (e) => {
    if (allowForceQuit) return;
    e.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Batal', 'Tutup Aplikasi'],
      defaultId: 0,
      title: 'Exambro Nusantara Universal',
      message: 'Gunakan kombinasi Ctrl + C + B atau konfirmasi untuk menutup Exambro Nusantara.'
    }).then((res) => {
      if (res.response === 1) forceExitApp();
    });
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  globalShortcut.register('Alt+Tab', () => {});
  globalShortcut.register('CommandOrControl+R', () => {});
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});