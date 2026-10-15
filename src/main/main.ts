import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { JsonRecentProjectRepository } from '@core/application/jsonRecentProjectRepository';
import { AIConnectionService } from '@core/ai/connectionService';
import { ConversationRepository } from '@core/ai/conversationRepository';
import { JsonFile } from '@core/ai/jsonFile';
import { MCPClientService } from '@core/ai/mcp/mcpClientService';
import { AIModelRegistry, parseModelCache } from '@core/ai/modelRegistry';
import { createDefaultProviderRegistry } from '@core/ai/providers/registry';
import { SecureCredentialService } from '@core/ai/secureCredentialService';
import { AISettingsService } from '@core/ai/settingsService';
import { AITurnService } from '@core/ai/turnService';
import { GitHubCopilotRuntimeService } from '@core/ai/providers/copilotRuntime';
import { GitHubCopilotAuthenticationService } from '@core/ai/providers/copilotAuthentication';
import { GitHubCopilotSessionService } from '@core/ai/providers/copilotSessionService';
import { GitHubCopilotProviderAdapter } from '@core/ai/providers/githubCopilotProviderAdapter';
import { ExportApplication } from '@core/application/exportApplication';
import { ProjectApplication } from '@core/application/projectApplication';
import { RecentProjectsService } from '@core/application/recentProjectsService';
import { consoleLogger } from '@core/logger';
import { ProjectService } from '@core/project/projectService';
import { IPC_EVENTS } from '@shared/ipc/channels';
import { registerAiIpcHandlers } from './ipc/registerAiIpcHandlers';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { ElectronAssetFilePicker } from './services/assetFilePicker';
import { ElectronAttachmentFilePicker } from './services/aiAttachmentPicker';
import { ElectronDirectoryPicker } from './services/directoryPicker';
import { ElectronExportDestinationPicker } from './services/exportDestinationPicker';
import { ElectronOutputRevealer, resolveFfmpegPath } from './services/exportSystem';
import { SafeStorageCipher } from './services/safeStorageCipher';
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

function bootstrapAi(): void {
  const directory = path.join(app.getPath('userData'), 'ai');
  const credentials = new SecureCredentialService(path.join(directory, 'credentials.json'), new SafeStorageCipher());
  const copilotRuntime = new GitHubCopilotRuntimeService(path.join(directory, 'copilot'));
  const copilotAuth = new GitHubCopilotAuthenticationService(credentials, (url, init) => fetch(url, init));
  const providers = createDefaultProviderRegistry((url, init) => fetch(url, init), copilotRuntime);
  (providers.resolve('copilot') as GitHubCopilotProviderAdapter).setAuthentication(copilotAuth);
  const settings = new AISettingsService(path.join(directory, 'settings.json'), credentials, providers);
  const models = new AIModelRegistry(new JsonFile(path.join(directory, 'models.json'), parseModelCache, 'The model list'));
  const mcp = new MCPClientService(settings, consoleLogger);
  registerAiIpcHandlers({
    copilot: {
      runtime: copilotRuntime, auth: copilotAuth,
      sessions: new GitHubCopilotSessionService(copilotRuntime, copilotAuth, settings, path.join(directory, 'copilot-sessions.json')),
      publish: (event) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_EVENTS.copilotEvent, event); }
    },
    ipc: ipcMain,
    settings,
    providers,
    models,
    connections: new AIConnectionService(settings, providers, models, consoleLogger),
    turns: new AITurnService(
      settings,
      providers,
      (event) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IPC_EVENTS.aiTurn, event);
        }
      },
      consoleLogger
    ),
    conversations: new ConversationRepository(path.join(directory, 'conversations')),
    mcp,
    attachmentPicker: new ElectronAttachmentFilePicker(),
    logger: consoleLogger
  });
  let stopping = false;
  app.on('before-quit', (event) => {
    if (stopping) return;
    event.preventDefault();
    stopping = true;
    copilotAuth.close();
    // A runtime or server that does not stop must not keep the application alive, or the installer finds it still running.
    const forced = setTimeout(() => app.exit(0), 5_000);
    void Promise.all([mcp.closeAll(), copilotRuntime.close()]).finally(() => {
      clearTimeout(forced);
      app.quit();
    });
  });
}

function bootstrap(): void {
  bootstrapAi();
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
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.guibsonsoftwares.walive');
  }
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
