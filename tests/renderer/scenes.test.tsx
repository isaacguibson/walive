// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnimationDocument } from '@shared/types/animation';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import {
  createMockAnimationApi,
  createMockApi,
  createMockAssetsApi,
  createMockExportApi,
  createMockScenesApi,
  fail,
  metadata,
  ok,
  type MockAnimationApi,
  type MockScenesApi
} from './helpers';

const SIZE = 64;
const PROJECT = { ...metadata('Studio'), canvas: { width: SIZE, height: SIZE, keepAspectRatio: false } };

/** Stored drawings per scene id; scenes that are not listed have no animation yet. */
function documentWithFrames(count: number): AnimationDocument {
  return {
    width: SIZE,
    height: SIZE,
    frames: Array.from({ length: count }, (_, index) => ({
      id: `f${count}-${index}`,
      layers: [{ id: `l${count}-${index}`, name: 'Ink', visible: true, pixels: null }]
    }))
  };
}

interface Options {
  scenes?: string[];
  stored?: Record<string, AnimationDocument>;
  scenesApi?: MockScenesApi;
  animationApi?: MockAnimationApi;
}

async function renderScenes(options: Options = {}) {
  const user = userEvent.setup();
  const scenesApi = options.scenesApi ?? createMockScenesApi(options.scenes);
  const animationApi =
    options.animationApi ??
    createMockAnimationApi({ loadAnimation: async (sceneId) => ok(options.stored?.[sceneId] ?? null) });
  render(
    <EditorPage
      api={createMockApi()}
      animationApi={animationApi}
      assetsApi={createMockAssetsApi()}
      scenesApi={scenesApi}
      exportApi={createMockExportApi()}
      project={PROJECT}
      onClosed={vi.fn()}
    />
  );
  await screen.findByRole('button', { name: 'Save Project' });
  return { user, scenesApi, animationApi };
}

function stroke(): void {
  const target = screen.getByTestId('drawing-canvas');
  target.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: SIZE, bottom: SIZE, width: SIZE, height: SIZE, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const base = { button: 0, pointerId: 1, clientX: 10, clientY: 10 };
  fireEvent.pointerDown(target, { ...base, buttons: 1 });
  fireEvent.pointerUp(target, { ...base, buttons: 0 });
}

function frameCount(): number {
  return within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('button').length;
}

function selectorTrigger(): HTMLElement {
  return screen.getByTitle('Select Scene');
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(selectorTrigger());
  return screen.getByRole('menu', { name: 'Scenes' });
}

async function chooseAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openMenu(user);
  await user.click(screen.getByRole('menuitem', { name }));
}

afterEach(cleanup);

describe('scene selector', () => {
  it('sits in the header before the Save button and shows the active scene', async () => {
    await renderScenes({ scenes: ['Intro', 'Outro'] });
    const header = screen.getByRole('banner');
    const trigger = within(header).getByTitle('Select Scene');
    const save = within(header).getByRole('button', { name: 'Save Project' });

    expect(trigger).toHaveTextContent('Intro');
    expect(trigger.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists every scene with the active one marked and closes with Escape', async () => {
    const { user } = await renderScenes({ scenes: ['Intro', 'Outro'] });
    const menu = await openMenu(user);

    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['Intro', 'Outro']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Scenes' })).not.toBeInTheDocument();
    expect(selectorTrigger()).toBeInTheDocument();
  });

  it('loads and shows the drawings of the selected scene only', async () => {
    const { user, animationApi, scenesApi } = await renderScenes({
      scenes: ['Intro', 'Outro'],
      stored: { 'scene-1': documentWithFrames(1), 'scene-2': documentWithFrames(3) }
    });
    expect(frameCount()).toBe(1);

    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Outro' }));

    await waitFor(() => expect(frameCount()).toBe(3));
    expect(animationApi.loadAnimation).toHaveBeenLastCalledWith('scene-2');
    expect(scenesApi.selectScene).toHaveBeenCalledWith('scene-2');
    expect(selectorTrigger()).toHaveTextContent('Outro');
  });

  it('keeps the current scene and reports the error when the selected scene cannot be loaded', async () => {
    const animationApi = createMockAnimationApi({
      loadAnimation: async (sceneId) => (sceneId === 'scene-2' ? fail('Broken scene') : ok(null))
    });
    const { user, scenesApi } = await renderScenes({ scenes: ['Intro', 'Outro'], animationApi });

    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Outro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Broken scene');
    expect(selectorTrigger()).toHaveTextContent('Intro');
    expect(scenesApi.selectScene).not.toHaveBeenCalled();
  });

  it('stops playback when the scene changes', async () => {
    const { user } = await renderScenes({ scenes: ['Intro', 'Outro'] });
    await user.click(screen.getByRole('button', { name: 'Play Animation' }));
    expect(screen.getByRole('button', { name: 'Stop Animation' })).toBeInTheDocument();

    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Outro' }));
    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Outro'));

    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Intro' }));
    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Intro'));
    expect(screen.getByRole('button', { name: 'Play Animation' })).toBeInTheDocument();
  });
});

describe('creating a scene', () => {
  it('creates an empty scene and makes it active', async () => {
    const { user, scenesApi } = await renderScenes({ stored: { 'scene-1': documentWithFrames(3) } });
    expect(frameCount()).toBe(3);

    await chooseAction(user, 'New Scene…');
    await user.type(screen.getByLabelText('Scene name'), '  Finale ');
    await user.click(screen.getByRole('button', { name: 'Create Scene' }));

    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Finale'));
    expect(scenesApi.createScene).toHaveBeenCalledWith('  Finale ');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(frameCount()).toBe(1);
  });

  it('keeps the dialog and the typed name when the name is rejected', async () => {
    const { user, scenesApi } = await renderScenes();
    await chooseAction(user, 'New Scene…');

    await user.click(screen.getByRole('button', { name: 'Create Scene' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a scene name.');

    await user.type(screen.getByLabelText('Scene name'), 'scene 1');
    await user.click(screen.getByRole('button', { name: 'Create Scene' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A scene with this name already exists.');
    expect(screen.getByLabelText('Scene name')).toHaveValue('scene 1');
    expect(scenesApi.listScenes).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled without creating anything', async () => {
    const { user, scenesApi } = await renderScenes();
    await chooseAction(user, 'New Scene…');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scenesApi.createScene).not.toHaveBeenCalled();
  });
});

describe('renaming a scene', () => {
  it('renames the active scene and keeps its content', async () => {
    const { user, scenesApi } = await renderScenes({ stored: { 'scene-1': documentWithFrames(2) } });
    await chooseAction(user, 'Rename Scene…');

    const input = screen.getByLabelText('Scene name');
    expect(input).toHaveValue('Scene 1');
    await user.clear(input);
    await user.type(input, 'Opening');
    await user.click(screen.getByRole('button', { name: 'Rename Scene' }));

    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Opening'));
    expect(scenesApi.renameScene).toHaveBeenCalledWith('scene-1', 'Opening');
    expect(frameCount()).toBe(2);
  });

  it('shows validation errors inside the dialog', async () => {
    const { user } = await renderScenes({ scenes: ['Intro', 'Outro'] });
    await chooseAction(user, 'Rename Scene…');

    const input = screen.getByLabelText('Scene name');
    await user.clear(input);
    await user.type(input, 'outro');
    await user.click(screen.getByRole('button', { name: 'Rename Scene' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A scene with this name already exists.');
    expect(input).toHaveValue('outro');
  });
});

describe('deleting a scene', () => {
  it('cannot delete the only scene', async () => {
    const { user } = await renderScenes();
    await openMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Delete Scene…' })).toBeDisabled();
  });

  it('asks for confirmation and then opens the next scene', async () => {
    const { user, scenesApi } = await renderScenes({
      scenes: ['Intro', 'Outro'],
      stored: { 'scene-1': documentWithFrames(1), 'scene-2': documentWithFrames(3) }
    });

    await chooseAction(user, 'Delete Scene…');
    expect(screen.getByRole('dialog')).toHaveTextContent('“Intro”');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(scenesApi.deleteScene).not.toHaveBeenCalled();

    await chooseAction(user, 'Delete Scene…');
    await user.click(screen.getByRole('button', { name: 'Delete Scene' }));

    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Outro'));
    expect(scenesApi.deleteScene).toHaveBeenCalledWith('scene-1');
    expect(frameCount()).toBe(3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('leaving a scene with unsaved changes', () => {
  async function renderDirty() {
    const result = await renderScenes({ scenes: ['Intro', 'Outro'] });
    stroke();
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    await openMenu(result.user);
    await result.user.click(screen.getByRole('menuitemradio', { name: 'Outro' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Save changes before leaving this scene?');
    return result;
  }

  it('stays on the scene when cancelled', async () => {
    const { user, scenesApi } = await renderDirty();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(selectorTrigger()).toHaveTextContent('Intro');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(scenesApi.selectScene).not.toHaveBeenCalled();
  });

  it('saves the scene before switching', async () => {
    const { user, animationApi } = await renderDirty();
    await user.click(screen.getByRole('button', { name: 'Save and Switch' }));

    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Outro'));
    expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1);
    expect(animationApi.saveAnimation.mock.calls[0]?.[0]).toBe('scene-1');
  });

  it('stays on the scene when saving fails', async () => {
    const animationApi = createMockAnimationApi({ saveAnimation: async () => fail('Disk full') });
    const { user } = await renderScenes({ scenes: ['Intro', 'Outro'], animationApi });
    stroke();
    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Outro' }));
    await user.click(screen.getByRole('button', { name: 'Save and Switch' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(selectorTrigger()).toHaveTextContent('Intro');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });

  it('discards the changes and restores the stored scene when coming back', async () => {
    const { user, animationApi } = await renderDirty();
    await user.click(screen.getByRole('button', { name: 'Discard and Switch' }));
    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Outro'));

    await openMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Intro' }));
    await waitFor(() => expect(selectorTrigger()).toHaveTextContent('Intro'));

    expect(animationApi.saveAnimation).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });

  it('asks before creating a scene and only discards once the new scene exists', async () => {
    const { user, scenesApi } = await renderScenes();
    stroke();

    await chooseAction(user, 'New Scene…');
    await user.click(screen.getByRole('button', { name: 'Discard and Switch' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(scenesApi.createScene).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });
});

describe('loading the scenes', () => {
  it('offers a retry when the scenes cannot be listed', async () => {
    const scenesApi = createMockScenesApi();
    scenesApi.listScenes.mockResolvedValueOnce(fail('Registry unreadable'));
    const user = userEvent.setup();
    render(
      <EditorPage
        api={createMockApi()}
        animationApi={createMockAnimationApi()}
        assetsApi={createMockAssetsApi()}
        scenesApi={scenesApi}
        exportApi={createMockExportApi()}
        project={PROJECT}
        onClosed={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Registry unreadable');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('button', { name: 'Save Project' })).toBeInTheDocument();
  });
});
