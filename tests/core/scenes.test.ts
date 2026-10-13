import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { ProjectService } from '@core/project/projectService';
import type { AnimationDocument } from '@shared/types/animation';
import { makeTempDir } from '../helpers/tempDir';

const SIZE = 2;

function document(fill: number): AnimationDocument {
  const pixels = new Uint8Array(SIZE * SIZE * 4).fill(fill);
  return { width: SIZE, height: SIZE, frames: [{ id: 'frame-1', layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, pixels }] }] };
}

async function openProject(): Promise<{ projects: ProjectService; projectPath: string }> {
  const projects = new ProjectService();
  const { path: projectPath } = await projects.createProject('Scenes', await makeTempDir(), {
    width: SIZE,
    height: SIZE,
    keepAspectRatio: false
  });
  return { projects, projectPath };
}

async function reopen(projectPath: string): Promise<ProjectService> {
  const projects = new ProjectService();
  await projects.openProject(projectPath);
  return projects;
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

const layerFiles = async (projectPath: string) => (await fs.readdir(path.join(projectPath, 'drawings', 'layers'))).sort();
const exists = (target: string) => fs.stat(target).then(() => true, () => false);

describe('scene registry', () => {
  it('creates and persists "Scene 1" as the active scene of a project without scenes', async () => {
    const { projects, projectPath } = await openProject();
    const { scenes, activeSceneId } = await projects.scenes.listScenes();

    expect(scenes.map((scene) => scene.name)).toEqual(['Scene 1']);
    expect(activeSceneId).toBe(scenes[0]?.id);
    expect(await exists(path.join(projectPath, 'scenes', 'scenes.json'))).toBe(true);
    expect(await projects.scenes.loadAnimation(activeSceneId)).toBeNull();
    // Listing again, or from another session, returns the same scene.
    expect((await (await reopen(projectPath)).scenes.listScenes()).scenes[0]?.id).toBe(activeSceneId);
  });

  it('migrates the single animation of older projects into Scene 1 without losing data', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    await projects.scenes.saveAnimation(activeSceneId, document(50));

    // Recreate the older layout: one manifest in drawings/, no scene registry.
    await fs.rename(path.join(projectPath, 'scenes', activeSceneId, 'animation.json'), path.join(projectPath, 'drawings', 'animation.json'));
    await fs.rm(path.join(projectPath, 'scenes'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'scenes'));

    const migrated = await (await reopen(projectPath)).scenes.listScenes();
    expect(migrated.scenes.map((scene) => scene.name)).toEqual(['Scene 1']);
    expect(await exists(path.join(projectPath, 'drawings', 'animation.json'))).toBe(false);

    const again = await (await reopen(projectPath)).scenes.listScenes();
    expect(again).toEqual(migrated);
    const loaded = await (await reopen(projectPath)).scenes.loadAnimation(migrated.activeSceneId);
    expect(Array.from(loaded?.frames[0]?.layers[0]?.pixels ?? [])).toEqual(Array.from(document(50).frames[0]?.layers[0]?.pixels ?? []));
  });

  it('falls back to the first scene when the active scene is missing', async () => {
    const { projects, projectPath } = await openProject();
    const { scenes } = await projects.scenes.createScene('Second');
    const registryPath = path.join(projectPath, 'scenes', 'scenes.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(registryPath, JSON.stringify({ ...registry, activeSceneId: 'gone' }));

    expect((await (await reopen(projectPath)).scenes.listScenes()).activeSceneId).toBe(scenes[0]?.id);
  });

  it('rejects a damaged or invalid registry instead of overwriting it', async () => {
    const { projects, projectPath } = await openProject();
    await projects.scenes.listScenes();
    const registryPath = path.join(projectPath, 'scenes', 'scenes.json');

    for (const content of ['{ not json', '{"formatVersion":1,"scenes":[{"id":"../x","name":"A","createdAt":"2024-01-01","updatedAt":"2024-01-01"}]}']) {
      await fs.writeFile(registryPath, content);
      expect((await rejectionOf(projects.scenes.listScenes())).code).toBe('INVALID_SCENE_DATA');
      expect(await fs.readFile(registryPath, 'utf8')).toBe(content);
    }
  });

  it('requires an open project', async () => {
    const { scenes } = new ProjectService();
    expect((await rejectionOf(scenes.listScenes())).code).toBe('NO_PROJECT_OPEN');
  });
});

describe('creating scenes', () => {
  it('adds scenes in creation order with unique ids and makes the new one active', async () => {
    const { projects } = await openProject();
    await projects.scenes.listScenes();
    await projects.scenes.createScene('  Intro  ');
    const { scenes, activeSceneId } = await projects.scenes.createScene('Finale');

    expect(scenes.map((scene) => scene.name)).toEqual(['Scene 1', 'Intro', 'Finale']);
    expect(new Set(scenes.map((scene) => scene.id)).size).toBe(3);
    expect(activeSceneId).toBe(scenes[2]?.id);
  });

  it('starts new scenes empty and keeps the other scenes untouched', async () => {
    const { projects } = await openProject();
    const { activeSceneId: first } = await projects.scenes.listScenes();
    await projects.scenes.saveAnimation(first, document(10));
    const { activeSceneId: second } = await projects.scenes.createScene('Second');

    expect(await projects.scenes.loadAnimation(second)).toBeNull();
    await projects.scenes.saveAnimation(second, document(20));
    expect((await projects.scenes.loadAnimation(first))?.frames[0]?.layers[0]?.pixels?.[0]).toBe(10);
    expect((await projects.scenes.loadAnimation(second))?.frames[0]?.layers[0]?.pixels?.[0]).toBe(20);
  });

  it('rejects empty, overlong, unsafe and duplicate names (ignoring case)', async () => {
    const { projects } = await openProject();
    await projects.scenes.createScene('Intro');

    for (const name of ['', '   ', 'a'.repeat(101), 'bad\nname', 3 as unknown as string]) {
      expect((await rejectionOf(projects.scenes.createScene(name))).code).toBe('INVALID_NAME');
    }
    for (const name of ['Intro', 'iNTRO ', 'SCENE 1']) {
      expect((await rejectionOf(projects.scenes.createScene(name))).code).toBe('SCENE_NAME_CONFLICT');
    }
    expect((await projects.scenes.listScenes()).scenes).toHaveLength(2);
  });
});

describe('renaming scenes', () => {
  it('changes only the name: id, order and content are kept', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    await projects.scenes.saveAnimation(activeSceneId, document(30));
    await projects.scenes.createScene('Other');

    const { scenes } = await projects.scenes.renameScene(activeSceneId, 'Opening');
    expect(scenes.map((scene) => [scene.id, scene.name])).toEqual([[activeSceneId, 'Opening'], [scenes[1]?.id, 'Other']]);
    const reopened = await reopen(projectPath);
    expect((await reopened.scenes.listScenes()).scenes[0]?.name).toBe('Opening');
    expect((await reopened.scenes.loadAnimation(activeSceneId))?.frames).toHaveLength(1);
  });

  it('allows changing only the letter case of the own name but not taking another name', async () => {
    const { projects } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    const { scenes } = await projects.scenes.createScene('Other');

    expect((await projects.scenes.renameScene(activeSceneId, 'SCENE 1')).scenes[0]?.name).toBe('SCENE 1');
    expect((await rejectionOf(projects.scenes.renameScene(activeSceneId, 'other'))).code).toBe('SCENE_NAME_CONFLICT');
    expect((await rejectionOf(projects.scenes.renameScene(scenes[1]?.id ?? '', '  '))).code).toBe('INVALID_NAME');
    expect((await projects.scenes.listScenes()).scenes.map((scene) => scene.name)).toEqual(['SCENE 1', 'Other']);
  });

  it('rejects unknown scenes', async () => {
    const { projects } = await openProject();
    expect((await rejectionOf(projects.scenes.renameScene('missing', 'x'))).code).toBe('SCENE_NOT_FOUND');
  });
});

describe('selecting scenes', () => {
  it('persists the active scene across sessions', async () => {
    const { projects, projectPath } = await openProject();
    const { scenes } = await projects.scenes.createScene('Second');
    const [first, second] = scenes;

    expect((await projects.scenes.selectScene(first?.id ?? '')).activeSceneId).toBe(first?.id);
    expect((await (await reopen(projectPath)).scenes.listScenes()).activeSceneId).toBe(first?.id);
    expect((await projects.scenes.selectScene(second?.id ?? '')).activeSceneId).toBe(second?.id);
  });

  it('rejects unknown ids and ids that could escape the scenes directory', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    for (const id of ['missing', '../drawings', '']) {
      expect((await rejectionOf(projects.scenes.selectScene(id))).code).toBe('SCENE_NOT_FOUND');
      expect((await rejectionOf(projects.scenes.loadAnimation(id))).code).toBe('SCENE_NOT_FOUND');
      expect((await rejectionOf(projects.scenes.saveAnimation(id, document(1)))).code).toBe('SCENE_NOT_FOUND');
    }
    expect((await projects.scenes.listScenes()).activeSceneId).toBe(activeSceneId);
    expect(await exists(path.join(projectPath, 'drawings', 'animation.json'))).toBe(false);
  });
});

describe('deleting scenes', () => {
  it('never deletes the last scene', async () => {
    const { projects } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    expect((await rejectionOf(projects.scenes.deleteScene(activeSceneId))).code).toBe('LAST_SCENE');
    expect((await projects.scenes.listScenes()).scenes).toHaveLength(1);
  });

  it('activates the next scene, or the previous one when the last scene was active', async () => {
    const { projects } = await openProject();
    const { scenes: initial } = await projects.scenes.listScenes();
    await projects.scenes.createScene('B');
    const { scenes } = await projects.scenes.createScene('C');
    const [a, b, c] = scenes.map((scene) => scene.id);

    await projects.scenes.selectScene(b ?? '');
    expect((await projects.scenes.deleteScene(b ?? '')).activeSceneId).toBe(c);
    expect((await projects.scenes.deleteScene(c ?? '')).activeSceneId).toBe(a);
    expect(initial[0]?.id).toBe(a);
  });

  it('keeps the active scene when another scene is deleted', async () => {
    const { projects } = await openProject();
    const { activeSceneId: first } = await projects.scenes.listScenes();
    const { activeSceneId: second } = await projects.scenes.createScene('B');
    const result = await projects.scenes.deleteScene(first);
    expect(result.activeSceneId).toBe(second);
    expect(result.scenes.map((scene) => scene.id)).toEqual([second]);
  });

  it('removes the content of the scene and only the drawings no other scene uses', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId: first } = await projects.scenes.listScenes();
    const { activeSceneId: second } = await projects.scenes.createScene('B');
    await projects.scenes.saveAnimation(first, document(10));
    await projects.scenes.saveAnimation(second, document(10));
    expect(await layerFiles(projectPath)).toHaveLength(1);

    await projects.scenes.deleteScene(first);
    expect(await exists(path.join(projectPath, 'scenes', first))).toBe(false);
    // The drawing is still used by the other scene.
    expect(await layerFiles(projectPath)).toHaveLength(1);
    expect((await projects.scenes.loadAnimation(second))?.frames[0]?.layers[0]?.pixels?.[0]).toBe(10);

    await projects.scenes.createScene('C');
    await projects.scenes.saveAnimation(second, document(99));
    expect(await layerFiles(projectPath)).toHaveLength(1);
    expect((await rejectionOf(projects.scenes.loadAnimation(first))).code).toBe('SCENE_NOT_FOUND');
  });

  it('leaves assets, exports and other scenes untouched', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId: first } = await projects.scenes.listScenes();
    const { activeSceneId: second } = await projects.scenes.createScene('B');
    await fs.writeFile(path.join(projectPath, 'assets', 'images', 'a.png'), 'x');
    await fs.writeFile(path.join(projectPath, 'exports', 'out.txt'), 'x');
    await projects.scenes.saveAnimation(second, document(5));

    await projects.scenes.deleteScene(first);
    expect(await exists(path.join(projectPath, 'assets', 'images', 'a.png'))).toBe(true);
    expect(await exists(path.join(projectPath, 'exports', 'out.txt'))).toBe(true);
    expect((await projects.scenes.loadAnimation(second))?.frames).toHaveLength(1);
  });
});

describe('saving scene content', () => {
  it('keeps the previous content when a save is rejected', async () => {
    const { projects } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    await projects.scenes.saveAnimation(activeSceneId, document(7));
    await rejectionOf(projects.scenes.saveAnimation(activeSceneId, { width: SIZE, height: SIZE, frames: [] }));
    expect((await projects.scenes.loadAnimation(activeSceneId))?.frames[0]?.layers[0]?.pixels?.[0]).toBe(7);
  });

  it('does not delete drawings when another scene manifest is unreadable', async () => {
    const { projects, projectPath } = await openProject();
    const { activeSceneId: first } = await projects.scenes.listScenes();
    const { activeSceneId: second } = await projects.scenes.createScene('B');
    await projects.scenes.saveAnimation(first, document(10));
    await fs.writeFile(path.join(projectPath, 'scenes', first, 'animation.json'), '{ not json');

    await projects.scenes.saveAnimation(second, document(20));
    expect(await layerFiles(projectPath)).toHaveLength(2);
  });

  it('does not lose scene changes when operations overlap', async () => {
    const { projects } = await openProject();
    const { activeSceneId } = await projects.scenes.listScenes();
    await Promise.all([
      projects.scenes.saveAnimation(activeSceneId, document(1)),
      projects.scenes.renameScene(activeSceneId, 'Renamed'),
      projects.scenes.createScene('Extra')
    ]);
    expect((await projects.scenes.listScenes()).scenes.map((scene) => scene.name)).toEqual(['Renamed', 'Extra']);
  });
});
