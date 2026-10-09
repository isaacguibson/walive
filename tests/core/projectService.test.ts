import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { ProjectService } from '@core/project/projectService';
import { toDirectoryName } from '@core/project/names';
import { makeTempDir } from '../helpers/tempDir';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('Expected the promise to reject');
}

describe('ProjectService.createProject', () => {
  it('creates the full project structure', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('My Animation', location);

    expect(projectPath).toBe(path.join(location, 'My Animation'));
    for (const relative of [
      'project.json',
      'scenes',
      'assets/images',
      'assets/audio',
      'assets/video',
      'assets/fonts',
      'drawings',
      'exports',
      '.cache'
    ]) {
      expect(await exists(path.join(projectPath, relative)), relative).toBe(true);
    }
  });

  it('does not create unspecified entries', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Strict', location);
    expect((await fs.readdir(projectPath)).sort()).toEqual(
      ['.cache', 'assets', 'drawings', 'exports', 'project.json', 'scenes'].sort()
    );
    expect((await fs.readdir(path.join(projectPath, 'assets'))).sort()).toEqual(['audio', 'fonts', 'images', 'video']);
  });

  it('writes valid project.json with UTC timestamps, a UUID, and default canvas metadata', async () => {
    const location = await makeTempDir();
    const now = new Date('2026-10-06T12:00:00.000Z');
    const service = new ProjectService({ now: () => now });
    const { path: projectPath } = await service.createProject('  My Animation  ', location);

    const json = await readJson(path.join(projectPath, 'project.json'));
    expect(json).toEqual({
      formatVersion: 1,
      id: expect.stringMatching(UUID),
      name: 'My Animation',
      createdAt: '2026-10-06T12:00:00.000Z',
      updatedAt: '2026-10-06T12:00:00.000Z',
      canvas: {
        width: 1920,
        height: 1080,
        keepAspectRatio: false
      }
    });
  });

  it('persists the configured canvas and aspect ratio when supplied', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Canvas Project', location, {
      width: 1280,
      height: 720,
      keepAspectRatio: true,
      aspectRatio: { width: 16, height: 9 }
    });

    const json = await readJson(path.join(projectPath, 'project.json'));
    expect(json).toMatchObject({
      canvas: {
        width: 1280,
        height: 720,
        keepAspectRatio: true,
        aspectRatio: { width: 16, height: 9 }
      }
    });
  });

  it('generates a unique ID for every project', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    const first = await service.createProject('One', location);
    const second = await service.createProject('Two', location);
    expect(first.metadata.id).not.toBe(second.metadata.id);
  });

  it('leaves no temporary files behind', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Clean', location);
    const files = await fs.readdir(projectPath);
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('does not store absolute paths in project.json', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Portable', location);
    const text = await fs.readFile(path.join(projectPath, 'project.json'), 'utf8');
    expect(text).not.toContain(location);
  });

  it('allows creation inside an existing empty directory', async () => {
    const location = await makeTempDir();
    await fs.mkdir(path.join(location, 'Empty'));
    const { path: projectPath } = await new ProjectService().createProject('Empty', location);
    expect(await exists(path.join(projectPath, 'project.json'))).toBe(true);
  });

  it('refuses a non-empty directory and leaves its files untouched', async () => {
    const location = await makeTempDir();
    const target = path.join(location, 'Existing');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'notes.txt'), 'keep me');

    const error = await rejectionOf(new ProjectService().createProject('Existing', location));
    expect(error.code).toBe('DIRECTORY_NOT_EMPTY');
    expect(await fs.readFile(path.join(target, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await exists(path.join(target, 'project.json'))).toBe(false);
  });

  it('refuses to overwrite an existing project', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    const original = await service.createProject('Same', location);
    const error = await rejectionOf(service.createProject('Same', location));
    expect(error.code).toBe('PROJECT_ALREADY_EXISTS');
    expect(error.message).toBe('A project with this name already exists.');
    expect((await readJson(path.join(original.path, 'project.json'))).id).toBe(original.metadata.id);
  });

  it('rejects invalid names and locations', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    expect((await rejectionOf(service.createProject('   ', location))).code).toBe('INVALID_NAME');
    expect((await rejectionOf(service.createProject('x'.repeat(101), location))).code).toBe('INVALID_NAME');
    expect((await rejectionOf(service.createProject('Name', 'relative/path'))).code).toBe('INVALID_LOCATION');

    const file = path.join(location, 'a-file');
    await fs.writeFile(file, '');
    expect((await rejectionOf(service.createProject('Name', file))).code).toBe('INVALID_LOCATION');
  });

  it('creates a missing location directory', async () => {
    const location = path.join(await makeTempDir(), 'nested', 'Animation Studio');
    const { path: projectPath } = await new ProjectService().createProject('Deep', location);
    expect(await exists(path.join(projectPath, 'project.json'))).toBe(true);
  });

  it('sanitizes the directory name independently of the project name', async () => {
    const location = await makeTempDir();
    const { path: projectPath, metadata } = await new ProjectService().createProject('Cena: A/B? "ação"', location);
    expect(metadata.name).toBe('Cena: A/B? "ação"');
    expect(path.dirname(projectPath)).toBe(location);
    expect(path.basename(projectPath)).toBe('Cena- A-B- -ação-');
  });

  it('marks the created project as the current project', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    const project = await service.createProject('Current', location);
    expect(service.getCurrentProject()).toEqual(project);
  });
});

describe('toDirectoryName', () => {
  it('handles reserved and empty names', () => {
    expect(toDirectoryName('CON')).toBe('CON-project');
    expect(toDirectoryName('...')).toBe('Untitled Project');
    expect(toDirectoryName('Name. ')).toBe('Name');
  });
});

describe('ProjectService.openProject / validateProject', () => {
  it('opens a valid project', async () => {
    const location = await makeTempDir();
    const created = await new ProjectService().createProject('Openable', location);

    const service = new ProjectService();
    const opened = await service.openProject(created.path);
    expect(opened.metadata).toEqual(created.metadata);
    expect(service.getProjectMetadata()).toEqual(created.metadata);
  });

  it('rejects a directory without project.json and does not create one', async () => {
    const dir = await makeTempDir();
    const error = await rejectionOf(new ProjectService().openProject(dir));
    expect(error.code).toBe('NOT_A_PROJECT');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('rejects a missing directory as unavailable', async () => {
    const dir = path.join(await makeTempDir(), 'gone');
    expect((await rejectionOf(new ProjectService().openProject(dir))).code).toBe('PROJECT_UNAVAILABLE');
  });

  it('rejects a path that is a file', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'file.txt');
    await fs.writeFile(file, 'x');
    expect((await rejectionOf(new ProjectService().openProject(file))).code).toBe('NOT_A_PROJECT');
  });

  it('rejects malformed JSON', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'project.json'), '{ not json');
    expect((await rejectionOf(new ProjectService().openProject(dir))).code).toBe('INVALID_PROJECT_FILE');
  });

  it('rejects unsupported format versions', async () => {
    const location = await makeTempDir();
    const { path: projectPath, metadata } = await new ProjectService().createProject('Future', location);
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ ...metadata, formatVersion: 99 }));
    expect((await rejectionOf(new ProjectService().openProject(projectPath))).code).toBe('UNSUPPORTED_FORMAT_VERSION');
  });

  it.each([
    ['missing id', { id: undefined }, 'INVALID_PROJECT_ID'],
    ['invalid id', { id: 'not-a-uuid' }, 'INVALID_PROJECT_ID'],
    ['missing name', { name: undefined }, 'INVALID_PROJECT_NAME'],
    ['blank name', { name: '   ' }, 'INVALID_PROJECT_NAME'],
    ['invalid createdAt', { createdAt: 'yesterday' }, 'INVALID_PROJECT_FILE'],
    ['non-numeric version', { formatVersion: '1' }, 'INVALID_PROJECT_FILE']
  ])('detects invalid metadata: %s', async (_label, override, code) => {
    const location = await makeTempDir();
    const { path: projectPath, metadata } = await new ProjectService().createProject('Broken', location);
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ ...metadata, ...override }));

    const result = await new ProjectService().validateProject(projectPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(code);
    }
  });

  it('detects missing directories', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Incomplete', location);
    await fs.rm(path.join(projectPath, 'scenes'), { recursive: true });

    const service = new ProjectService();
    const result = await service.validateProject(projectPath);
    expect(result).toMatchObject({ valid: false, code: 'MISSING_DIRECTORIES', missingDirectories: ['scenes'] });
    expect((await rejectionOf(service.openProject(projectPath))).code).toBe('MISSING_DIRECTORIES');
  });

  it('opens a project whose .cache directory was deleted', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('NoCache', location);
    await fs.rm(path.join(projectPath, '.cache'), { recursive: true });

    const opened = await new ProjectService().openProject(projectPath);
    expect(opened.metadata.name).toBe('NoCache');
  });

  it('keeps the project ID when the directory is moved or renamed', async () => {
    const location = await makeTempDir();
    const created = await new ProjectService().createProject('Movable', location);
    const moved = path.join(location, 'Renamed Folder');
    await fs.rename(created.path, moved);

    const reopened = await new ProjectService().openProject(moved);
    expect(reopened.metadata.id).toBe(created.metadata.id);
    expect(reopened.metadata.name).toBe('Movable');
  });
});

describe('ProjectService.closeProject', () => {
  it('clears the current project', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    await service.createProject('Closable', location);
    service.closeProject();
    expect(service.getCurrentProject()).toBeNull();
    expect(() => service.getProjectMetadata()).toThrowError(AppError);
  });
});

describe('ProjectService metadata persistence', () => {
  it('saves metadata, preserving id and createdAt and updating updatedAt', async () => {
    const location = await makeTempDir();
    let now = new Date('2026-10-06T12:00:00.000Z');
    const service = new ProjectService({ now: () => now });
    const { path: projectPath, metadata: original } = await service.createProject('Original', location);

    now = new Date('2026-10-07T08:30:00.000Z');
    const saved = await service.saveProjectMetadata({ name: 'Renamed' });

    expect(saved).toEqual({
      ...original,
      name: 'Renamed',
      updatedAt: '2026-10-07T08:30:00.000Z'
    });
    expect(await readJson(path.join(projectPath, 'project.json'))).toEqual(saved);
    expect((await new ProjectService().openProject(projectPath)).metadata).toEqual(saved);
  });

  it('renames the project without renaming its directory', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    const { path: projectPath } = await service.createProject('Before', location);
    await service.renameProject('After');
    expect(service.getProjectMetadata().name).toBe('After');
    expect(await exists(projectPath)).toBe(true);
  });

  it('preserves unknown fields already present in project.json', async () => {
    const location = await makeTempDir();
    const service = new ProjectService();
    const { path: projectPath, metadata } = await service.createProject('Extras', location);
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify({ ...metadata, futureField: { a: 1 } }));

    await service.renameProject('Extras 2');
    expect((await readJson(path.join(projectPath, 'project.json')))['futureField']).toEqual({ a: 1 });
  });

  it('requires an open project and a valid name', async () => {
    const service = new ProjectService();
    expect((await rejectionOf(service.saveProjectMetadata({ name: 'x' }))).code).toBe('NO_PROJECT_OPEN');

    const location = await makeTempDir();
    await service.createProject('Valid', location);
    expect((await rejectionOf(service.renameProject(''))).code).toBe('INVALID_NAME');
  });
});

describe('ProjectService.repairProject', () => {
  it('recreates missing directories without touching existing files', async () => {
    const location = await makeTempDir();
    const { path: projectPath } = await new ProjectService().createProject('Repairable', location);
    await fs.writeFile(path.join(projectPath, 'drawings', 'sketch.txt'), 'data');
    await fs.rm(path.join(projectPath, 'scenes'), { recursive: true });
    await fs.rm(path.join(projectPath, 'assets', 'fonts'), { recursive: true });

    const service = new ProjectService();
    const created = await service.repairProject(projectPath);

    expect(created.sort()).toEqual([path.join('assets', 'fonts'), 'scenes']);
    expect(await fs.readFile(path.join(projectPath, 'drawings', 'sketch.txt'), 'utf8')).toBe('data');
    expect((await service.validateProject(projectPath)).valid).toBe(true);
  });

  it('refuses to repair a folder that is not a project', async () => {
    const dir = await makeTempDir();
    expect((await rejectionOf(new ProjectService().repairProject(dir))).code).toBe('NOT_A_PROJECT');
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
