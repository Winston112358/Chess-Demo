import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createNativeTransport } from '../engine/native-transport.js';
import { createUciAdapter } from '../engine/uci-adapter.js';
import { registerEngineService } from './engine-service.js';

const indexPath = fileURLToPath(new URL('../../dist/web/index.html', import.meta.url));
const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const CLEANUP_TIMEOUT_MS = 5000;

let mainWindow;
let engineService = null;
let quitting = false;
let quitAllowed = false;

function nativeExecutablePath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'stockfish', 'native', 'stockfish-windows-x86-64-universal.exe');
  }
  return fileURLToPath(new URL('../../vendor/stockfish/native/stockfish-windows-x86-64-universal.exe', import.meta.url));
}

function createEngine() {
  const executablePath = nativeExecutablePath();
  return createUciAdapter({
    createTransport: ({ onLine, onError }) => {
      if (!existsSync(executablePath)) {
        throw new Error(`缺少原生 Stockfish：${executablePath}；请运行 npm run setup:stockfish`);
      }
      return createNativeTransport({ executablePath, onLine, onError });
    },
  });
}

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
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      engineService = registerEngineService({
        ipcMain,
        webContents: mainWindow.webContents,
        indexUrl: pathToFileURL(indexPath).href,
        createEngine,
      });
      await mainWindow.loadFile(indexPath);
    } catch (error) {
      dialog.showErrorBox('国际象棋无法启动', error.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (quitAllowed || !engineService) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const cleanup = engineService.dispose().catch((error) => {
      console.error(`[desktop] 释放原生引擎失败：${error.message}`);
    });
    let cleanupTimer;
    const bounded = new Promise((resolve) => {
      cleanupTimer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
    });
    Promise.race([cleanup, bounded]).finally(() => {
      clearTimeout(cleanupTimer);
      quitAllowed = true;
      app.quit();
    });
  });
}
