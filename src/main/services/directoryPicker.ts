import { app, BrowserWindow, dialog } from 'electron';
import type { DirectoryPicker } from '../ipc/registerIpcHandlers';

/** Shows the native directory chooser. Only the main process may do this. */
export class ElectronDirectoryPicker implements DirectoryPicker {
  async pickDirectory(): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents')
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const [selected] = result.filePaths;
    return result.canceled || selected === undefined ? null : selected;
  }
}
