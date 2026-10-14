// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '@editor/editorSession';
import { getPixel } from '@editor/drawing/raster';
import type { CopilotEvent } from '@shared/ai/copilot';
import { AgentController } from '../../src/renderer/ai/agentController';
import { createTurnClient } from '../../src/renderer/ai/turnClient';
import { createEditorToolHost } from '../../src/renderer/ai/editorToolHost';
import { CopilotConnection } from '../../src/renderer/components/ai/CopilotConnection';
import { aiModel, aiState, createMockAiApi, createMockAssetsApi, createMockScenesApi, ok } from './helpers';

afterEach(cleanup);

const provider = { id: 'github-copilot', kind: 'copilot' as const, name: 'GitHub Copilot', credentialHint: null, manualModels: [], baseUrl: null, copilotConnected: true, oauthClientId: 'registered-client' };

describe('Copilot workspace integration', () => {
  it('releases a pending approval when the SDK task fails', async () => {
    const state = aiState([aiModel({ providerId: provider.id })], [provider]);
    state.settings.selection = { providerId: provider.id, modelId: 'gpt-4o' };
    state.settings.approval.modify = 'ask';
    const api = createMockAiApi(state);
    let listener: (event: CopilotEvent) => void = () => undefined;
    let finish!: () => void;
    api.onCopilotEvent.mockImplementation((handler) => { listener = handler; return () => undefined; });
    api.runCopilot.mockImplementation(async (request) => {
      listener({ requestId: request.requestId, kind: 'tool', call: { id: 'c1', name: 'add_frame', input: {} } });
      await new Promise<void>((resolve) => { finish = resolve; });
      return ok({ status: 'failed', error: { code: 'AI_NETWORK', message: 'The connection was lost.', retryable: false }, toolCalls: 1, iterations: 1 });
    });
    const session = new EditorSession({ width: 32, height: 32 });
    const controller = new AgentController(api, createTurnClient(api));
    await controller.load();
    controller.bindProject({ sceneId: 's1', host: createEditorToolHost({ session, projectName: 'Test', scene: { id: 's1', name: 'Intro' }, scenesApi: createMockScenesApi(), assetsApi: createMockAssetsApi() }) });
    controller.setDraftText('Add a frame');
    const running = controller.send();
    await waitFor(() => expect(controller.getSnapshot().approval).not.toBeNull());
    finish();
    await running;
    expect(controller.getSnapshot()).toMatchObject({ running: false, approval: null });
    expect(session.getSnapshot().frames).toHaveLength(1);
  });
  it('uses SDK callbacks, asks approval, edits the project and supports Undo', async () => {
    const state = aiState([aiModel({ providerId: provider.id })], [provider]);
    state.settings.selection = { providerId: provider.id, modelId: 'gpt-4o' };
    state.settings.approval.modify = 'ask';
    const api = createMockAiApi(state);
    let listener: (event: CopilotEvent) => void = () => undefined;
    api.onCopilotEvent.mockImplementation((handler) => { listener = handler; return () => undefined; });
    let resolveTool: ((content: string) => void) | undefined;
    api.respondCopilotTool.mockImplementation(async (result) => { resolveTool?.(result.content); return ok(undefined); });
    api.runCopilot.mockImplementation(async (request) => {
      const result = new Promise<string>((resolve) => { resolveTool = resolve; });
      listener({ requestId: request.requestId, kind: 'tool', call: { id: 'c1', name: 'draw_strokes', input: { strokes: [{ points: [[4, 8], [20, 8]], size: 4, color: '#ff0000' }] } } });
      expect(await result).toContain('strokesDrawn');
      listener({ requestId: request.requestId, kind: 'event', event: { type: 'assistant', message: { role: 'assistant', text: 'Line drawn.', toolCalls: [] } } });
      return ok({ status: 'completed', error: null, toolCalls: 1, iterations: 2 });
    });
    const session = new EditorSession({ width: 32, height: 32 });
    const controller = new AgentController(api, createTurnClient(api, () => controller.getSnapshot().conversation.id));
    await controller.load();
    controller.bindProject({ sceneId: 's1', host: createEditorToolHost({ session, projectName: 'Test', scene: { id: 's1', name: 'Intro' }, scenesApi: createMockScenesApi(), assetsApi: createMockAssetsApi() }) });
    controller.setDraftText('Draw a red line');
    const running = controller.send();
    await waitFor(() => expect(controller.getSnapshot().approval?.tool).toBe('draw_strokes'));
    expect(api.respondCopilotTool).not.toHaveBeenCalled();
    controller.respondToApproval(true);
    await running;
    expect(api.runTurn).not.toHaveBeenCalled();
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 10, 8)).toEqual([255, 0, 0, 255]);
    expect(controller.getSnapshot().conversation.entries.find((entry) => entry.kind === 'tool')).toMatchObject({ status: 'completed' });
    session.undo();
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 10, 8)).toEqual([0, 0, 0, 0]);
  });

  it('connects a CLI account without accepting an API key', async () => {
    const api = createMockAiApi();
    const onState = vi.fn();
    render(<CopilotConnection provider={provider} api={api} onState={onState} />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect CLI Account' }));
    await waitFor(() => expect(api.connectCopilot).toHaveBeenCalledWith(provider.id));
    expect(await screen.findByText(/Connected\. Account: user/)).toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('shows only the public device code and waits for GitHub authorization', async () => {
    const api = createMockAiApi();
    let finish!: () => void;
    api.finishCopilotLogin.mockImplementation(async () => { await new Promise<void>((resolve) => { finish = resolve; }); return ok({ state: 'connected', login: 'alice', message: 'Connected.' }); });
    render(<CopilotConnection provider={provider} api={api} onState={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Authorize on GitHub' })).toHaveAttribute('href', 'https://github.com/login/device');
    await act(async () => finish());
    expect(await screen.findByText(/Account: alice/)).toBeInTheDocument();
  });

  it('keeps GitHub sign-in enabled without a Client ID and asks for it, then saves it', async () => {
    const api = createMockAiApi();
    render(<CopilotConnection provider={{ ...provider, oauthClientId: undefined }} api={api} onState={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(api.beginCopilotLogin).not.toHaveBeenCalled();
    const input = await screen.findByLabelText('GitHub OAuth App Client ID');
    await userEvent.type(input, 'registered-client');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(api.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ id: provider.id, oauthClientId: 'registered-client' })));
    await waitFor(() => expect(api.beginCopilotLogin).toHaveBeenCalledWith(provider.id));
  });

  it('clearly separates disconnecting the app from signing out globally', async () => {
    const api = createMockAiApi();
    render(<CopilotConnection provider={provider} api={api} onState={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Copilot' }));
    expect(await screen.findByText(/Other GitHub applications remain signed in/)).toBeInTheDocument();
    expect(api.disconnectProvider).toHaveBeenCalledWith(provider.id);
  });
});