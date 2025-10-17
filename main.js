const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
let config = { trashFolder: '', lastImageFolder: '', lastDestFolder: '', defaultImageEditor: '' };

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
    show: false,
  });
  win.loadFile('index.html');

  // Show window and maximize if configured
  if (config.startMaximized) {
    win.maximize();
  }
  win.show();

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
  const results = [];
  
  for (const f of files) {
    // Skip hidden files and system folders
    if (f.name.startsWith('.') || f.name === 'System Volume Information' || f.name === '$RECYCLE.BIN') {
      continue;
    }
    
    const itemPath = path.join(folderPath, f.name);
    
    // Check if it's a symbolic link first
    try {
      const stats = fs.lstatSync(itemPath);
      if (stats.isSymbolicLink()) {
        // It's a symlink - check if it points to a directory
        try {
          const targetStats = fs.statSync(itemPath); // follows symlink
          if (targetStats.isDirectory()) {
            const realPath = fs.realpathSync(itemPath);
            results.push({
              name: f.name,
              type: 'symlink',
              path: realPath // Use the real target path
            });
          }
        } catch (err) {
          // Broken symlink or not pointing to a directory, skip it
          console.warn(`Skipping broken or invalid symlink: ${f.name}`);
        }
        continue;
      }
    } catch (err) {
      console.warn(`Error checking symlink for ${f.name}:`, err.message);
    }
    
    // Add regular directories
    if (f.isDirectory()) {
      results.push({
        name: f.name,
        type: 'directory',
        path: itemPath
      });
    }
    // Check for .lnk files (Windows shortcuts)
    else if (f.isFile() && f.name.endsWith('.lnk') && process.platform === 'win32') {
      try {
        const shortcutPath = itemPath;
        const { execSync } = require('child_process');
        
        // Use PowerShell to resolve the shortcut target
        const command = `powershell -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath}').TargetPath"`, targetPath = execSync(command, { encoding: 'utf8' }).trim();
        
        // Check if the target exists and is a directory
        if (targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          results.push({
            name: f.name.replace('.lnk', ''), // Remove .lnk extension for display
            type: 'shortcut',
            path: targetPath, // Use the actual target path
            shortcutPath: shortcutPath // Keep original shortcut path for reference
          });
        }
      } catch (error) {
        console.warn(`Failed to resolve shortcut ${f.name}:`, error.message);
      }
    }
  }
  
  return results;
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

// Folder management IPC handlers
ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message}`);
  }
});

ipcMain.handle('create-shortcut', async (event, targetPath, shortcutPath) => {
  try {
    // On Windows, we'll create a .lnk file
    if (process.platform === 'win32') {
      const shell = require('child_process');
      const command = `powershell "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${shortcutPath}'); $s.TargetPath = '${targetPath}'; $s.Save()"`;
      shell.execSync(command);
    } else {
      // On Unix-like systems, create a symbolic link
      fs.symlinkSync(targetPath, shortcutPath.replace('.lnk', ''));
    }
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to create shortcut: ${error.message}`);
  }
});

ipcMain.handle('create-symlink', async (event, targetPath, linkPath) => {
  try {
    if (fs.existsSync(linkPath)) {
      throw new Error('A file or folder with that name already exists');
    }
    
    // On Windows, attempt symlink creation with mklink fallback
    if (process.platform === 'win32') {
      try {
        fs.symlinkSync(targetPath, linkPath, 'dir');
        return { success: true };
      } catch (symlinkError) {
        if (symlinkError.code === 'EPERM') {
          // Try using mklink command as fallback
          try {
            const { execSync } = require('child_process');
            const command = `mklink /D "${linkPath}" "${targetPath}"`;
            execSync(command, { stdio: 'pipe' });
            return { success: true };
          } catch (mklinkError) {
            throw new Error('Creating symbolic links requires administrator privileges.\n\nSolutions:\n1. Right-click the app and select "Run as administrator"\n2. Enable Developer Mode: Settings → Update & Security → For developers → Developer Mode\n3. Use "Create Shortcut" instead (works without admin rights)\n\nNote: You can restart the application as administrator to use this feature.');
          }
        }
        throw symlinkError;
      }
    } else {
      // On Unix-like systems, symlinks usually work without special privileges
      fs.symlinkSync(targetPath, linkPath, 'dir');
      return { success: true };
    }
  } catch (error) {
    throw new Error(`Failed to create symbolic link: ${error.message}`);
  }
});

// Check if running as administrator on Windows
ipcMain.handle('check-admin-privileges', async () => {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      // Try to run a command that requires admin privileges
      execSync('net session >nul 2>&1', { stdio: 'pipe' });
      return { isAdmin: true };
    } catch (error) {
      return { isAdmin: false };
    }
  }
  return { isAdmin: true }; // Non-Windows systems
});

ipcMain.handle('get-config', async () => config);
ipcMain.handle('set-config', async (event, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  return config;
});

ipcMain.handle('select-file', async (event, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    ...options
  });
  if (result.canceled) return null;
  return result.filePaths && result.filePaths[0] ? result.filePaths[0] : null;
});

ipcMain.handle('open-in-editor', async (event, editorPath, imagePath) => {
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    
    if (!editorPath || !imagePath) {
      throw new Error('Editor path and image path are required');
    }
    
    if (!fs.existsSync(editorPath)) {
      throw new Error(`Editor not found at: ${editorPath}`);
    }
    
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found at: ${imagePath}`);
    }
    
    console.log('Opening in editor:', editorPath);
    console.log('Image path:', imagePath);
    
    // Normalize paths to handle spaces and special characters
    const normalizedEditorPath = path.normalize(editorPath);
    const normalizedImagePath = path.normalize(imagePath);
    
    // Spawn the editor with the image path as argument
    // The array elements are automatically quoted by spawn
    const child = spawn(normalizedEditorPath, [normalizedImagePath], {
      detached: true,
      stdio: 'ignore',
      shell: false
    });
    
    child.unref();
    
    console.log('Editor process spawned successfully');
    
    return { success: true };
  } catch (error) {
    console.error('Failed to open in editor:', error);
    throw error;
  }
});
