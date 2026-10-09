// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationFrameClipboard } from '@editor/animation/clipboard';
import type { AnimationDocument } from '@shared/types/animation';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import {
  createMockAnimationApi,
  createMockApi,
  fail,
  metadata,
  ok,
  type MockAnimationApi,
  type MockProjectApi
} from './helpers';

const SIZE = 64;
const PROJECT = { ...metadata('Studio'), canvas: { width: SIZE, height: SIZE, keepAspectRatio: false } };

interface Options {
  api?: MockProjectApi;
  animationApi?: MockAnimationApi;
}

function renderEditor(options: Options = {}) {
  const user = userEvent.setup();
  const api = options.api ?? createMockApi();
  const animationApi = options.animationApi ?? createMockAnimationApi();
  const onClosed = vi.fn();
  render(<EditorPage api={api} animationApi={animationApi} project={PROJECT} onClosed={onClosed} />);
  return { user, api, animationApi, onClosed };
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
      'Remove'
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
