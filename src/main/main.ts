import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { JsonRecentProjectRepository } from '@core/application/jsonRecentProjectRepository';
import { ExportApplication } from '@core/application/exportApplication';
import { ProjectApplication } from '@core/application/projectApplication';
import { RecentProjectsService } from '@core/application/recentProjectsService';
import { consoleLogger } from '@core/logger';
import { ProjectService } from '@core/project/projectService';
import { IPC_EVENTS } from '@shared/ipc/channels';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { ElectronAssetFilePicker } from './services/assetFilePicker';
import { ElectronDirectoryPicker } from './services/directoryPicker';
import { ElectronExportDestinationPicker } from './services/exportDestinationPicker';
import { ElectronOutputRevealer, resolveFfmpegPath } from './services/exportSystem';
import { createWindowOptions } from './windowOptions';

const RECENT_PROJECTS_FILE = 'recent-projects.json';

function isAllowedAppUrl(url: string): boolean {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer && url.startsWith(devServer)) {
    return true;
  }
  return url.startsWith('file://');
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(createWindowOptions(path.join(__dirname, '../preload/preload.js')));

  window.once('ready-to-show', () => window.show());

  // The renderer may never navigate away or open windows; external links go to the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
    }
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return window;
}

function bootstrap(): void {
  const projectService = new ProjectService();
  const recents = new RecentProjectsService(
    new JsonRecentProjectRepository(path.join(app.getPath('userData'), RECENT_PROJECTS_FILE)),
    projectService
  );
  const application = new ProjectApplication(projectService, recents, consoleLogger);
  const exports = new ExportApplication(projectService, {
    picker: new ElectronExportDestinationPicker(),
    revealer: new ElectronOutputRevealer(),
    publishProgress: (progress) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_EVENTS.exportProgress, progress);
      }
    },
    ffmpegPath: resolveFfmpegPath(),
    logger: consoleLogger
  });

  registerIpcHandlers({
    ipc: ipcMain,
    application,
    exports,
    directoryPicker: new ElectronDirectoryPicker(),
    assetPicker: new ElectronAssetFilePicker(),
    logger: consoleLogger
  });

  // Startup always shows the Application Home; no project is auto-opened (HU_00002 §4).
  createMainWindow();
}

void app.whenReady().then(() => {
  bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
