// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutAPI } from '@shared/types/api';
import { DEFAULT_TOOL_WINDOW_LAYOUT, sanitizeToolWindowLayout, type ToolWindowLayout } from '@shared/types/layout';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import { aiState, aiModel, createMockAiApi, createMockAnimationApi, createMockApi, createMockAssetsApi, createMockExportApi, createMockScenesApi, metadata, ok } from './helpers';

const PROJECT = { ...metadata('Studio'), canvas: { width: 64, height: 64, keepAspectRatio: false } };

afterEach(cleanup);

const toolOptions = () => document.querySelector('section[aria-label="Tool Options"]') as HTMLElement;
const aiPanel = () => document.querySelector('section[aria-label="AI Assistant"]') as HTMLElement;

async function open(saved: ToolWindowLayout = DEFAULT_TOOL_WINDOW_LAYOUT) {
  const layoutApi: LayoutAPI = { getLayout: vi.fn(async () => ok(saved)), saveLayout: vi.fn(async () => ok(undefined)) };
  render(
    <EditorPage
      api={createMockApi()}
      animationApi={createMockAnimationApi()}
      assetsApi={createMockAssetsApi()}
      scenesApi={createMockScenesApi(['Opening'])}
      exportApi={createMockExportApi()}
      aiApi={createMockAiApi(aiState([aiModel()]))}
      layoutApi={layoutApi}
      project={PROJECT}
      onClosed={vi.fn()}
    />
  );
  await screen.findByRole('button', { name: 'Save Project' });
  return { user: userEvent.setup(), layoutApi };
}

describe('tool windows', () => {
  it('minimizes and restores both panels without remounting them, and saves the choice', async () => {
    const { user, layoutApi } = await open();
    const ai = aiPanel();
    await user.click(screen.getByRole('button', { name: 'Minimize AI Assistant' }));
    expect(ai).not.toBeVisible();
    expect(aiPanel()).toBe(ai);
    await user.click(screen.getByRole('button', { name: 'Minimize Tool Options' }));
    expect(toolOptions()).not.toBeVisible();
    expect(document.querySelector('section[aria-label="Layers"], [aria-label="Layers"]')).not.toBeVisible();
    await waitFor(() =>
      expect(layoutApi.saveLayout).toHaveBeenLastCalledWith({ ...DEFAULT_TOOL_WINDOW_LAYOUT, minimized: { toolOptions: true, ai: true } })
    );

    await user.click(screen.getByRole('button', { name: 'AI Assistant' }));
    expect(ai).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tool Options' }));
    expect(toolOptions()).toBeVisible();
  });

  it('restores the saved layout on startup', async () => {
    await open({ ...DEFAULT_TOOL_WINDOW_LAYOUT, minimized: { toolOptions: false, ai: true } });
    await waitFor(() => expect(aiPanel()).not.toBeVisible());
    expect(toolOptions()).toBeVisible();
  });

  it('falls back to defaults for corrupted preferences', () => {
    expect(sanitizeToolWindowLayout('nope')).toEqual(DEFAULT_TOOL_WINDOW_LAYOUT);
    expect(sanitizeToolWindowLayout({ minimized: { ai: true }, widths: { chat: 'x', inspector: 9999 } })).toEqual({
      minimized: { toolOptions: false, ai: true },
      widths: { inspector: 420, chat: 340 }
    });
  });
});
