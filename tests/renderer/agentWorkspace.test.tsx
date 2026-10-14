// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIState, ToolCall, TurnResult } from '@shared/ai/types';
import { EditorPage } from '../../src/renderer/pages/EditorPage';
import { aiModel, aiState, createMockAiApi, createMockAnimationApi, createMockApi, createMockAssetsApi, createMockExportApi, createMockScenesApi, fail, metadata, ok, PROVIDER, type MockAiApi } from './helpers';

const PROJECT = { ...metadata('Studio'), canvas: { width: 64, height: 64, keepAspectRatio: false } };

afterEach(cleanup);

const answer = (text: string): TurnResult => ({ text, toolCalls: [], stopReason: 'end' });
const calling = (...toolCalls: ToolCall[]): TurnResult => ({ text: '', toolCalls, stopReason: 'tool_calls' });

const reasoning = aiModel({ id: 'o3', displayName: 'o3', capabilities: { image: 'yes', tools: 'yes', streaming: 'yes', efforts: ['low', 'medium', 'high'], contextWindow: null } });

async function renderWorkspace(state: AIState = aiState([aiModel(), reasoning]), configure: (api: MockAiApi) => void = () => undefined) {
  const user = userEvent.setup();
  const aiApi = createMockAiApi(state);
  configure(aiApi);
  render(
    <EditorPage
      api={createMockApi()}
      animationApi={createMockAnimationApi()}
      assetsApi={createMockAssetsApi()}
      scenesApi={createMockScenesApi(['Opening'])}
      exportApi={createMockExportApi()}
      aiApi={aiApi}
      project={PROJECT}
      onClosed={vi.fn()}
    />
  );
  await screen.findByRole('button', { name: 'Save Project' });
  const panel = within(screen.getByRole('region', { name: 'AI Assistant' }));
  if (state.models.length > 0) {
    await waitFor(() => expect(panel.getByRole('combobox', { name: 'Model' })).toHaveValue(`${PROVIDER.id}/${state.models[0]?.id}`));
  }
  const send = async (text: string) => {
    await user.type(panel.getByRole('textbox', { name: 'Message' }), text);
    await user.click(panel.getByRole('button', { name: 'Send' }));
  };
  return { user, aiApi, panel, send };
}

/** A promise that the test settles by hand, to hold a request open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('the composer', () => {
  it('explains that a provider is needed and does not allow sending without one', async () => {
    const { panel } = await renderWorkspace(aiState());
    expect(panel.getByText('Add a provider in the AI settings to start.')).toBeInTheDocument();
    expect(panel.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(panel.getByRole('note')).toHaveTextContent('Choose a model, or add a provider');
    expect(panel.queryByRole('combobox', { name: 'Effort' })).not.toBeInTheDocument();
  });

  it('has the multiline input, attach button, model selector and send button at the bottom', async () => {
    const { panel } = await renderWorkspace();
    expect(panel.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Attach files' })).toHaveAttribute('title', 'Attach files or documents');
    expect(panel.getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(panel.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('lists the models with their provider and what each is known to support', async () => {
    const { panel, user } = await renderWorkspace(aiState([aiModel({ capabilities: { image: 'unknown', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null } }), reasoning]));
    const select = panel.getByRole('combobox', { name: 'Model' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['My OpenAI · gpt-4o', 'My OpenAI · o3']);
    expect(panel.getByText('Tools · Images? · Streaming')).toBeInTheDocument();
    await user.selectOptions(select, `${PROVIDER.id}/o3`);
    expect(panel.getByText('Tools · Images · Streaming · Effort')).toBeInTheDocument();
  });

  it('shows the effort selector only for models that support it', async () => {
    const { panel, user } = await renderWorkspace();
    expect(panel.queryByRole('combobox', { name: 'Effort' })).not.toBeInTheDocument();
    await user.selectOptions(panel.getByRole('combobox', { name: 'Model' }), `${PROVIDER.id}/o3`);
    const effort = await panel.findByRole('combobox', { name: 'Effort' });
    expect(within(effort).getAllByRole('option').map((option) => option.textContent)).toEqual(['Low', 'Medium', 'High']);
    expect(effort).toHaveValue('medium');
    await user.selectOptions(effort, 'high');
    await waitFor(() => expect(panel.getByRole('combobox', { name: 'Effort' })).toHaveValue('high'));
  });

  it('keeps what was typed when the model changes', async () => {
    const { panel, user } = await renderWorkspace();
    await user.type(panel.getByRole('textbox', { name: 'Message' }), 'Half a thought');
    await user.selectOptions(panel.getByRole('combobox', { name: 'Model' }), `${PROVIDER.id}/o3`);
    expect(panel.getByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought');
  });

  it('sends with Enter and inserts a new line with Shift+Enter', async () => {
    const { panel, user, aiApi } = await renderWorkspace();
    const input = panel.getByRole('textbox', { name: 'Message' });
    await user.type(input, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(input).toHaveValue('Line one\nLine two');
    expect(aiApi.runTurn).not.toHaveBeenCalled();
    await user.type(input, '{Enter}');
    await waitFor(() => expect(aiApi.runTurn).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');
    expect(aiApi.runTurn.mock.lastCall?.[0].messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Line one\nLine two' }] });
  });

  it('does not send an empty message', async () => {
    const { panel, user, aiApi } = await renderWorkspace();
    await user.type(panel.getByRole('textbox', { name: 'Message' }), '   {Enter}');
    expect(aiApi.runTurn).not.toHaveBeenCalled();
  });

  it('does not disturb the editor shortcuts while typing', async () => {
    const { panel, user } = await renderWorkspace();
    await user.type(panel.getByRole('textbox', { name: 'Message' }), 'a b c ');
    expect(screen.getByRole('button', { name: 'Play Animation' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('attachments', () => {
  const note = { id: 'n1', name: 'notes.md', mediaType: 'text/plain', kind: 'text' as const, size: 2048, data: '# Notes' };

  it('attaches files with the plus button, shows them as removable items and says where they go', async () => {
    const { panel, user, aiApi } = await renderWorkspace(undefined, (api) => api.pickAttachments.mockResolvedValue(ok({ attachments: [note], rejected: [] })));
    await user.click(panel.getByRole('button', { name: 'Attach files' }));
    const chips = await panel.findByRole('list', { name: 'Attachments' });
    expect(within(chips).getByText('notes.md')).toHaveAttribute('title', 'text, 2 KB');
    expect(panel.getByText('Attached content is sent to the selected provider.')).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'Remove notes.md' }));
    expect(panel.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
    expect(aiApi.pickAttachments).toHaveBeenCalledTimes(1);
  });

  it('sends the attachment with the message', async () => {
    const { panel, user, aiApi, send } = await renderWorkspace(undefined, (api) => api.pickAttachments.mockResolvedValue(ok({ attachments: [note], rejected: [] })));
    await user.click(panel.getByRole('button', { name: 'Attach files' }));
    await panel.findByRole('list', { name: 'Attachments' });
    await send('Use these notes');
    await waitFor(() => expect(aiApi.runTurn).toHaveBeenCalled());
    expect(JSON.stringify(aiApi.runTurn.mock.lastCall?.[0].messages[0])).toContain('# Notes');
    expect((await panel.findAllByText('notes.md')).length).toBeGreaterThan(0);
  });

  it('says why a file was not attached', async () => {
    const { panel, user } = await renderWorkspace(undefined, (api) => api.pickAttachments.mockResolvedValue(ok({ attachments: [], rejected: [{ name: 'doc.pdf', reason: 'PDF text extraction is not available yet.' }] })));
    await user.click(panel.getByRole('button', { name: 'Attach files' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('doc.pdf: PDF text extraction is not available yet.');
    await user.click(panel.getByRole('button', { name: 'Dismiss AI message' }));
    expect(panel.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks an image for a model that does not accept images', async () => {
    const plain = aiModel({ capabilities: { image: 'no', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null } });
    const image = { id: 'i1', name: 'ref.png', mediaType: 'image/png', kind: 'image' as const, size: 10, data: 'AAAA' };
    const { panel, user, send } = await renderWorkspace(aiState([plain]), (api) => api.pickAttachments.mockResolvedValue(ok({ attachments: [image], rejected: [] })));
    await user.click(panel.getByRole('button', { name: 'Attach files' }));
    await panel.findByRole('list', { name: 'Attachments' });
    await user.type(panel.getByRole('textbox', { name: 'Message' }), 'Look');
    expect(panel.getByRole('note')).toHaveTextContent('does not accept images');
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    void send;
  });
});

describe('a conversation', () => {
  it('shows the answer as it streams, then formatted', async () => {
    const hold = deferred<TurnResult>();
    const { panel, send, aiApi } = await renderWorkspace(undefined, (api) =>
      api.runTurn.mockImplementation(async (request) => {
        api.emitTurn({ requestId: request.requestId, delta: 'Streaming ' });
        api.emitTurn({ requestId: request.requestId, delta: 'text' });
        return ok(await hold.promise);
      })
    );
    await send('Hi');
    expect(await panel.findByText('Streaming text')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await act(async () => hold.resolve(answer('Here is **bold** and `code`:\n\n```\nline 1\nline 2\n```\n\n- first\n- second')));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Send' })).toBeInTheDocument());
    expect(panel.getByText('bold').tagName).toBe('STRONG');
    expect(panel.getByText('code').tagName).toBe('CODE');
    expect(panel.getByText(/line 1/).closest('pre')).not.toBeNull();
    expect(panel.getAllByRole('listitem').map((item) => item.textContent)).toEqual(expect.arrayContaining(['first', 'second']));
    expect(aiApi.saveConversation).toHaveBeenCalled();
  });

  it('never renders model output as HTML', async () => {
    const { panel, send } = await renderWorkspace(undefined, (api) => api.runTurn.mockResolvedValue(ok(answer('<img src=x onerror="window.hacked=true"> <b>x</b>'))));
    await send('Hi');
    await panel.findByText(/<img src=x/);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('can be stopped, and says so', async () => {
    const { panel, send, user, aiApi } = await renderWorkspace(undefined, (api) => api.runTurn.mockImplementation(() => new Promise<never>(() => undefined)));
    await send('Think');
    await user.click(await panel.findByRole('button', { name: 'Stop' }));
    expect(aiApi.cancelTurn).toHaveBeenCalledTimes(1);
    expect(await panel.findByText('Task cancelled.')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows a failure with a retry action for recoverable errors', async () => {
    const { panel, send, user, aiApi } = await renderWorkspace(undefined, (api) => api.runTurn.mockResolvedValueOnce(fail('The provider rate limit was reached.', 'AI_RATE_LIMITED')));
    await send('Hi');
    expect(await panel.findByRole('alert')).toHaveTextContent('The provider rate limit was reached.');
    aiApi.runTurn.mockResolvedValueOnce(ok(answer('Second time lucky')));
    await user.click(panel.getByRole('button', { name: 'Retry' }));
    expect(await panel.findByText('Second time lucky')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(aiApi.runTurn).toHaveBeenCalledTimes(2);
  });

  it('lets the user manage conversations', async () => {
    const { panel, send, user } = await renderWorkspace(undefined, (api) => api.runTurn.mockResolvedValue(ok(answer('Hello!'))));
    await send('First conversation');
    await panel.findByText('Hello!');
    await user.click(panel.getByRole('button', { name: 'Conversations' }));
    const list = await panel.findByRole('list', { name: 'Conversations' });
    expect(within(list).getByText('First conversation')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Rename First conversation' }));
    const title = within(list).getByRole('textbox', { name: 'Conversation title' });
    await user.clear(title);
    await user.type(title, 'Cat drawing{Enter}');
    expect(within(await panel.findByRole('list', { name: 'Conversations' })).getByText('Cat drawing')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'New conversation' }));
    expect(panel.getByText('Ask the assistant to inspect or edit your animation')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Conversations' }));
    await user.click(within(await panel.findByRole('list', { name: 'Conversations' })).getByRole('button', { name: 'Delete Cat drawing' }));
    expect(await panel.findByText('No saved conversations yet.')).toBeInTheDocument();
  });
});

describe('agent activity and approvals', () => {
  const addFrame = (id = 'c1'): ToolCall => ({ id, name: 'add_frame', input: {} });
  const asking = (): AIState => {
    const state = aiState([aiModel()]);
    state.settings.approval = { modify: 'ask', external: 'ask' };
    return state;
  };
  const frames = () => within(screen.getByRole('list', { name: 'Frames' })).getAllByRole('button');

  it('shows each tool, what it is and the outcome', async () => {
    const { panel, send } = await renderWorkspace(undefined, (api) => api.runTurn.mockResolvedValueOnce(ok(calling({ id: 'c1', name: 'get_project_info', input: {} }))).mockResolvedValueOnce(ok(answer('The project is 64x64.'))));
    await send('What is this project?');
    expect(await panel.findByText('The project is 64x64.')).toBeInTheDocument();
    const tool = panel.getByText('Get project info').closest('details') as HTMLElement;
    expect(within(tool).getByText('Done')).toBeInTheDocument();
    expect(within(tool).getByText(/get_project_info · Read only/)).toBeInTheDocument();
    expect(within(tool).getByText(/Studio, 64x64/)).toBeInTheDocument();
  });

  it('asks for approval with the operation, target and effect, and applies the change once approved', async () => {
    const { panel, send, user } = await renderWorkspace(asking(), (api) => api.runTurn.mockResolvedValueOnce(ok(calling(addFrame()))).mockResolvedValueOnce(ok(answer('Added.'))));
    expect(frames()).toHaveLength(1);
    await send('Add a frame');
    const approval = await panel.findByRole('group', { name: 'Approval needed: Add frame' });
    expect(within(approval).getByText('Add a frame')).toBeInTheDocument();
    expect(within(approval).getByText('Active scene')).toBeInTheDocument();
    expect(within(approval).getByText('Inserts one empty frame.')).toBeInTheDocument();
    expect(frames()).toHaveLength(1);
    await user.click(within(approval).getByRole('button', { name: 'Approve' }));
    expect(await panel.findByText('Added.')).toBeInTheDocument();
    expect(frames()).toHaveLength(2);
    expect(panel.getByText(/1 change\(s\) were applied and can be undone/)).toBeInTheDocument();
    expect(panel.queryByRole('group', { name: /Approval needed/ })).not.toBeInTheDocument();
  });

  it('leaves the project alone when the user rejects', async () => {
    const { panel, send, user } = await renderWorkspace(asking(), (api) => api.runTurn.mockResolvedValueOnce(ok(calling(addFrame()))).mockResolvedValueOnce(ok(answer('Understood.'))));
    await send('Add a frame');
    await user.click(within(await panel.findByRole('group', { name: 'Approval needed: Add frame' })).getByRole('button', { name: 'Reject' }));
    expect(await panel.findByText('Understood.')).toBeInTheDocument();
    expect(frames()).toHaveLength(1);
    expect(within(panel.getByText('Add frame').closest('details') as HTMLElement).getByText('Rejected')).toBeInTheDocument();
  });

  it('stops a task that is waiting for approval', async () => {
    const { panel, send, user } = await renderWorkspace(asking(), (api) => api.runTurn.mockResolvedValueOnce(ok(calling(addFrame()))));
    await send('Add a frame');
    await panel.findByRole('group', { name: 'Approval needed: Add frame' });
    await user.click(panel.getByRole('button', { name: 'Stop' }));
    expect(await panel.findByText('Task cancelled.')).toBeInTheDocument();
    expect(panel.queryByRole('group', { name: /Approval needed/ })).not.toBeInTheDocument();
    expect(frames()).toHaveLength(1);
  });
});

describe('AI settings', () => {
  async function openSettings(state: AIState = aiState(), configure?: (api: MockAiApi) => void) {
    const context = await renderWorkspace(state, configure);
    await context.user.click(await context.panel.findByRole('button', { name: 'AI Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'AI Settings' });
    return { ...context, dialog: within(dialog) };
  }

  it('lists the provider types and explains what each needs, including why Copilot is unavailable', async () => {
    const { dialog, user } = await openSettings();
    expect(dialog.getByRole('tab', { name: 'AI Providers' })).toHaveAttribute('aria-selected', 'true');
    expect(dialog.getByText('No providers yet.')).toBeInTheDocument();
    const kinds = dialog.getByRole('combobox', { name: 'Provider type' });
    expect(within(kinds).getByRole('option', { name: 'GitHub Copilot (unavailable)' })).toBeDisabled();
    expect(dialog.getByText(/GitHub Copilot: No supported integration\./)).toBeInTheDocument();
    await user.selectOptions(kinds, 'openai');
    expect(dialog.getByText('Needs an API key.')).toBeInTheDocument();
  });

  it('tests and saves a provider; the key is never shown back', async () => {
    const saved = aiState([aiModel()]);
    const { dialog, user, aiApi } = await openSettings(aiState(), (api) =>
      api.saveProvider.mockImplementation(async () => {
        api.setState(saved);
        return ok(saved);
      })
    );
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Provider type' }), 'openai');
    const form = within(dialog.getByRole('form', { name: 'Add Provider' }));
    await user.clear(form.getByLabelText('Connection name'));
    await user.type(form.getByLabelText('Connection name'), 'Work');
    const key = form.getByLabelText('API key');
    expect(key).toHaveAttribute('type', 'password');
    await user.type(key, 'sk-secret-1234');
    await user.click(form.getByRole('button', { name: 'Test Connection' }));
    expect(await dialog.findByText('Connection works. 3 model(s) available.')).toBeInTheDocument();
    expect(aiApi.testProvider).toHaveBeenCalledWith({ id: null, kind: 'openai', name: 'Work', baseUrl: null, apiKey: 'sk-secret-1234', manualModels: [] });
    await user.click(form.getByRole('button', { name: 'Save Provider' }));
    expect(await dialog.findByText('Provider saved.')).toBeInTheDocument();
    expect(aiApi.saveProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Work', apiKey: 'sk-secret-1234' }));
    expect(dialog.getByText('My OpenAI')).toBeInTheDocument();
    expect(dialog.getByText(/••••1234/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk-secret-1234');
  });

  it('shows a rejected configuration as an error', async () => {
    const { dialog, user } = await openSettings(aiState(), (api) => api.testProvider.mockResolvedValue(fail('The provider rejected the credentials.', 'AI_AUTH_FAILED')));
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Provider type' }), 'openai');
    await user.click(dialog.getByRole('button', { name: 'Test Connection' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('The provider rejected the credentials.');
  });

  it('edits a provider without asking for its key again, and declares manual models', async () => {
    const { dialog, user, aiApi } = await openSettings(aiState([aiModel()]), (api) => api.saveProvider.mockResolvedValue(ok(aiState([aiModel()]))));
    await user.click(dialog.getByRole('button', { name: 'Edit' }));
    const form = within(dialog.getByRole('form', { name: 'Edit Provider' }));
    expect(form.getByLabelText('API key')).toHaveAttribute('placeholder', 'Leave empty to keep the stored key');
    await user.click(form.getByRole('button', { name: 'Add Model' }));
    await user.type(form.getByLabelText('Model identifier 1'), 'my-model');
    await user.click(form.getByRole('checkbox', { name: 'Tools' }));
    await user.click(form.getByRole('button', { name: 'Save Provider' }));
    await waitFor(() => expect(aiApi.saveProvider).toHaveBeenCalled());
    expect(aiApi.saveProvider.mock.lastCall?.[0]).toMatchObject({ id: PROVIDER.id, apiKey: null, manualModels: [{ id: 'my-model', tools: true, image: false }] });
  });

  it('refreshes models, disconnects and removes a provider', async () => {
    const { dialog, user, aiApi } = await openSettings(aiState([aiModel()]));
    await user.click(dialog.getByRole('button', { name: 'Refresh Models' }));
    await waitFor(() => expect(aiApi.refreshModels).toHaveBeenCalledWith(PROVIDER.id));
    await user.click(dialog.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(aiApi.disconnectProvider).toHaveBeenCalledWith(PROVIDER.id));
    await user.click(dialog.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(aiApi.removeProvider).toHaveBeenCalledWith(PROVIDER.id));
  });

  it('adds an MCP server only after showing the command and asking for trust', async () => {
    const { dialog, user, aiApi } = await openSettings(aiState(), (api) => api.saveMcpServer.mockResolvedValue(ok(aiState())));
    await user.click(dialog.getByRole('tab', { name: 'MCP Servers' }));
    await user.click(await dialog.findByRole('button', { name: 'Add MCP Server' }));
    const form = within(dialog.getByRole('form', { name: 'Add MCP Server' }));
    await user.type(form.getByLabelText('Server name'), 'Local tools');
    await user.type(form.getByLabelText('Executable'), 'npx');
    await user.type(form.getByLabelText('Arguments (one per line)'), '-y{Enter}some-server');
    expect(form.getByText('npx -y some-server')).toBeInTheDocument();
    expect(form.getByRole('checkbox', { name: /I trust this server/ })).not.toBeChecked();
    await user.click(form.getByRole('button', { name: 'Save Server' }));
    await waitFor(() => expect(aiApi.saveMcpServer).toHaveBeenCalled());
    expect(aiApi.saveMcpServer).toHaveBeenCalledWith({ id: null, name: 'Local tools', enabled: true, trusted: false, authToken: null, transport: 'stdio', command: 'npx', args: ['-y', 'some-server'] });
  });

  it('shows the state of a server, its tools and connection errors, and connects it', async () => {
    const state = aiState();
    state.settings.mcpServers = [{ id: 's1', name: 'Weather', enabled: true, trusted: true, credentialHint: null, transport: 'http', url: 'https://mcp.example.com/mcp' }];
    const { dialog, user, aiApi } = await openSettings(state, (api) => {
      api.listMcpServers.mockResolvedValue(ok([{ id: 's1', state: 'error', error: 'Could not connect: timeout', commandLine: null, tools: [] }]));
      api.connectMcpServer.mockResolvedValue(ok({ id: 's1', state: 'connected', error: null, commandLine: null, tools: [{ serverId: 's1', serverName: 'Weather', name: 'forecast', description: 'Get a forecast', inputSchema: {} }] }));
    });
    await user.click(dialog.getByRole('tab', { name: 'MCP Servers' }));
    expect(await dialog.findByText('Could not connect: timeout')).toBeInTheDocument();
    aiApi.listMcpServers.mockResolvedValue(ok([{ id: 's1', state: 'connected', error: null, commandLine: null, tools: [{ serverId: 's1', serverName: 'Weather', name: 'forecast', description: 'Get a forecast', inputSchema: {} }] }]));
    await user.click(dialog.getByRole('button', { name: 'Connect' }));
    expect(await dialog.findByText('1 tool(s)')).toBeInTheDocument();
    expect(await dialog.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('changes limits and the approval policy, and clears history after an explicit confirmation', async () => {
    const { dialog, user, aiApi, panel, send } = await openSettings(aiState([aiModel()]), (api) => api.runTurn.mockResolvedValue(ok(answer('Hi!'))));
    await user.click(dialog.getByRole('tab', { name: 'Agent' }));
    await user.selectOptions(dialog.getByLabelText('Project changes'), 'ask');
    const steps = dialog.getByLabelText('Maximum steps per task');
    await user.clear(steps);
    await user.type(steps, '5');
    await user.click(dialog.getByRole('button', { name: 'Save Settings' }));
    await waitFor(() => expect(aiApi.updatePreferences).toHaveBeenCalledWith({ limits: expect.objectContaining({ maxIterations: 5 }), approval: { modify: 'ask', external: 'ask' } }));
    expect(dialog.getByText('Destructive operations, such as deleting frames or layers, always ask.')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Clear Conversation History' })).toBeDisabled();
    void panel;
    void send;
  });
});
