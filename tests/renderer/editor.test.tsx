// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationFrameClipboard } from '@editor/animation/clipboard';
import type { AnimationDocument } from '@shared/types/animation';
import { ASSET_DRAG_MIME } from '@shared/types/assets';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import {
  createMockAnimationApi,
  createMockApi,
  createMockAssetsApi,
  fail,
  metadata,
  ok,
  type MockAnimationApi,
  type MockAssetsApi,
  type MockProjectApi
} from './helpers';

const SIZE = 64;
const FRAME_DRAG_MIME = 'application/x-walive-frame';
const PROJECT = { ...metadata('Studio'), canvas: { width: SIZE, height: SIZE, keepAspectRatio: false } };

interface Options {
  api?: MockProjectApi;
  animationApi?: MockAnimationApi;
  assetsApi?: MockAssetsApi;
}

function renderEditor(options: Options = {}) {
  const user = userEvent.setup();
  const api = options.api ?? createMockApi();
  const animationApi = options.animationApi ?? createMockAnimationApi();
  const assetsApi = options.assetsApi ?? createMockAssetsApi();
  const onClosed = vi.fn();
  render(
    <EditorPage api={api} animationApi={animationApi} assetsApi={assetsApi} project={PROJECT} onClosed={onClosed} />
  );
  return { user, api, animationApi, assetsApi, onClosed };
}

async function renderReadyEditor(options: Options = {}) {
  const result = renderEditor(options);
  await screen.findByRole('button', { name: 'Save Project' });
  return result;
}

function canvas(): HTMLCanvasElement {
  const element = screen.getByTestId('drawing-canvas') as HTMLCanvasElement;
  // jsdom does not lay elements out: report a canvas shown at 100% zoom.
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: SIZE, bottom: SIZE, width: SIZE, height: SIZE, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return element;
}

function stroke(from: [number, number], to: [number, number] = from): void {
  const target = canvas();
  const base = { button: 0, pointerId: 1 };
  fireEvent.pointerDown(target, { ...base, buttons: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(target, { ...base, buttons: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(target, { ...base, buttons: 0, clientX: to[0], clientY: to[1] });
}

function frameButtons(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('button');
}

function layerNames(): (string | undefined)[] {
  const panel = screen.getByRole('region', { name: 'Layers' });
  return within(panel)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.layer-name')?.textContent ?? undefined);
}

function savedDocument(animationApi: MockAnimationApi, call = 0): AnimationDocument {
  const document = animationApi.saveAnimation.mock.calls[call]?.[0];
  if (document === undefined) {
    throw new Error('Nothing was saved');
  }
  return document;
}

beforeEach(() => {
  applicationFrameClipboard.set(null);
});

describe('loading the editor', () => {
  it('shows a loading message and then the editor with a single blank frame', async () => {
    let finish: () => void = () => undefined;
    const animationApi = createMockAnimationApi({
      loadAnimation: () => new Promise((resolve) => (finish = () => resolve(ok(null))))
    });
    renderEditor({ animationApi });
    expect(screen.getByText('Loading project…')).toBeInTheDocument();

    finish();
    expect(await screen.findByRole('button', { name: 'Save Project' })).toBeInTheDocument();
    expect(frameButtons()).toHaveLength(1);
    expect(frameButtons()[0]).toHaveAccessibleName('Frame 1');
    expect(layerNames()).toEqual(['Layer 1']);
    expect(screen.getByRole('heading', { name: 'Studio' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });

  it('restores a stored animation without marking it as changed', async () => {
    const stored: AnimationDocument = {
      width: SIZE,
      height: SIZE,
      frames: [
        { id: 'a', layers: [{ id: 'a1', name: 'Ink', visible: true, pixels: null }] },
        { id: 'b', layers: [{ id: 'b1', name: 'Paint', visible: true, pixels: null }] }
      ]
    };
    await renderReadyEditor({ animationApi: createMockAnimationApi({ loadAnimation: async () => ok(stored) }) });
    expect(frameButtons()).toHaveLength(2);
    expect(layerNames()).toEqual(['Ink']);
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });

  it('shows an error screen when loading fails and never offers a blank editable state', async () => {
    const loadAnimation = vi
      .fn()
      .mockResolvedValueOnce(fail('The stored drawings are damaged.'))
      .mockResolvedValueOnce(ok(null));
    const { user, animationApi } = renderEditor({
      animationApi: createMockAnimationApi({ loadAnimation })
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The stored drawings are damaged.');
    expect(screen.queryByRole('button', { name: 'Save Project' })).not.toBeInTheDocument();
    expect(animationApi.saveAnimation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('button', { name: 'Save Project' })).toBeInTheDocument();
  });

  it('lets the user close the project from the error screen', async () => {
    const { user, api, onClosed } = renderEditor({
      animationApi: createMockAnimationApi({ loadAnimation: async () => fail('Broken') })
    });
    await user.click(await screen.findByRole('button', { name: 'Close Project' }));
    expect(api.closeProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });
});

describe('layout and tooltips', () => {
  it('shows the four editor areas', async () => {
    await renderReadyEditor();
    expect(screen.getByRole('navigation', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Playback controls' })).toBeInTheDocument();
    expect(screen.getByTestId('drawing-canvas')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tool Options' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Layers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Frame Management' })).toBeInTheDocument();
  });

  it('gives every button a tooltip', async () => {
    await renderReadyEditor();
    const regions = [
      screen.getByRole('navigation', { name: 'Tools' }),
      screen.getByRole('toolbar', { name: 'Playback controls' }),
      screen.getByRole('region', { name: 'Layers' }),
      screen.getByRole('region', { name: 'Frame Management' }),
      screen.getByRole('banner')
    ];
    for (const region of regions) {
      const buttons = within(region).getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button, button.outerHTML).toHaveAttribute('title', expect.stringMatching(/\S/));
      }
    }
  });

  it('uses English labels for the tools', async () => {
    await renderReadyEditor();
    for (const name of ['Brush', 'Eraser', 'Fill Tool', 'Color Picker', 'Selection Tool', 'Undo', 'Redo']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('canvas panning and sidebar panels', () => {
  it('pans the canvas with the middle mouse button and keeps the drawing state intact', async () => {
    await renderReadyEditor();
    const canvas = screen.getByTestId('drawing-canvas');
    const frame = canvas.parentElement as HTMLElement;

    fireEvent.pointerDown(canvas, { button: 1, buttons: 4, clientX: 40, clientY: 60 });
    fireEvent.pointerMove(canvas, { button: 1, buttons: 4, clientX: 90, clientY: 120 });
    expect(frame).toHaveStyle({ transform: 'translate(50px, 60px)' });

    fireEvent.pointerUp(canvas, { button: 1, buttons: 0, clientX: 90, clientY: 120 });
    expect(frame).toHaveStyle({ transform: 'translate(50px, 60px)' });
  });

  it('shows the asset manager and AI chat panels in the editor layout', async () => {
    await renderReadyEditor();
    expect(screen.getByRole('region', { name: 'Project Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import Asset' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'AI Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('resizes the AI chat panel: dragging left grows it and dragging right shrinks it', async () => {
    await renderReadyEditor();
    const separator = screen.getByRole('separator', { name: 'Resize AI chat panel' });
    const width = () => parseInt(screen.getByRole('region', { name: 'AI Assistant' }).style.width, 10);
    const inspectorWidth = () =>
      parseInt((screen.getByRole('region', { name: 'Project Assets' }).parentElement as HTMLElement).style.width, 10);
    const start = width();
    const inspectorStart = inspectorWidth();

    fireEvent.pointerDown(separator, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 450 });
    expect(width()).toBe(start + 50);
    fireEvent.pointerMove(window, { clientX: 540 });
    expect(width()).toBe(start - 40);
    fireEvent.pointerUp(window);

    expect(inspectorWidth()).toBe(inspectorStart);
  });

  it('resizes the inspector panel: dragging left grows it', async () => {
    await renderReadyEditor();
    const separator = screen.getByRole('separator', { name: 'Resize inspector panel' });
    const inspector = () => (screen.getByRole('region', { name: 'Project Assets' }).parentElement as HTMLElement).style.width;
    fireEvent.pointerDown(separator, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 470 });
    fireEvent.pointerUp(window);
    expect(inspector()).toBe('290px');
  });
});

describe('asset manager', () => {
  const IMAGE = { id: 'assets/images/hero.png', name: 'hero.png', type: 'image', relativePath: 'assets/images/hero.png', extension: 'png' } as const;
  const AUDIO = { id: 'assets/audio/theme.mp3', name: 'theme.mp3', type: 'audio', relativePath: 'assets/audio/theme.mp3', extension: 'mp3' } as const;
  const VIDEO = { id: 'assets/video/intro.mp4', name: 'intro.mp4', type: 'video', relativePath: 'assets/video/intro.mp4', extension: 'mp4' } as const;

  it('lists the real project assets with an icon per type and no thumbnails', async () => {
    const assetsApi = createMockAssetsApi({ listAssets: async () => ok([IMAGE, AUDIO, VIDEO]) });
    await renderReadyEditor({ assetsApi });

    const list = await screen.findByRole('list', { name: 'Project asset list' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.asset-name')?.textContent)).toEqual(['hero.png', 'theme.mp3', 'intro.mp4']);
    expect(rows.map((row) => row.querySelector('[data-asset-icon]')?.getAttribute('data-asset-icon'))).toEqual([
      'image',
      'music',
      'file'
    ]);
    expect(within(list).queryByRole('img')).toBeNull();
  });

  it('shows an empty state when the project has no assets', async () => {
    await renderReadyEditor();
    expect(await screen.findByText(/No assets yet/)).toBeInTheDocument();
  });

  it('imports assets through the service and refreshes the list', async () => {
    const listAssets = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValue(ok([IMAGE]));
    const assetsApi = createMockAssetsApi({
      listAssets,
      importAssets: async () => ok({ imported: [IMAGE], skipped: [{ name: 'notes.txt', reason: 'This file type is not supported.' }] })
    });
    const { user } = await renderReadyEditor({ assetsApi });
    await screen.findByText(/No assets yet/);

    await user.click(screen.getByRole('button', { name: 'Import Asset' }));

    expect(assetsApi.importAssets).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('hero.png')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Project Assets' })).getByRole('status')).toHaveTextContent('Imported 1 asset. notes.txt: This file type is not supported.');
  });

  it('shows import failures', async () => {
    const assetsApi = createMockAssetsApi({ importAssets: async () => fail('The project could not be changed.') });
    const { user } = await renderReadyEditor({ assetsApi });
    await user.click(screen.getByRole('button', { name: 'Import Asset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The project could not be changed.');
  });

  it('renames an asset using only the name without the extension', async () => {
    const renamed = { ...IMAGE, id: 'assets/images/villain.png', name: 'villain.png', relativePath: 'assets/images/villain.png' };
    const listAssets = vi.fn().mockResolvedValueOnce(ok([IMAGE])).mockResolvedValue(ok([renamed]));
    const assetsApi = createMockAssetsApi({ listAssets, renameAsset: async () => ok(renamed) });
    const { user } = await renderReadyEditor({ assetsApi });

    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Rename hero.png' }));
    const input = screen.getByRole('textbox', { name: 'New name for hero.png' });
    expect(input).toHaveValue('hero');
    await user.clear(input);
    await user.type(input, 'villain{Enter}');

    expect(assetsApi.renameAsset).toHaveBeenCalledWith(IMAGE.id, 'villain');
    expect(await screen.findByText('villain.png')).toBeInTheDocument();
  });

  it('keeps the rename field open and shows the error when the name is rejected', async () => {
    const assetsApi = createMockAssetsApi({
      listAssets: async () => ok([IMAGE]),
      renameAsset: async () => fail('An asset with this name already exists.')
    });
    const { user } = await renderReadyEditor({ assetsApi });
    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Rename hero.png' }));
    await user.type(screen.getByRole('textbox', { name: 'New name for hero.png' }), '2{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('An asset with this name already exists.');
    expect(screen.getByRole('textbox', { name: 'New name for hero.png' })).toBeInTheDocument();
  });

  it('asks for confirmation before deleting an asset', async () => {
    const listAssets = vi.fn().mockResolvedValueOnce(ok([IMAGE, AUDIO])).mockResolvedValue(ok([AUDIO]));
    const assetsApi = createMockAssetsApi({ listAssets });
    const { user } = await renderReadyEditor({ assetsApi });

    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Delete hero.png' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(assetsApi.deleteAsset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete hero.png' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(assetsApi.deleteAsset).toHaveBeenCalledWith(IMAGE.id);
    await waitFor(() => expect(screen.queryByText('hero.png')).toBeNull());
    expect(screen.getByText('theme.mp3')).toBeInTheDocument();
  });
  it('cancels the rename like Escape when clicking outside the field', async () => {
    const assetsApi = createMockAssetsApi({ listAssets: async () => ok([IMAGE]) });
    const { user } = await renderReadyEditor({ assetsApi });
    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Rename hero.png' }));
    await user.type(screen.getByRole('textbox', { name: 'New name for hero.png' }), 'xyz');

    await user.click(screen.getByTestId('canvas-viewport'));

    expect(screen.queryByRole('textbox', { name: 'New name for hero.png' })).toBeNull();
    expect(screen.getByText('hero.png')).toBeInTheDocument();
    expect(assetsApi.renameAsset).not.toHaveBeenCalled();
  });

  it('clears a rename error when the edit is cancelled by clicking outside', async () => {
    const assetsApi = createMockAssetsApi({
      listAssets: async () => ok([IMAGE]),
      renameAsset: async () => fail('An asset with this name already exists.')
    });
    const { user } = await renderReadyEditor({ assetsApi });
    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Rename hero.png' }));
    await user.type(screen.getByRole('textbox', { name: 'New name for hero.png' }), '2{Enter}');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByTestId('canvas-viewport'));

    expect(screen.queryByRole('textbox', { name: 'New name for hero.png' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not cancel a rename that is being committed', async () => {
    let finish: (value: ReturnType<typeof ok<typeof IMAGE>>) => void = () => undefined;
    const assetsApi = createMockAssetsApi({
      listAssets: async () => ok([IMAGE]),
      renameAsset: () => new Promise((resolve) => (finish = resolve as typeof finish))
    });
    const { user } = await renderReadyEditor({ assetsApi });
    await user.click(await screen.findByRole('button', { name: 'hero.png' }));
    await user.click(screen.getByRole('button', { name: 'Rename hero.png' }));
    const input = screen.getByRole('textbox', { name: 'New name for hero.png' });
    await user.type(input, '2{Enter}');
    expect(assetsApi.renameAsset).toHaveBeenCalledTimes(1);

    fireEvent.blur(input);
    expect(screen.getByRole('textbox', { name: 'New name for hero.png' })).toBeInTheDocument();

    await act(async () => finish(ok(IMAGE)));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New name for hero.png' })).toBeNull());
  });

  it('only lets image assets be dragged, from the row (not from the inner button)', async () => {
    const assetsApi = createMockAssetsApi({ listAssets: async () => ok([IMAGE, AUDIO]) });
    await renderReadyEditor({ assetsApi });
    const list = await screen.findByRole('list', { name: 'Project asset list' });
    const [imageRow, audioRow] = within(list).getAllByRole('listitem');
    expect(imageRow).toHaveAttribute('draggable', 'true');
    expect(audioRow).toHaveAttribute('draggable', 'false');

    const data = new Map<string, string>();
    fireEvent.dragStart(imageRow as HTMLElement, {
      dataTransfer: { setData: (type: string, value: string) => data.set(type, value), effectAllowed: '' }
    });
    expect(JSON.parse(data.get(ASSET_DRAG_MIME) as string)).toEqual({ assetId: IMAGE.id, assetName: 'hero.png' });
  });
});

describe('placing an image on the canvas', () => {
  const IMAGE = { id: 'assets/images/hero.png', name: 'hero.png', type: 'image', relativePath: 'assets/images/hero.png', extension: 'png' } as const;

  beforeEach(() => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 20;
      naturalHeight = 10;
      width = 20;
      height = 10;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** What a browser exposes: during dragover only `types` is readable, `getData` returns '' until the drop. */
  function transfer(phase: 'dragover' | 'drop', types: string[] = [ASSET_DRAG_MIME]) {
    return {
      types,
      dropEffect: 'none',
      getData: (type: string) =>
        phase === 'drop' && type === ASSET_DRAG_MIME ? JSON.stringify({ assetId: IMAGE.id, assetName: 'hero.png' }) : ''
    };
  }

  async function dropImage() {
    const result = await renderReadyEditor({ assetsApi: createMockAssetsApi({ listAssets: async () => ok([IMAGE]) }) });
    canvas();
    const drawImage = vi.spyOn(canvas().getContext('2d') as CanvasRenderingContext2D, 'drawImage');
    fireEvent.drop(screen.getByTestId('canvas-viewport'), { dataTransfer: transfer('drop') });
    const overlay = await screen.findByTestId('placement-overlay');
    /** Where the image was last drawn: [x, y, width, height] (the renderer's own 3-argument calls are ignored). */
    const lastPlacement = () =>
      (drawImage.mock.calls as unknown[][]).filter((call) => call.length === 5).at(-1)?.slice(1);
    return { ...result, overlay, lastPlacement };
  }

  function part(overlay: HTMLElement, handle: string): HTMLElement {
    return overlay.querySelector(`[data-handle="${handle}"]`) as HTMLElement;
  }

  it('accepts the drag from the first dragover even though the data is not readable yet', async () => {
    await renderReadyEditor();
    const viewport = screen.getByTestId('canvas-viewport');

    // fireEvent returns false when the handler called preventDefault (which is what allows the drop).
    expect(fireEvent.dragOver(viewport, { dataTransfer: transfer('dragover') })).toBe(false);
    expect(fireEvent.dragOver(viewport, { dataTransfer: transfer('dragover', ['Files']) })).toBe(true);
  });

  it('drops the image as a new layer centered on the canvas', async () => {
    const { assetsApi, lastPlacement } = await dropImage();

    expect(assetsApi.readAssetImage).toHaveBeenCalledWith(IMAGE.id);
    expect(layerNames()).toContain('hero');
    expect(lastPlacement()).toEqual([22, 27, 20, 10]);
    expect(screen.getByText(/Drag to move/)).toBeInTheDocument();
  });

  it('ignores a drop that does not carry an asset', async () => {
    const { assetsApi } = await renderReadyEditor();
    fireEvent.drop(screen.getByTestId('canvas-viewport'), { dataTransfer: transfer('drop', ['Files']) });
    expect(assetsApi.readAssetImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('placement-overlay')).toBeNull();
  });

  it('shows the error when the image cannot be read', async () => {
    const assetsApi = createMockAssetsApi({
      listAssets: async () => ok([IMAGE]),
      readAssetImage: async () => fail('The image could not be read.')
    });
    await renderReadyEditor({ assetsApi });
    fireEvent.drop(screen.getByTestId('canvas-viewport'), { dataTransfer: transfer('drop') });
    expect(await screen.findByRole('alert')).toHaveTextContent('The image could not be read.');
    expect(screen.queryByTestId('placement-overlay')).toBeNull();
  });

  it('moves the image with the pointer and snaps it to the canvas border', async () => {
    const { overlay, lastPlacement } = await dropImage();
    const body = part(overlay, 'move');

    fireEvent.pointerDown(body, { button: 0, buttons: 1, pointerId: 2, clientX: 30, clientY: 32 });
    fireEvent.pointerMove(body, { buttons: 1, pointerId: 2, clientX: 10, clientY: 32 });
    fireEvent.pointerUp(body, { button: 0, buttons: 0, pointerId: 2, clientX: 10, clientY: 32 });

    // 22 - 20 = 2 px from the left border: within the snap distance, so it lands exactly on it.
    expect(lastPlacement()).toEqual([0, 27, 20, 10]);
    expect(screen.getByTestId('placement-overlay').style.left).toBe('0%');
  });

  it('resizes from a corner keeping the proportions and snapping to the border', async () => {
    const { overlay, lastPlacement } = await dropImage();
    const corner = part(overlay, 'se');

    fireEvent.pointerDown(corner, { button: 0, buttons: 1, pointerId: 2, clientX: 42, clientY: 37 });
    fireEvent.pointerMove(corner, { buttons: 1, pointerId: 2, clientX: 62, clientY: 37 });

    // The corner would land 2 px from the right border, so it snaps there: 22 + 42 = 64.
    expect(lastPlacement()).toEqual([22, 27, 42, 21]);
  });

  it('adds a single undo step no matter how many times the image is moved', async () => {
    const { user, overlay } = await dropImage();
    const body = part(overlay, 'move');
    fireEvent.pointerDown(body, { button: 0, buttons: 1, pointerId: 2, clientX: 30, clientY: 32 });
    fireEvent.pointerMove(body, { buttons: 1, pointerId: 2, clientX: 20, clientY: 32 });
    fireEvent.pointerMove(body, { buttons: 1, pointerId: 2, clientX: 10, clientY: 40 });
    fireEvent.pointerUp(body, { button: 0, buttons: 0, pointerId: 2 });

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(layerNames()).not.toContain('hero');
    expect(screen.queryByTestId('placement-overlay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('finishes with Enter, Escape, the Done button or a click on the canvas, keeping the image', async () => {
    const finishers: Array<(user: ReturnType<typeof userEvent.setup>) => void | Promise<void>> = [
      () => void fireEvent.keyDown(document.body, { key: 'Enter' }),
      () => void fireEvent.keyDown(document.body, { key: 'Escape' }),
      (user) => user.click(screen.getByRole('button', { name: 'Done' })),
      () => void fireEvent.pointerDown(canvas(), { button: 0, buttons: 1, pointerId: 1, clientX: 5, clientY: 5 })
    ];
    for (const finish of finishers) {
      const { user, unmount } = await dropImageAndKeepRender();
      await finish(user);
      await waitFor(() => expect(screen.queryByTestId('placement-overlay')).toBeNull());
      expect(layerNames()).toContain('hero');
      unmount();
    }
  });

  it('does not draw when the click that confirms the placement lands on the canvas', async () => {
    const { user } = await dropImage();
    fireEvent.pointerDown(canvas(), { button: 0, buttons: 1, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas(), { button: 0, buttons: 0, pointerId: 1, clientX: 5, clientY: 5 });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    // The only undoable step was adding the image; a stroke would have needed a second one.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  async function dropImageAndKeepRender() {
    const result = await dropImage();
    return { user: result.user, unmount: () => cleanup() };
  }
});

describe('tools', () => {
  it('has Brush selected and exactly one tool selected at a time', async () => {
    const { user } = await renderReadyEditor();
    const tools = ['Brush', 'Eraser', 'Fill Tool', 'Color Picker', 'Selection Tool'];
    expect(screen.getByRole('button', { name: 'Brush' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of tools) {
      await user.click(screen.getByRole('button', { name }));
      for (const other of tools) {
        expect(screen.getByRole('button', { name: other })).toHaveAttribute('aria-pressed', String(other === name));
      }
    }
  });

  it('shows the options of the selected tool', async () => {
    const { user } = await renderReadyEditor();
    const options = within(screen.getByRole('region', { name: 'Tool Options' }));
    expect(options.getByLabelText('Size')).toHaveValue('12');
    expect(options.getByLabelText('Color')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(options.getByLabelText('Size')).toHaveValue('20');
    expect(options.queryByLabelText('Color')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Color Picker' }));
    expect(options.getByRole('img', { name: /Current color/ })).toBeInTheDocument();
  });

  it('validates the size and keeps the last valid value', async () => {
    await renderReadyEditor();
    const size = screen.getByLabelText('Size');
    fireEvent.change(size, { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 500.');
    fireEvent.change(size, { target: { value: '30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(size, { target: { value: 'abc' } });
    fireEvent.blur(size);
    expect(size).toHaveValue('30');
  });

  it('draws on the canvas, marks the project as changed and saves the pixels', async () => {
    const { user, animationApi } = await renderReadyEditor();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    stroke([10, 10]);

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save Project' }));
    await waitFor(() => expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1));
    const pixels = savedDocument(animationApi).frames[0]?.layers[0]?.pixels;
    expect(pixels?.[(10 * SIZE + 10) * 4 + 3]).toBe(255);
    expect(pixels?.[3]).toBe(0);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'));
  });

  it('undoes and redoes drawing from the tool panel', async () => {
    const { user } = await renderReadyEditor();
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });

  it('selects a rectangular area with the Selection Tool', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Selection Tool' }));
    expect(screen.getByTestId('selection-info')).toHaveTextContent('Drag on the canvas to select an area.');
    stroke([10, 10], [30, 20]);
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('selection-info')).toHaveTextContent('Selection: 20 × 10 px at 10, 10');
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });
});

describe('brush pressure options', () => {
  it('only shows the toggle on the Brush tool and preserves the configured size', async () => {
    const { user } = await renderReadyEditor();
    const input = screen.getByRole('textbox', { name: 'Size' });
    await user.clear(input);
    await user.type(input, '12');
    const toggle = screen.getByRole('switch', { name: 'Use Pen Pressure' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(input).toBeEnabled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('12');

    await user.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.queryByRole('switch', { name: 'Use Pen Pressure' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Brush' }));
    expect(screen.getByRole('switch', { name: 'Use Pen Pressure' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: 'Size' })).toBeDisabled();
  });

  it('shows a separate Stabilize Stroke toggle on Brush and preserves the setting when switching tools', async () => {
    const { user } = await renderReadyEditor();
    const stabilize = screen.getByRole('switch', { name: 'Stabilize Stroke' });
    expect(stabilize).toHaveAttribute('aria-checked', 'false');
    expect(stabilize).toHaveAttribute('title', 'Smooth brush strokes to reduce unintended tremors');

    await user.click(stabilize);
    expect(stabilize).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.queryByRole('switch', { name: 'Stabilize Stroke' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Brush' }));
    expect(screen.getByRole('switch', { name: 'Stabilize Stroke' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('frame management', () => {
  it('adds a frame after the active one and selects it', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Frame' }));
    expect(frameButtons()).toHaveLength(2);
    expect(frameButtons()[1]).toHaveAttribute('aria-current', 'true');
    expect(frameButtons()[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('2 frames')).toBeInTheDocument();
  });

  it('selects a frame by clicking it', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Frame' }));
    await user.click(frameButtons()[0] as HTMLElement);
    expect(frameButtons()[0]).toHaveAttribute('aria-current', 'true');
  });

  it('adds several frames through the quantity popover', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Multiple Frames' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Frames' });
    const quantity = within(dialog).getByLabelText('Quantity');
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(frameButtons()).toHaveLength(4);
    expect(frameButtons()[3]).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('dialog', { name: 'Add Frames' })).not.toBeInTheDocument();
  });

  it('rejects invalid quantities and keeps the popover open', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Multiple Frames' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Frames' });
    const quantity = within(dialog).getByLabelText('Quantity');
    for (const value of ['0', '-2', '1.5', 'abc', '']) {
      await user.clear(quantity);
      if (value !== '') {
        await user.type(quantity, value);
      }
      await user.click(within(dialog).getByRole('button', { name: 'Add' }));
      expect(within(dialog).getByRole('alert'), value).toHaveTextContent('Enter a whole number greater than 0.');
    }
    expect(frameButtons()).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add Frames' })).not.toBeInTheDocument();
  });

  it('copies, pastes, cuts, duplicates, clears and removes from the toolbar', async () => {
    const { user } = await renderReadyEditor();
    expect(screen.getByRole('button', { name: 'Paste Frame' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Copy Frame' }));
    expect(screen.getByRole('button', { name: 'Paste Frame' })).toBeEnabled();
    expect(frameButtons()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Duplicate Frame' }));
    expect(frameButtons()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Paste Frame' }));
    expect(frameButtons()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Cut Frame' }));
    expect(frameButtons()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear Frame' }));
    expect(frameButtons()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Remove Frame' }));
    expect(frameButtons()).toHaveLength(1);
  });

  it('removing the only frame leaves a new blank frame', async () => {
    const { user, animationApi } = await renderReadyEditor();
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Remove Frame' }));
    expect(frameButtons()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save Project' }));
    await waitFor(() => expect(animationApi.saveAnimation).toHaveBeenCalled());
    expect(savedDocument(animationApi).frames[0]?.layers[0]?.pixels).toBeNull();
  });

  it('offers the same actions in the context menu of the clicked frame', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Frame' }));

    fireEvent.contextMenu(frameButtons()[0] as HTMLElement, { clientX: 20, clientY: 20 });
    const menu = screen.getByRole('menu', { name: 'Frame actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy',
      'Cut',
      'Paste',
      'Duplicate',
      'Clear',
      'Remove',
      'Set as Onion Reference'
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Paste' })).toBeDisabled();
    // The right-clicked frame becomes the target.
    expect(frameButtons()[0]).toHaveAttribute('aria-current', 'true');

    await user.click(within(menu).getByRole('menuitem', { name: 'Copy' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste Frame' })).toBeEnabled();

    fireEvent.contextMenu(frameButtons()[1] as HTMLElement, { clientX: 30, clientY: 20 });
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(frameButtons()).toHaveLength(1);
  });

  it('closes the context menu with Escape', async () => {
    const { user } = await renderReadyEditor();
    fireEvent.contextMenu(frameButtons()[0] as HTMLElement, { clientX: 20, clientY: 20 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows automatic onion frames and updates the read-only overlay when selecting frames', async () => {
    const stored: AnimationDocument = {
      width: SIZE,
      height: SIZE,
      frames: ['a', 'b', 'c'].map((id, index) => ({
        id,
        layers: [{ id: `layer-${id}`, name: `Layer ${index + 1}`, visible: true, pixels: null }]
      }))
    };
    const { user } = await renderReadyEditor({ animationApi: createMockAnimationApi({ loadAnimation: async () => ok(stored) }) });
    expect(screen.queryByTestId('onion-reference-canvas')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    expect(screen.queryByTestId('onion-reference-canvas')).toBeNull();
    await user.click(frameButtons()[1] as HTMLElement);
    expect(await screen.findByTestId('onion-reference-canvas')).toHaveAttribute('data-reference-frame-id', 'a');
    await user.click(frameButtons()[2] as HTMLElement);
    expect(screen.getByTestId('onion-reference-canvas')).toHaveAttribute('data-reference-frame-id', 'b');

    // The active canvas stays independently editable; the reference is an ignored, lower canvas.
    expect(canvas()).toBeInTheDocument();
    expect(screen.getByTestId('onion-reference-canvas')).not.toHaveClass('drawing-canvas');
  });

  it('designates, highlights, persists and clears a manual onion reference', async () => {
    const stored: AnimationDocument = {
      width: SIZE,
      height: SIZE,
      frames: ['a', 'b', 'c'].map((id, index) => ({
        id,
        layers: [{ id: `layer-${id}`, name: `Layer ${index + 1}`, visible: true, pixels: null }]
      }))
    };
    const { user, animationApi } = await renderReadyEditor({ animationApi: createMockAnimationApi({ loadAnimation: async () => ok(stored) }) });
    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    await user.click(frameButtons()[2] as HTMLElement);
    fireEvent.contextMenu(frameButtons()[0] as HTMLElement, { clientX: 30, clientY: 30 });
    await user.click(screen.getByRole('menuitem', { name: 'Set as Onion Reference' }));

    expect(frameButtons()[0]).toHaveClass('is-reference');
    await user.click(frameButtons()[2] as HTMLElement);
    expect(screen.getByTestId('onion-reference-canvas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Project' }));
    await waitFor(() => expect(animationApi.saveAnimation).toHaveBeenCalled());
    expect(savedDocument(animationApi).manualReferenceFrameId).toBe('a');

    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    expect(screen.queryByTestId('onion-reference-canvas')).toBeNull();
    expect(frameButtons()[0]).toHaveClass('is-reference');

    fireEvent.contextMenu(frameButtons()[0] as HTMLElement, { clientX: 30, clientY: 30 });
    await user.click(screen.getByRole('menuitem', { name: 'Clear Onion Reference' }));
    expect(frameButtons()[0]).not.toHaveClass('is-reference');
    expect(screen.queryByTestId('onion-reference-canvas')).toBeNull();
    await user.click(frameButtons()[2] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    expect(screen.getByTestId('onion-reference-canvas')).toHaveAttribute('data-reference-frame-id', 'b');
  });

  it('does not render a manual reference frame underneath itself', async () => {
    const stored: AnimationDocument = {
      width: SIZE,
      height: SIZE,
      manualReferenceFrameId: 'a',
      frames: ['a', 'b'].map((id) => ({ id, layers: [{ id: `layer-${id}`, name: 'Layer', visible: true, pixels: null }] }))
    };
    const { user } = await renderReadyEditor({ animationApi: createMockAnimationApi({ loadAnimation: async () => ok(stored) }) });
    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    await user.click(frameButtons()[0] as HTMLElement);
    expect(screen.queryByTestId('onion-reference-canvas')).toBeNull();
    await user.click(frameButtons()[1] as HTMLElement);
    expect(screen.getByTestId('onion-reference-canvas')).toBeInTheDocument();
  });

  it('reorders frames by dragging and recomputes the automatic reference from the new order', async () => {
    const stored: AnimationDocument = {
      width: SIZE,
      height: SIZE,
      frames: ['a', 'b', 'c'].map((id) => ({ id, layers: [{ id: `layer-${id}`, name: id, visible: true, pixels: null }] }))
    };
    const { user } = await renderReadyEditor({ animationApi: createMockAnimationApi({ loadAnimation: async () => ok(stored) }) });
    await user.click(screen.getByRole('button', { name: 'Toggle Onion Reference' }));
    await user.click(frameButtons()[2] as HTMLElement);
    expect(screen.getByTestId('onion-reference-canvas')).toHaveAttribute('data-reference-frame-id', 'b');

    const items = within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('listitem');
    const data = new Map<string, string>();
    const transfer = {
      types: [FRAME_DRAG_MIME],
      effectAllowed: 'move',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    };
    fireEvent.dragStart(items[0]!, { dataTransfer: transfer });
    fireEvent.dragOver(items[1]!, { dataTransfer: transfer });
    fireEvent.drop(items[1]!, { dataTransfer: transfer });

    expect(Array.from(within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('listitem')).map((item) => item.getAttribute('data-frame-id'))).toEqual(['b', 'a', 'c']);
    expect(screen.getByTestId('onion-reference-canvas')).toHaveAttribute('data-reference-frame-id', 'a');
  });

  it('undoes frame operations', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Frame' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(frameButtons()).toHaveLength(1);
  });
});

describe('layers', () => {
  it('adds, selects and reorders layers of the active frame', async () => {
    const { user } = await renderReadyEditor();
    const panel = within(screen.getByRole('region', { name: 'Layers' }));
    expect(panel.getByRole('button', { name: 'Remove Layer' })).toBeDisabled();

    await user.click(panel.getByRole('button', { name: 'Add Layer' }));
    expect(layerNames()).toEqual(['Layer 2', 'Layer 1']);
    expect(panel.getByRole('button', { name: 'Move Layer Up' })).toBeDisabled();

    await user.click(panel.getByRole('button', { name: 'Move Layer Down' }));
    expect(layerNames()).toEqual(['Layer 1', 'Layer 2']);

    await user.click(panel.getByRole('button', { name: 'Layer 1' }));
    expect(panel.getByRole('button', { name: 'Layer 1' })).toHaveAttribute('aria-current', 'true');
    expect(panel.getByRole('button', { name: 'Layer 2' })).not.toHaveAttribute('aria-current');
  });

  it('keeps layers independent per frame', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Layer' }));
    await user.click(screen.getByRole('button', { name: 'Add Frame' }));
    expect(layerNames()).toEqual(['Layer 1']);
    await user.click(frameButtons()[0] as HTMLElement);
    expect(layerNames()).toEqual(['Layer 2', 'Layer 1']);
  });

  it('renames a layer and validates the name', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Layer name');
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Layer names must have 1 to 50 characters.');
    expect(screen.getByLabelText('Layer name')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Layer name'), 'Ink{Enter}');
    expect(layerNames()).toEqual(['Ink']);
    expect(screen.queryByLabelText('Layer name')).not.toBeInTheDocument();
  });

  it('cancels a rename with Escape', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByLabelText('Layer name'), 'X{Escape}');
    expect(layerNames()).toEqual(['Layer 1']);
  });

  it('hides a layer and refuses to draw on it', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Hide Layer' }));
    expect(screen.getByRole('button', { name: 'Show Layer' })).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();

    stroke([10, 10]);
    expect(screen.getByRole('alert')).toHaveTextContent(/hidden/i);
  });

  it('removes layers but keeps at least one', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Layer' }));
    await user.click(screen.getByRole('button', { name: 'Remove Layer' }));
    expect(layerNames()).toEqual(['Layer 1']);
    expect(screen.getByRole('button', { name: 'Remove Layer' })).toBeDisabled();
  });
});

describe('playback, FPS and zoom', () => {
  it('starts and stops playback and locks editing while it runs', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Play Animation' }));
    expect(screen.getByRole('button', { name: 'Stop Animation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Frame' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Layer' })).toBeDisabled();
    expect(screen.getByTestId('drawing-canvas').parentElement).toHaveAttribute('data-playing', 'true');

    stroke([10, 10]);
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');

    await user.click(screen.getByRole('button', { name: 'Stop Animation' }));
    expect(screen.getByRole('button', { name: 'Play Animation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Frame' })).toBeEnabled();
  });

  it('plays through the frames and stops at the end when looping is off', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Add Multiple Frames' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Add Frames' })).getByRole('button', { name: 'Add' }));
    await user.click(frameButtons()[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('FPS'), { target: { value: '1000' } });
    await user.click(screen.getByRole('button', { name: 'Loop Playback' }));
    expect(screen.getByRole('button', { name: 'Loop Playback' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Play Animation' }));
    await screen.findByRole('button', { name: 'Play Animation' }, { timeout: 3000 });
    expect(frameButtons().at(-1)).toHaveAttribute('aria-current', 'true');
  });

  it('loops by default and the loop control toggles', async () => {
    const { user } = await renderReadyEditor();
    const loop = screen.getByRole('button', { name: 'Loop Playback' });
    expect(loop).toHaveAttribute('aria-pressed', 'true');
    await user.click(loop);
    expect(loop).toHaveAttribute('aria-pressed', 'false');
  });

  it('defaults to 24 FPS and offers the presets', async () => {
    await renderReadyEditor();
    const fps = screen.getByLabelText('FPS');
    expect(fps).toHaveValue('24');
    const list = fps.getAttribute('list') ?? '';
    const options = Array.from(document.getElementById(list)?.querySelectorAll('option') ?? []).map((option) => option.value);
    expect(options).toEqual(['24', '30', '60', '120']);
  });

  it('accepts only positive whole numbers as FPS', async () => {
    await renderReadyEditor();
    const fps = screen.getByLabelText('FPS');
    for (const value of ['0', '-1', '1.5', 'abc', '']) {
      fireEvent.change(fps, { target: { value } });
      expect(screen.getByRole('alert'), value).toHaveTextContent('Enter a whole number from 1 to 1000.');
      expect(screen.getByRole('button', { name: 'Play Animation' }), value).toBeDisabled();
    }
    for (const value of ['30', '60', '120', '7']) {
      fireEvent.change(fps, { target: { value } });
      expect(screen.queryByRole('alert'), value).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play Animation' }), value).toBeEnabled();
    }
  });

  it('restores the last valid FPS when the field loses focus', async () => {
    await renderReadyEditor();
    const fps = screen.getByLabelText('FPS');
    fireEvent.change(fps, { target: { value: '60' } });
    fireEvent.change(fps, { target: { value: 'abc' } });
    fireEvent.blur(fps);
    expect(fps).toHaveValue('60');
  });

  it('changes the zoom and rejects invalid values', async () => {
    await renderReadyEditor();
    const zoom = screen.getByLabelText('Zoom');
    const frame = screen.getByTestId('drawing-canvas').parentElement;
    expect(zoom).toHaveValue('100');
    expect(frame).toHaveStyle({ width: `${SIZE}px` });

    fireEvent.change(zoom, { target: { value: '200' } });
    expect(frame).toHaveStyle({ width: `${SIZE * 2}px` });

    for (const value of ['0', '-10', 'abc', '']) {
      fireEvent.change(zoom, { target: { value } });
      expect(screen.getByRole('alert'), value).toHaveTextContent('Zoom must be greater than 0.');
      expect(frame).toHaveStyle({ width: `${SIZE * 2}px` });
    }
  });

  it('zooms with Ctrl + mouse wheel only', async () => {
    await renderReadyEditor();
    const viewport = screen.getByTestId('canvas-viewport');
    const zoom = screen.getByLabelText('Zoom');

    fireEvent.wheel(viewport, { deltaY: -200 });
    expect(zoom).toHaveValue('100');

    fireEvent.wheel(viewport, { deltaY: -200, ctrlKey: true });
    expect(Number(zoom.getAttribute('value') ?? (zoom as HTMLInputElement).value)).toBeGreaterThan(100);

    const zoomedIn = Number((zoom as HTMLInputElement).value);
    fireEvent.wheel(viewport, { deltaY: 200, ctrlKey: true });
    expect(Number((zoom as HTMLInputElement).value)).toBeLessThan(zoomedIn);
  });

  it('zoom and FPS changes do not make the project dirty', async () => {
    await renderReadyEditor();
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('FPS'), { target: { value: '30' } });
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });
});

describe('keyboard shortcuts', () => {
  it('navigates next/previous and creates an empty frame at the end with Ctrl shortcuts', async () => {
    const { user } = await renderReadyEditor();
    stroke([10, 10]);
    await user.keyboard('{Control>}w{/Control}');
    expect(frameButtons()).toHaveLength(2);
    expect(frameButtons()[1]).toHaveAttribute('aria-current', 'true');
    expect(layerNames()).toEqual(['Layer 1']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await user.keyboard('{Control>}w{/Control}');
    expect(frameButtons()).toHaveLength(3);
    expect(frameButtons()[2]).toHaveAttribute('aria-current', 'true');

    await user.keyboard('{Control>}a{/Control}');
    expect(frameButtons()[1]).toHaveAttribute('aria-current', 'true');
    const frameCount = frameButtons().length;
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('{Control>}a{/Control}');
    expect(frameButtons()[0]).toHaveAttribute('aria-current', 'true');
    expect(frameButtons()).toHaveLength(frameCount);
  });

  it('toggles playback with Space and keeps text inputs editable', async () => {
    const { user } = await renderReadyEditor();
    const play = screen.getByRole('button', { name: 'Play Animation' });
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Stop Animation' })).toBeInTheDocument();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Play Animation' })).toBeInTheDocument();

    const fps = screen.getByLabelText('FPS');
    await user.click(fps);
    await user.keyboard(' ');
    expect(fps).toHaveFocus();
    expect(play).toBeInTheDocument();
  });

  it('duplicates, undoes, copies and pastes with Ctrl shortcuts', async () => {
    const { user } = await renderReadyEditor();
    await user.keyboard('{Control>}d{/Control}');
    expect(frameButtons()).toHaveLength(2);
    await user.keyboard('{Control>}z{/Control}');
    expect(frameButtons()).toHaveLength(1);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(frameButtons()).toHaveLength(2);

    await user.keyboard('{Control>}c{/Control}');
    expect(screen.getByRole('button', { name: 'Paste Frame' })).toBeEnabled();
    await user.keyboard('{Control>}x{/Control}');
    expect(frameButtons()).toHaveLength(1);
    await user.keyboard('{Control>}v{/Control}');
    expect(frameButtons()).toHaveLength(1);
  });

  it('saves with Ctrl+S', async () => {
    const { user, animationApi } = await renderReadyEditor();
    stroke([10, 10]);
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1));
  });

  it('keeps native text editing shortcuts inside inputs', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByLabelText('FPS'));
    await user.keyboard('{Control>}d{/Control}');
    expect(frameButtons()).toHaveLength(1);
  });
});

describe('fullscreen', () => {
  let fullscreenElement: Element | null = null;

  beforeEach(() => {
    fullscreenElement = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn(async function (this: HTMLElement) {
        fullscreenElement = this;
        act(() => {
          document.dispatchEvent(new Event('fullscreenchange'));
        });
      })
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        act(() => {
          document.dispatchEvent(new Event('fullscreenchange'));
        });
      })
    });
  });

  it('enters fullscreen and leaves it with the button or Esc', async () => {
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Exit Fullscreen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Project' })).not.toBeInTheDocument();
    // The editing areas stay available.
    expect(screen.getByRole('region', { name: 'Layers' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await user.click(await screen.findByRole('button', { name: 'Exit Fullscreen' }));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(2);
  });

  it('reports when fullscreen cannot be started', async () => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn(async () => {
        throw new Error('denied');
      })
    });
    const { user } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fullscreen could not be started.');
  });
});

describe('saving and closing', () => {
  it('shows an error and stays unsaved when saving fails', async () => {
    const { user, animationApi } = await renderReadyEditor({
      animationApi: createMockAnimationApi({ saveAnimation: async () => fail('The disk is full.') })
    });
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Save Project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save drawing data. The disk is full.');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Dismiss Message' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes immediately when there are no unsaved changes', async () => {
    const { user, api, onClosed } = await renderReadyEditor();
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.closeProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('asks what to do with unsaved changes and can be cancelled', async () => {
    const { user, api, onClosed } = await renderReadyEditor();
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    const dialog = screen.getByRole('dialog', { name: 'Save changes before closing?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.closeProject).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });

  it('discards changes and closes', async () => {
    const { user, api, animationApi, onClosed } = await renderReadyEditor();
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    await user.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(animationApi.saveAnimation).not.toHaveBeenCalled();
    expect(api.closeProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('saves and closes', async () => {
    const { user, api, animationApi, onClosed } = await renderReadyEditor();
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    await user.click(screen.getByRole('button', { name: 'Save and Close' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1);
    expect(api.closeProject).toHaveBeenCalledTimes(1);
  });

  it('stays open when saving before closing fails', async () => {
    const { user, api, onClosed } = await renderReadyEditor({
      animationApi: createMockAnimationApi({ saveAnimation: async () => fail('No space left.') })
    });
    stroke([10, 10]);
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    await user.click(screen.getByRole('button', { name: 'Save and Close' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No space left.');
    expect(api.closeProject).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays in the editor when closing fails', async () => {
    const { user, onClosed } = await renderReadyEditor({
      api: createMockApi({ closeProject: async () => fail('Unable to close.') })
    });
    await user.click(screen.getByRole('button', { name: 'Close Project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to close.');
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Project' })).toBeInTheDocument();
  });
});
