import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

const NODE_MODULES = /^(node:|fs$|fs\/|path$|os$|child_process$|crypto$|electron$)/;

describe('process boundaries', () => {
  const renderer = sourceFiles(path.join(SRC, 'renderer'));

  it('renderer sources never import Node.js, Electron, main, or core modules', () => {
    expect(renderer.length).toBeGreaterThan(0);
    for (const file of renderer) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${path.relative(SRC, file)} imports ${specifier}`).not.toMatch(NODE_MODULES);
        expect(specifier, `${path.relative(SRC, file)} imports ${specifier}`).not.toMatch(/(^|\/)(main|core|preload)(\/|$)/);
      }
    }
  });

  it('renderer sources do not use require() or process', () => {
    for (const file of renderer) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(text, path.relative(SRC, file)).not.toMatch(/\brequire\(|\bprocess\.|ipcRenderer/);
    }
  });

  it('shared sources are free of Node.js and Electron imports', () => {
    for (const file of sourceFiles(path.join(SRC, 'shared'))) {
      for (const specifier of importsOf(file)) {
        expect(specifier, path.relative(SRC, file)).not.toMatch(NODE_MODULES);
      }
    }
  });

  it('the editor domain is pure: no Node.js, Electron, React, DOM or other process code', () => {
    const editorFiles = sourceFiles(path.join(SRC, 'editor'));
    expect(editorFiles.length).toBeGreaterThan(0);
    for (const file of editorFiles) {
      const relative = path.relative(SRC, file);
      for (const specifier of importsOf(file)) {
        expect(specifier, `${relative} imports ${specifier}`).not.toMatch(NODE_MODULES);
        expect(specifier, `${relative} imports ${specifier}`).not.toMatch(/^react|renderer|preload|\/main\/|\/core\//);
      }
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(text, relative).not.toMatch(/\bdocument\.(createElement|getElementById|querySelector|body)|\bwindow\.|\bprocess\.|\brequire\(/);
    }
  });

  it('core (Project Management) is independent from Electron and the UI', () => {
    for (const file of sourceFiles(path.join(SRC, 'core'))) {
      for (const specifier of importsOf(file)) {
        expect(specifier, path.relative(SRC, file)).not.toMatch(/^electron$|renderer|preload|\/main\//);
      }
    }
  });

  it('native dialogs are only used by the main process', () => {
    const users = sourceFiles(SRC).filter((file) => /showOpenDialog|showSaveDialog|\bdialog\b.*from 'electron'/.test(readFileSync(file, 'utf8')));
    expect(users.map((file) => path.relative(SRC, file))).toEqual([path.join('main', 'services', 'directoryPicker.ts')]);
  });

  it('only the main process entry creates windows, with secure preferences', () => {
    const mainText = readFileSync(path.join(SRC, 'main', 'main.ts'), 'utf8');
    const optionsText = readFileSync(path.join(SRC, 'main', 'windowOptions.ts'), 'utf8');
    expect(mainText).toContain('createWindowOptions(');
    expect(mainText).not.toMatch(/nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false/);
    expect(optionsText).not.toMatch(/nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|enableRemoteModule|webSecurity\s*:\s*false/);
  });
});
