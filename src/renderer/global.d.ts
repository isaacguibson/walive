import type { AppAPI } from '@shared/types/api';

declare global {
  interface Window {
    /** Exposed by the preload script. The only bridge to the main process. */
    api: AppAPI;
  }
}

export {};
