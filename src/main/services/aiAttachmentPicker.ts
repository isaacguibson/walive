import { app, BrowserWindow, dialog } from 'electron';
import type { AttachmentFilePicker } from '../ipc/registerAiIpcHandlers';

const EXTENSIONS = {
  images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  documents: ['txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'log', 'svg', 'pdf']
};

/** Native chooser for files attached to an AI message. Only the chosen paths are ever read. */
export class ElectronAttachmentFilePicker implements AttachmentFilePicker {
  async pickFiles(): Promise<string[]> {
    const options: Electron.OpenDialogOptions = {
      title: 'Attach Files',
      properties: ['openFile', 'multiSelections'],
      defaultPath: app.getPath('documents'),
      filters: [
        { name: 'Supported Files', extensions: [...EXTENSIONS.images, ...EXTENSIONS.documents] },
        { name: 'Images', extensions: EXTENSIONS.images },
        { name: 'Documents and Text', extensions: EXTENSIONS.documents }
      ]
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  }
}
