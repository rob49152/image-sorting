const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
let config = { trashFolder: '', lastImageFolder: '', lastDestFolder: '' };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
}
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#222',
  });
  win.loadFile('index.html');

  // Build menu with Preferences and Show Help under Help menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show Help',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('open-help');
          }
        },
        {
          label: 'Preferences',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('open-preferences');
          }
        },
        { type: 'separator' },
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron')
            await shell.openExternal('https://electronjs.org')
          }
          },
          {
              label: 'About',
              click: (menuItem, browserWindow) => {
                  if (browserWindow) browserWindow.webContents.send('open-about');
              }
          }
      ]
    },
    {
      label: 'Sort',
      submenu: [
        {
          label: 'By Date (Ascending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'date', order: 'asc' })
        },
        {
          label: 'By Date (Descending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'date', order: 'desc' })
        },
        {
          label: 'By Size (Ascending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'size', order: 'asc' })
        },
        {
          label: 'By Size (Descending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'size', order: 'desc' })
        },
        {
          label: 'By Name (Ascending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'name', order: 'asc' })
        },
        {
          label: 'By Name (Descending)',
          click: (menuItem, browserWindow) => browserWindow.webContents.send('sort-images', { by: 'name', order: 'desc' })
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    saveConfig();
    app.quit();
  }
});

ipcMain.handle('list-directories', async (event, folderPath) => {
  const files = fs.readdirSync(folderPath, { withFileTypes: true });
  return files
    .filter(f => f.isDirectory() && !f.name.startsWith('.') && f.name !== 'System Volume Information' && f.name !== '$RECYCLE.BIN')
    .map(f => f.name);
});

ipcMain.handle('move-image', async (event, src, dest) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (!fs.existsSync(src)) {
      console.error('Source file does not exist:', src);
      return false;
    }
    try {
      fs.renameSync(src, dest);
      console.log(`Moved image from ${src} to ${dest}`);
      return true;
    } catch (err) {
      if (err.code === 'EXDEV') {
        // Cross-device: copy then delete
        const readStream = fs.createReadStream(src);
        const writeStream = fs.createWriteStream(dest);
        await new Promise((resolve, reject) => {
          readStream.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('finish', resolve);
          readStream.pipe(writeStream);
        });
        fs.unlinkSync(src);
        console.log(`Copied and deleted image from ${src} to ${dest}`);
        return true;
      } else {
        throw err;
      }
    }
  } catch (e) {
    console.error('Error moving image:', e);
    return false;
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.filePaths[0];
});

// Select a file (e.g., preferred image editor executable)
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'com'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths && result.filePaths[0] ? result.filePaths[0] : '';
});

ipcMain.handle('list-images', async (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') {
    return [];
  }
  let files = [];
  try {
    files = fs.readdirSync(folderPath);
  } catch (err) {
    return [];
  }
  return files.filter(f => /\.(jpg|jpeg|png|gif|bmp)$/i.test(f));
});

// IPC handler for image info
ipcMain.handle('get-image-info', async (event, imgPath) => {
  try {
    // Support both CommonJS default export and named export for image-size
    const imgSizeLib = require('image-size');
    const sizeFn = (typeof imgSizeLib === 'function') ? imgSizeLib : imgSizeLib.imageSize;
    const dimensions = sizeFn ? sizeFn(imgPath) : { width: 0, height: 0 };
    const stats = fs.statSync(imgPath);
    const meta = {};
    let sdPrompt = '';
    const buffer = fs.readFileSync(imgPath);
    // PNG: parse tEXt chunks for prompt
    if (/\.png$/i.test(imgPath)) {
      let i = 8; // PNG header is 8 bytes
      while (i < buffer.length) {
        const length = buffer.readUInt32BE(i);
        const type = buffer.toString('ascii', i + 4, i + 8);
        if (type === 'tEXt') {
          const chunk = buffer.toString('utf8', i + 8, i + 8 + length);
          if (/prompt/i.test(chunk)) {
            const match = chunk.match(/prompt: ?([\s\S]*)/i);
            if (match) {
              sdPrompt = match[1].trim();
              break;
            }
          }
        }
        i += 8 + length + 4; // chunk header + data + CRC
      }
    }
    // JPEG: try to extract XMP block
    if (/\.(jpg|jpeg)$/i.test(imgPath)) {
      const xmpStart = buffer.indexOf('<x:xmpmeta');
      const xmpEnd = buffer.indexOf('</x:xmpmeta>');
      if (xmpStart !== -1 && xmpEnd !== -1) {
        const xmp = buffer.toString('utf8', xmpStart, xmpEnd + 12);
        const match = xmp.match(/prompt: ?([\s\S]*?)(?:<|$)/i);
        if (match) {
          sdPrompt = match[1].trim();
        }
      }
      // Also try EXIF
      try {
        const exif = require('exif-parser').create(buffer).parse();
        meta.exif = exif.tags;
      } catch {}
    }
    return {
      width: dimensions.width || 0,
      height: dimensions.height || 0,
      created: stats.birthtime || stats.ctime || stats.mtime || '',
      meta,
      sdPrompt
    };
  } catch (e) {
    return { width: 0, height: 0, created: '', meta: {}, sdPrompt: '' };
  }
});

ipcMain.handle('get-config', async () => config);
ipcMain.handle('set-config', async (event, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  return config;
});

// Open image in configured external editor
ipcMain.handle('open-in-editor', async (event, imagePath) => {
  try {
    if (!imagePath) return false;
    const fs = require('fs');
    const { spawn } = require('child_process');
    const exe = config && config.imageEditorPath ? config.imageEditorPath : '';
    if (!exe || !fs.existsSync(exe)) return false;
    const child = spawn(exe, [imagePath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
});
