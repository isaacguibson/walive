import { shell } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import type { OutputRevealer } from '@core/application/exportApplication';

/** Path of the bundled ffmpeg binary. Packaged apps run it from outside the asar archive. */
export function resolveFfmpegPath(): string | null {
  return ffmpegStatic === null ? null : ffmpegStatic.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

export class ElectronOutputRevealer implements OutputRevealer {
  reveal(outputPath: string): void {
    shell.showItemInFolder(outputPath);
  }
}
