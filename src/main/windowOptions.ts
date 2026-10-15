import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Window configuration with secure Electron defaults (HU_00002 §16).
 * Kept separate from `main.ts` so the security settings can be asserted in tests.
 */
export function createWindowOptions(preloadPath: string, iconPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Animation Studio',
    icon: iconPath,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  };
}
