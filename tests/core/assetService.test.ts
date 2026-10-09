import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetService } from '@core/assets/assetService';
import { ProjectService } from '@core/project/projectService';
import { makeTempDir } from '../helpers/tempDir';

async function setup() {
  const root = await makeTempDir();
  const projects = new ProjectService();
  const project = await projects.createProject('Assets', root);
  const service = new AssetService({ getProjectPath: () => projects.getCurrentProject()?.path ?? null });
  const sources = await makeTempDir('animation-studio-sources-');
  async function source(name: string, content = 'data'): Promise<string> {
    const filePath = path.join(sources, name);
    await fs.writeFile(filePath, content);
    return filePath;
  }
  return { root, project, projects, service, source, sources };
}

describe('AssetService', () => {
  it('requires an open project', async () => {
    const service = new AssetService({ getProjectPath: () => null });
    await expect(service.listAssets()).rejects.toMatchObject({ code: 'NO_PROJECT_OPEN' });
    await expect(service.importAssets([])).rejects.toMatchObject({ code: 'NO_PROJECT_OPEN' });
  });

  it('lists the real files of the project with type and project-relative paths', async () => {
    const { project, service } = await setup();
    await fs.mkdir(path.join(project.path, 'assets', 'images'), { recursive: true });
    await fs.mkdir(path.join(project.path, 'assets', 'audio'), { recursive: true });
    await fs.writeFile(path.join(project.path, 'assets', 'images', 'b.png'), 'x');
    await fs.writeFile(path.join(project.path, 'assets', 'images', 'A.JPG'), 'x');
    await fs.writeFile(path.join(project.path, 'assets', 'audio', 'song.mp3'), 'x');
    await fs.writeFile(path.join(project.path, 'assets', 'images', '.hidden.png'), 'x');
    await fs.mkdir(path.join(project.path, 'assets', 'images', 'folder'));

    const assets = await service.listAssets();
    expect(assets.map((asset) => [asset.name, asset.type, asset.relativePath])).toEqual([
      ['A.JPG', 'image', 'assets/images/A.JPG'],
      ['b.png', 'image', 'assets/images/b.png'],
      ['song.mp3', 'audio', 'assets/audio/song.mp3']
    ]);
    expect(JSON.stringify(assets)).not.toContain(project.path);
  });

  it('returns an empty list for a project without assets', async () => {
    const { service } = await setup();
    expect(await service.listAssets()).toEqual([]);
  });

  it('imports files into the matching folder and reports unsupported files', async () => {
    const { project, service, source } = await setup();
    const result = await service.importAssets([
      await source('hero.png', 'png-bytes'),
      await source('theme.wav'),
      await source('intro.mp4'),
      await source('font.woff2'),
      await source('notes.txt'),
      await source('no-extension')
    ]);

    expect(result.imported.map((asset) => asset.relativePath).sort()).toEqual([
      'assets/audio/theme.wav',
      'assets/fonts/font.woff2',
      'assets/images/hero.png',
      'assets/video/intro.mp4'
    ]);
    expect(result.skipped.map((item) => item.name).sort()).toEqual(['no-extension', 'notes.txt']);
    expect(await fs.readFile(path.join(project.path, 'assets', 'images', 'hero.png'), 'utf8')).toBe('png-bytes');
    expect((await service.listAssets()).map((asset) => asset.name)).toHaveLength(4);
  });

  it('never overwrites existing assets when names collide', async () => {
    const { project, service, source } = await setup();
    await service.importAssets([await source('hero.png', 'first')]);
    const second = await service.importAssets([await source('hero.png', 'second')]);
    const third = await service.importAssets([await source('hero.png', 'third')]);

    expect(second.imported[0]?.name).toBe('hero (1).png');
    expect(third.imported[0]?.name).toBe('hero (2).png');
    expect(await fs.readFile(path.join(project.path, 'assets', 'images', 'hero.png'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(project.path, 'assets', 'images', 'hero (1).png'), 'utf8')).toBe('second');
  });

  it('skips sources that are folders or missing and rejects relative paths', async () => {
    const { sources, root, service } = await setup();
    const folder = path.join(sources, 'dir.png');
    await fs.mkdir(folder);
    const result = await service.importAssets([folder, path.join(root, 'missing.png')]);
    expect(result.imported).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    await expect(service.importAssets(['relative.png'])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('renames an asset keeping its extension', async () => {
    const { project, service, source } = await setup();
    const { imported } = await service.importAssets([await source('hero.png', 'bytes')]);
    const renamed = await service.renameAsset(imported[0]!.id, 'villain');

    expect(renamed).toMatchObject({ name: 'villain.png', relativePath: 'assets/images/villain.png', type: 'image' });
    expect(await fs.readFile(path.join(project.path, 'assets', 'images', 'villain.png'), 'utf8')).toBe('bytes');
    await expect(fs.access(path.join(project.path, 'assets', 'images', 'hero.png'))).rejects.toThrow();

    // Typing the extension is tolerated and not duplicated.
    expect((await service.renameAsset(renamed.id, 'final.png')).name).toBe('final.png');
    // Case-only renames are allowed.
    expect((await service.renameAsset('assets/images/final.png', 'Final')).name).toBe('Final.png');
  });

  it('rejects invalid names, collisions and unknown assets on rename', async () => {
    const { service, source } = await setup();
    const { imported } = await service.importAssets([await source('a.png'), await source('b.png')]);
    const id = imported[0]!.id;

    for (const invalid of ['', '   ', '..', '.hidden', 'a/b', 'a\\b', 'a:b', 'CON', 'trailing.', 'x'.repeat(101), 'bad\u0000name']) {
      await expect(service.renameAsset(id, invalid), JSON.stringify(invalid)).rejects.toMatchObject({
        code: 'INVALID_ASSET_NAME'
      });
    }
    await expect(service.renameAsset(id, 'B')).rejects.toMatchObject({ code: 'ASSET_NAME_CONFLICT' });
    await expect(service.renameAsset('assets/images/missing.png', 'x')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(service.renameAsset(id, 42 as unknown as string)).rejects.toMatchObject({ code: 'INVALID_ASSET_NAME' });
  });

  it('only resolves ids that exist in the asset folders (no path traversal)', async () => {
    const { root, project, service } = await setup();
    await fs.writeFile(path.join(root, 'outside.png'), 'x');
    await expect(service.deleteAsset('../../outside.png')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(service.deleteAsset(path.join(project.path, 'project.json'))).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(service.renameAsset('assets/images/../../project.json', 'x')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(fs.access(path.join(root, 'outside.png'))).resolves.toBeUndefined();
  });

  it('deletes an asset from disk', async () => {
    const { project, service, source } = await setup();
    const { imported } = await service.importAssets([await source('hero.png'), await source('theme.mp3')]);
    await service.deleteAsset(imported[0]!.id);

    expect((await service.listAssets()).map((asset) => asset.name)).toEqual(['theme.mp3']);
    await expect(fs.access(path.join(project.path, 'assets', 'images', 'hero.png'))).rejects.toThrow();
    await expect(service.deleteAsset(imported[0]!.id)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });
});
