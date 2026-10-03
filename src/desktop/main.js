import { app, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../../dist/web/index.html', import.meta.url));
let mainWindow;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    try {
      mainWindow = new BrowserWindow({
        width: 1120, height: 900, minWidth: 480, minHeight: 620,
        title: '国际象棋', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      await mainWindow.loadFile(indexPath);
    } catch (error) {
      dialog.showErrorBox('国际象棋无法启动', error.message);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
