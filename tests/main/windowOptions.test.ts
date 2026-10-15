import { describe, expect, it } from 'vitest';
import { createWindowOptions } from '../../src/main/windowOptions';

describe('createWindowOptions', () => {
  const options = createWindowOptions('/app/preload.js', '/app/icon.png');
  const { webPreferences } = options;

  it('uses the application icon for the window and taskbar', () => {
    expect(options.icon).toBe('/app/icon.png');
  });

  it('enables context isolation', () => {
    expect(webPreferences?.contextIsolation).toBe(true);
  });

  it('disables Node.js integration in the renderer', () => {
    expect(webPreferences?.nodeIntegration).toBe(false);
  });

  it('enables the renderer sandbox and web security', () => {
    expect(webPreferences?.sandbox).toBe(true);
    expect(webPreferences?.webSecurity).toBe(true);
  });

  it('uses the given preload script', () => {
    expect(webPreferences?.preload).toBe('/app/preload.js');
  });
});
