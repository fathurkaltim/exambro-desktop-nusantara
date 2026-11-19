const { app, BrowserWindow, globalShortcut, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const configPath = path.join(app.getPath('userData'), 'exambro-config.json');
let allowForceQuit = false;
const pressedKeys = new Set();

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data && data.url) return data;
    }
  } catch (e) {}
  return null;
}

function saveConfig(url, label) {
  let cleanUrl = String(url || '').trim();
  if (!cleanUrl) return null;
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = 'https://' + cleanUrl;
  }
  const payload = {
    url: cleanUrl,
    label: label || cleanUrl
  };
  try {
    fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {}
  return payload;
}

async function promptServerSelection(win, isInitial = false) {
  if (!win || win.isDestroyed()) return;

  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Pilih Server CBT Nusantara - HIPPER Indonesia',
    message: isInitial
      ? 'Pilih server CBT sekolah Anda (akan diingat otomatis untuk sesi berikutnya):'
      : 'Pilih atau ubah server CBT tujuan:',
    buttons: [
      'Server SMAGAJUARA (cbt.smagajuara.id)',
      'Server SMAGAUL (cbt.smagaul.biz.id)',
      'Masukkan Domain Sekolah Lain'
    ],
    defaultId: 0,
    cancelId: 0
  });

  if (choice.response === 0) {
    const saved = saveConfig('https://cbt.smagajuara.id/', 'SMAGAJUARA');
    if (saved) win.loadURL(saved.url);
  } else if (choice.response === 1) {
    const saved = saveConfig('https://cbt.smagaul.biz.id/', 'SMAGAUL');
    if (saved) win.loadURL(saved.url);
  } else if (choice.response === 2) {
    const customInputHtml = `
      <html>
      <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="background:#1e293b;padding:24px;border-radius:12px;width:380px;border:1px solid #334155;">
          <h3 style="margin:0 0 10px;color:#facc15;">Domain Server CBT Sekolah</h3>
          <p style="font-size:12px;color:#cbd5e1;margin:0 0 14px;">Masukkan alamat URL/domain CBT sekolah (contoh: https://cbt.sekolah.sch.id):</p>
          <input id="domainInput" type="text" placeholder="https://cbt.sekolah.sch.id" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#fff;margin-bottom:14px;" />
          <button id="saveBtn" style="width:100%;padding:10px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-weight:bold;cursor:pointer;">Simpan & Hubungkan</button>
        </div>
        <script>
          document.getElementById('saveBtn').addEventListener('click', () => {
            const val = document.getElementById('domainInput').value.trim();
            if (!val) return;
            window.location.href = 'exambro-set-server://?url=' + encodeURIComponent(val);
          });
        </script>
      </body>
      </html>
    `;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(customInputHtml));
  }
}

function forceExitApp(win) {
  allowForceQuit = true;
  try {
    if (win && !win.isDestroyed()) {
      win.setKiosk(false);
      win.setFullScreen(false);
      win.setAlwaysOnTop(false);
    }
  } catch (e) {}
  app.quit();
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: true,
    fullscreen: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ExambroDesktop/1.0 ExambroNusantara/1.0'
    }
  });

  mainWindow.setContentProtection(true);

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl && targetUrl.startsWith('exambro-set-server://')) {
      event.preventDefault();
      try {
        const parsed = new URL(targetUrl);
        const rawUrl = parsed.searchParams.get('url');
        const saved = saveConfig(rawUrl, rawUrl);
        if (saved) mainWindow.loadURL(saved.url);
      } catch (e) {}
    }
  });

  const existingCfg = readConfig();
  if (existingCfg && existingCfg.url) {
    mainWindow.loadURL(existingCfg.url);
  } else {
    mainWindow.webContents.once('did-finish-load', () => {
      promptServerSelection(mainWindow, true);
    });
    mainWindow.loadURL('about:blank');
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();

    if (input.type === 'keyDown') {
      pressedKeys.add(key);
      const hasCtrl = input.control || pressedKeys.has('control');

      // Shortcut khusus keluar: CTRL + C + B
      if (hasCtrl && pressedKeys.has('c') && pressedKeys.has('b')) {
        event.preventDefault();
        pressedKeys.clear();
        forceExitApp(mainWindow);
        return;
      }

      // Shortcut khusus ganti server: CTRL + S + B
      if (hasCtrl && pressedKeys.has('s') && pressedKeys.has('b')) {
        event.preventDefault();
        pressedKeys.clear();
        promptServerSelection(mainWindow, false);
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
      (input.control && input.shift && ['i', 'j', 'c'].includes(key)) ||
      (input.control && ['w', 'n', 't'].includes(key))
    ) {
      event.preventDefault();
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (!allowForceQuit && !mainWindow.isDestroyed()) {
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
      title: 'Exambro Nusantara - HIPPER Indonesia',
      message: 'Gunakan kombinasi Ctrl + C + B atau konfirmasi untuk menutup Exambro Nusantara.'
    }).then((res) => {
      if (res.response === 1) {
        forceExitApp(mainWindow);
      }
    });
  });
}

app.whenReady().then(() => {
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
