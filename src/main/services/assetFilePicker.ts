import { app, BrowserWindow, dialog } from 'electron';
import type { AssetFilePicker } from '../ipc/registerIpcHandlers';

/** Shows the native file chooser used to import assets. Only the main process may do this. */
export class ElectronAssetFilePicker implements AssetFilePicker {
  async pickFiles(): Promise<string[]> {
    const options: Electron.OpenDialogOptions = {
      title: 'Import Asset',
      properties: ['openFile', 'multiSelections'],
      defaultPath: app.getPath('pictures'),
      filters: [
        { name: 'Supported Assets', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'ttf', 'otf', 'woff', 'woff2'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
        { name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
      ]
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  }
}
