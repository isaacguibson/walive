// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnimationDocument } from '@shared/types/animation';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import {
  createMockAiApi,
  createMockAnimationApi,
  createMockApi,
  createMockAssetsApi,
  createMockExportApi,
  createMockScenesApi,
  fail,
  metadata,
  ok,
  type MockAnimationApi,
  type MockExportApi
} from './helpers';

const SIZE = 64;
const PROJECT = { ...metadata('Studio'), canvas: { width: SIZE, height: SIZE, keepAspectRatio: false } };

const stored: AnimationDocument = {
  width: SIZE,
  height: SIZE,
  frames: [0, 1, 2].map((index) => ({
    id: `f${index}`,
    layers: [{ id: `l${index}`, name: 'Ink', visible: true, pixels: null }]
  }))
};

interface Options {
  exportApi?: MockExportApi;
  animationApi?: MockAnimationApi;
}

async function renderEditor(options: Options = {}) {
  const user = userEvent.setup();
  const exportApi = options.exportApi ?? createMockExportApi();
  const animationApi = options.animationApi ?? createMockAnimationApi({ loadAnimation: async () => ok(stored) });
  render(
    <EditorPage
      api={createMockApi()}
      animationApi={animationApi}
      assetsApi={createMockAssetsApi()}
      scenesApi={createMockScenesApi(['Opening'])}
      exportApi={exportApi}
      aiApi={createMockAiApi()}
      project={PROJECT}
      onClosed={vi.fn()}
    />
  );
  await screen.findByRole('button', { name: 'Save Project' });
  return { user, exportApi, animationApi };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Export' }));
  return screen.findByRole('dialog', { name: 'Export' });
}

const choose = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string, value: string) =>
  user.selectOptions(within(dialog).getByLabelText(label), value);

async function type(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string, value: string) {
  const input = within(dialog).getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

function stroke(): void {
  const target = screen.getByTestId('drawing-canvas');
  target.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: SIZE, bottom: SIZE, width: SIZE, height: SIZE, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const base = { button: 0, pointerId: 1, clientX: 10, clientY: 10 };
  fireEvent.pointerDown(target, { ...base, buttons: 1 });
  fireEvent.pointerUp(target, { ...base, buttons: 0 });
}

afterEach(cleanup);

describe('export dialog', () => {
  it('opens from the editor header with a current-frame export selected', async () => {
    const { user } = await renderEditor();
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('title', 'Export frames or animation');
    const dialog = await openDialog(user);

    expect(within(dialog).getByLabelText('Export type')).toHaveValue('current-frame');
    expect(within(dialog).queryByLabelText('Frames')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Resolution')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Export summary')).getByText('1 of 3 in Opening')).toBeInTheDocument();
  });

  it('can be cancelled without exporting or choosing anything', async () => {
    const { user, exportApi } = await renderEditor();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openDialog(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(exportApi.chooseDestination).not.toHaveBeenCalled();
    expect(exportApi.startExport).not.toHaveBeenCalled();
  });

  it('only shows the settings that matter for each export type', async () => {
    const { user } = await renderEditor();
    const dialog = await openDialog(user);

    await choose(user, dialog, 'Export type', 'frames-zip');
    expect(within(dialog).getByLabelText('Scenes')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Frames')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Resolution')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Format')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Frame rate')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Quality')).not.toBeInTheDocument();

    await choose(user, dialog, 'Export type', 'animation');
    expect(within(dialog).getByLabelText('Format')).toHaveValue('mp4');
    expect(within(dialog).getByLabelText('Frame rate')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Quality')).toHaveValue('balanced');
    expect(within(dialog).queryByLabelText('Background')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Background color')).toBeInTheDocument();
    expect(within(dialog).getByText(/MP4 does not support transparency/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Loop Animation' })).not.toBeInTheDocument();

    await choose(user, dialog, 'Format', 'gif');
    expect(within(dialog).getByLabelText('Background')).toHaveValue('transparent');
    expect(within(dialog).queryByLabelText('Background color')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/GIF transparency is limited/)).toBeInTheDocument();
    expect(within(dialog).getByText(/limited color palette/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Loop Animation' })).toBeChecked();

    await choose(user, dialog, 'Background', 'color');
    expect(within(dialog).getByLabelText('Background color')).toBeInTheDocument();
  });

  it('offers only the formats the encoder check approved', async () => {
    const exportApi = createMockExportApi({ getCapabilities: async () => ok({ animationFormats: ['gif'] }) });
    const { user } = await renderEditor({ exportApi });
    const dialog = await openDialog(user);
    await choose(user, dialog, 'Export type', 'animation');

    await waitFor(() => expect(within(dialog).getByLabelText('Format')).toHaveValue('gif'));
    expect(within(within(dialog).getByLabelText('Format')).queryByRole('option', { name: /MP4/ })).not.toBeInTheDocument();
  });

  it('lets a custom range apply to the active scene only', async () => {
    const { user } = await renderEditor();
    const dialog = await openDialog(user);
    await choose(user, dialog, 'Export type', 'frames');
    await choose(user, dialog, 'Frames', 'custom');
    expect(within(dialog).getByLabelText('First frame')).toHaveValue(1);
    expect(within(dialog).getByLabelText('Last frame')).toHaveValue(3);

    await choose(user, dialog, 'Scenes', 'all');
    expect(within(dialog).getByLabelText('Frames')).toBeDisabled();
    expect(within(dialog).queryByLabelText('First frame')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/only available for the active scene/)).toBeInTheDocument();
  });

  it('keeps the aspect ratio while the resolution is edited', async () => {
    const { user } = await renderEditor();
    const dialog = await openDialog(user);
    await choose(user, dialog, 'Export type', 'frames');
    await choose(user, dialog, 'Resolution', 'custom');
    await type(user, dialog, 'Width (px)', '32');
    expect(within(dialog).getByLabelText('Height (px)')).toHaveValue(32);

    await user.click(within(dialog).getByRole('checkbox', { name: 'Keep Aspect Ratio' }));
    await type(user, dialog, 'Height (px)', '10');
    expect(within(dialog).getByLabelText('Width (px)')).toHaveValue(32);
  });
});

describe('starting an export', () => {
  it('asks for a destination named after the scene and frame, then exports and confirms', async () => {
    const { user, exportApi } = await renderEditor();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    const result = await screen.findByRole('dialog', { name: 'Export Complete' });
    expect(exportApi.chooseDestination).toHaveBeenCalledWith({ kind: 'current-frame', scope: 'active', format: 'mp4', suggestedName: 'Opening_frame_0001' });
    expect(exportApi.startExport).toHaveBeenCalledWith({ destinationId: 'destination-1', overwrite: false, kind: 'current-frame', frameId: 'f0' });
    expect(within(result).getByRole('status')).toHaveTextContent('1 file was exported to /exports/output');

    await user.click(within(result).getByRole('button', { name: 'Show in Folder' }));
    expect(exportApi.revealOutput).toHaveBeenCalledTimes(1);
    await user.click(within(result).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends exactly the chosen animation settings', async () => {
    const { user, exportApi } = await renderEditor();
    const dialog = await openDialog(user);
    await choose(user, dialog, 'Export type', 'animation');
    await choose(user, dialog, 'Format', 'gif');
    await choose(user, dialog, 'Frames', 'custom');
    await type(user, dialog, 'First frame', '2');
    await choose(user, dialog, 'Resolution', 'custom');
    await type(user, dialog, 'Width (px)', '32');
    await choose(user, dialog, 'Frame rate', 'custom');
    await type(user, dialog, 'FPS', '30');
    await choose(user, dialog, 'Quality', 'high');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Loop Animation' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    await screen.findByRole('dialog', { name: 'Export Complete' });
    expect(exportApi.chooseDestination).toHaveBeenCalledWith({ kind: 'animation', scope: 'active', format: 'gif', suggestedName: 'Opening' });
    expect(exportApi.startExport).toHaveBeenCalledWith({
      destinationId: 'destination-1',
      overwrite: false,
      kind: 'animation',
      format: 'gif',
      scope: 'active',
      range: { start: 2, end: 3 },
      resolution: { mode: 'custom', width: 32, height: 32 },
      fps: 30,
      background: { type: 'transparent' },
      quality: 'high',
      loop: false
    });
  });

  it('explains invalid settings before any dialog or export starts', async () => {
    const { user, exportApi } = await renderEditor();
    const dialog = await openDialog(user);
    await choose(user, dialog, 'Export type', 'frames');
    await choose(user, dialog, 'Frames', 'custom');
    await type(user, dialog, 'Last frame', '9');
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The last frame must be a number between 1 and 3.');
    expect(exportApi.chooseDestination).not.toHaveBeenCalled();
    await type(user, dialog, 'Last frame', '2');
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));
    expect(exportApi.startExport).toHaveBeenCalledWith(expect.objectContaining({ range: { start: 1, end: 2 } }));
  });

  it('does nothing when the destination dialog is cancelled', async () => {
    const exportApi = createMockExportApi({ chooseDestination: async () => ok(null) });
    const { user } = await renderEditor({ exportApi });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Export…' })).toBeEnabled());
    expect(exportApi.startExport).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows why an export failed and lets the user try again', async () => {
    const exportApi = createMockExportApi();
    exportApi.startExport.mockResolvedValueOnce(fail('There is not enough disk space.', 'EXPORT_FAILED'));
    const { user } = await renderEditor({ exportApi });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    const retry = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(retry).getByRole('alert')).toHaveTextContent('There is not enough disk space.');
    await user.click(within(retry).getByRole('button', { name: 'Export…' }));
    await screen.findByRole('dialog', { name: 'Export Complete' });
  });

  it('asks before replacing existing files and then repeats the export with approval', async () => {
    const exportApi = createMockExportApi();
    exportApi.startExport.mockResolvedValueOnce(fail('"output.png" already exists.', 'EXPORT_CONFLICT'));
    const { user } = await renderEditor({ exportApi });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Export…' }));

    const conflict = await screen.findByRole('dialog', { name: 'Replace Existing Files?' });
    expect(within(conflict).getByText('"output.png" already exists.')).toBeInTheDocument();
    await user.click(within(conflict).getByRole('button', { name: 'Replace' }));

    await screen.findByRole('dialog', { name: 'Export Complete' });
    expect(exportApi.startExport).toHaveBeenNthCalledWith(2, expect.objectContaining({ destinationId: 'destination-1', overwrite: true }));
    expect(exportApi.chooseDestination).toHaveBeenCalledTimes(1);
  });

  it('goes back to the settings when replacing is declined', async () => {
    const exportApi = createMockExportApi();
    exportApi.startExport.mockResolvedValueOnce(fail('Exists.', 'EXPORT_CONFLICT'));
    const { user } = await renderEditor({ exportApi });
    await user.click(within(await openDialog(user)).getByRole('button', { name: 'Export…' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Replace Existing Files?' })).getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('dialog', { name: 'Export' })).toBeInTheDocument();
    expect(exportApi.startExport).toHaveBeenCalledTimes(1);
  });
});

describe('export progress', () => {
  function pendingExport() {
    const exportApi = createMockExportApi();
    let finish: (result: Awaited<ReturnType<MockExportApi['startExport']>>) => void = () => undefined;
    exportApi.startExport.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    return { exportApi, finish: (result: Awaited<ReturnType<MockExportApi['startExport']>>) => finish(result) };
  }

  it('shows the real progress, the destination and a way to cancel', async () => {
    const { exportApi, finish } = pendingExport();
    const { user } = await renderEditor({ exportApi });
    await user.click(within(await openDialog(user)).getByRole('button', { name: 'Export…' }));

    const running = await screen.findByRole('dialog', { name: 'Exporting…' });
    expect(within(running).getByText('/exports/output')).toBeInTheDocument();
    expect(within(running).getByRole('status')).toHaveTextContent('Preparing the export…');

    exportApi.emitProgress({ stage: 'rendering', current: 2, total: 3, sceneName: 'Opening' });
    await waitFor(() => expect(within(running).getByRole('status')).toHaveTextContent('Rendered frame 2 of 3 of Opening'));
    expect(within(running).getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('value', '2');
    expect(within(running).getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('max', '3');

    exportApi.emitProgress({ stage: 'finalizing', current: 3, total: 3, sceneName: null });
    await waitFor(() => expect(within(running).getByRole('status')).toHaveTextContent('Finalizing'));

    finish(ok({ outputPath: '/exports/output', fileCount: 3 }));
    const done = await screen.findByRole('dialog', { name: 'Export Complete' });
    expect(within(done).getByRole('status')).toHaveTextContent('3 files were exported');
  });

  it('cannot be closed with Escape while running, but can be cancelled', async () => {
    const { exportApi, finish } = pendingExport();
    const { user } = await renderEditor({ exportApi });
    await user.click(within(await openDialog(user)).getByRole('button', { name: 'Export…' }));
    const running = await screen.findByRole('dialog', { name: 'Exporting…' });

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Exporting…' })).toBeInTheDocument();

    await user.click(within(running).getByRole('button', { name: 'Cancel Export' }));
    expect(exportApi.cancelExport).toHaveBeenCalledTimes(1);
    expect(within(running).getByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    finish(fail('Export cancelled.', 'EXPORT_CANCELLED'));
    const settings = await screen.findByRole('dialog', { name: 'Export' });
    expect(within(settings).getByRole('status')).toHaveTextContent('The export was cancelled. No output was created.');
    expect(within(settings).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('unsaved changes', () => {
  it('saves the scene before exporting it', async () => {
    const { user, exportApi, animationApi } = await renderEditor();
    stroke();
    const dialog = await openDialog(user);
    expect(within(dialog).getByText(/unsaved changes/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save and Export…' }));

    await screen.findByRole('dialog', { name: 'Export Complete' });
    expect(animationApi.saveAnimation).toHaveBeenCalledTimes(1);
    expect(animationApi.saveAnimation.mock.invocationCallOrder[0]).toBeLessThan(exportApi.startExport.mock.invocationCallOrder[0] as number);
  });

  it('does not save when the destination was not chosen', async () => {
    const exportApi = createMockExportApi({ chooseDestination: async () => ok(null) });
    const { user, animationApi } = await renderEditor({ exportApi });
    stroke();
    await user.click(within(await openDialog(user)).getByRole('button', { name: 'Save and Export…' }));
    await waitFor(() => expect(exportApi.chooseDestination).toHaveBeenCalled());
    expect(animationApi.saveAnimation).not.toHaveBeenCalled();
  });

  it('does not export stale data when saving fails', async () => {
    const animationApi = createMockAnimationApi({
      loadAnimation: async () => ok(stored),
      saveAnimation: async () => fail('Disk is read-only.')
    });
    const { user, exportApi } = await renderEditor({ animationApi });
    stroke();
    await user.click(within(await openDialog(user)).getByRole('button', { name: 'Save and Export…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('nothing was exported');
    expect(exportApi.startExport).not.toHaveBeenCalled();
  });
});
