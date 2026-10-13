import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import type { DestinationPicker, DestinationRequest } from '@core/application/exportApplication';

/** Shows the native dialog that chooses where an export is written. Only the main process may do this. */
export class ElectronExportDestinationPicker implements DestinationPicker {
  async pick({ kind, suggestedName, extension, defaultDirectory }: DestinationRequest): Promise<string | null> {
    const directory = defaultDirectory !== null && existsSync(defaultDirectory) ? defaultDirectory : app.getPath('documents');
    const parent = BrowserWindow.getFocusedWindow();

    if (kind === 'directory') {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose Export Folder',
        buttonLabel: 'Export Here',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: directory
      };
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      const [selected] = result.filePaths;
      return result.canceled || selected === undefined ? null : selected;
    }

    const options: Electron.SaveDialogOptions = {
      title: 'Export',
      defaultPath: path.join(directory, suggestedName),
      filters: extension === null ? [] : [{ name: extension.toUpperCase(), extensions: [extension] }]
    };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    return result.canceled || result.filePath === '' ? null : result.filePath;
  }
}
