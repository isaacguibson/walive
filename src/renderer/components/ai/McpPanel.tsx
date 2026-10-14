import { useEffect, useState } from 'react';
import type { AIState, McpServerConfig, McpServerStatus, SaveMcpServerInput } from '@shared/ai/types';
import type { AIAPI } from '@shared/types/api';
import { useAsyncAction } from './useAsyncAction';

interface McpForm {
  id: string | null;
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  authToken: string;
  enabled: boolean;
  trusted: boolean;
}

const BLANK: McpForm = { id: null, name: '', transport: 'stdio', command: '', args: '', url: '', authToken: '', enabled: true, trusted: false };

function toForm(server: McpServerConfig): McpForm {
  return {
    ...BLANK,
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    trusted: server.trusted,
    ...(server.transport === 'stdio' ? { command: server.command, args: server.args.join('\n') } : { url: server.url })
  };
}

function toInput(form: McpForm): SaveMcpServerInput {
  const common = { id: form.id, name: form.name, enabled: form.enabled, trusted: form.trusted, authToken: form.authToken === '' ? null : form.authToken };
  return form.transport === 'http'
    ? { ...common, transport: 'http', url: form.url }
    : { ...common, transport: 'stdio', command: form.command, args: form.args.split('\n').filter((line) => line.trim() !== '') };
}

const STATE_LABELS: Record<McpServerStatus['state'], string> = { disconnected: 'Disconnected', connecting: 'Connecting', connected: 'Connected', error: 'Error' };

interface McpPanelProps {
  ai: AIState;
  api: AIAPI;
  onState(state: AIState): void;
}

/** MCP servers: configure, trust, connect, test and inspect their tools. */
export function McpPanel({ ai, api, onState }: McpPanelProps) {
  const [form, setForm] = useState<McpForm | null>(null);
  const [statuses, setStatuses] = useState<McpServerStatus[] | null>(null);
  const action = useAsyncAction();

  async function loadStatuses() {
    const result = await api.listMcpServers();
    if (result.ok) {
      setStatuses(result.value);
    }
  }

  useEffect(() => {
    void loadStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function statusOf(id: string): McpServerStatus | undefined {
    return statuses?.find((status) => status.id === id);
  }

  async function status(operation: () => Promise<{ ok: true; value: McpServerStatus | null } | { ok: false; error: { message: string } }>, success: string) {
    await action.run(async () => {
      const result = await operation();
      await loadStatuses();
      if (!result.ok) {
        return { text: result.error.message, error: true };
      }
      return result.value?.state === 'error' ? { text: result.value.error ?? 'The server could not be reached.', error: true } : { text: success, error: false };
    });
  }

  function change(patch: Partial<McpForm>) {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  const preview = form?.transport === 'stdio' && form.command.trim() !== '' ? [form.command, ...form.args.split('\n').filter((line) => line.trim() !== '')].join(' ') : null;

  return (
    <section aria-label="MCP Servers">
      <p className="field-hint">MCP servers add tools to the agent. A local server runs a program on this computer and a remote one receives your agent&apos;s requests, so connect only servers you trust.</p>
      {ai.settings.mcpServers.length === 0 && <p className="muted">No MCP servers yet.</p>}
      <ul className="ai-settings-list">
        {ai.settings.mcpServers.map((server) => {
          const current = statusOf(server.id);
          return (
            <li key={server.id}>
              <div>
                <strong>{server.name}</strong>
                <span className="muted">
                  {' '}
                  {server.transport === 'stdio' ? 'Local process' : 'Remote'} · {STATE_LABELS[current?.state ?? 'disconnected']}
                  {!server.enabled ? ' · Disabled' : ''}
                  {!server.trusted ? ' · Not trusted' : ''}
                </span>
                {current?.commandLine != null && <code className="ai-command">{current.commandLine}</code>}
                {current?.error != null && <p className="form-error">{current.error}</p>}
                {current !== undefined && current.tools.length > 0 && (
                  <details>
                    <summary>{current.tools.length} tool(s)</summary>
                    <ul>
                      {current.tools.map((tool) => (
                        <li key={tool.name}>
                          <strong>{tool.name}</strong> <span className="muted">{tool.description}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="ai-settings-actions">
                {current?.state === 'connected' ? (
                  <button type="button" className="button button-small" disabled={action.busy} onClick={() => void status(() => api.disconnectMcpServer(server.id), 'Disconnected.')}>
                    Disconnect
                  </button>
                ) : (
                  <button type="button" className="button button-small" disabled={action.busy} onClick={() => void status(() => api.connectMcpServer(server.id), 'Connected.')}>
                    Connect
                  </button>
                )}
                <button type="button" className="button button-small" disabled={action.busy} onClick={() => void status(() => api.testMcpServer(server.id), 'The server responded.')}>
                  Test
                </button>
                <button type="button" className="button button-small" disabled={action.busy} onClick={() => setForm(toForm(server))}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button button-small button-danger"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const result = await api.removeMcpServer(server.id);
                      if (!result.ok) {
                        return { text: result.error.message, error: true };
                      }
                      onState(result.value);
                      await loadStatuses();
                      return { text: 'Server removed.', error: false };
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {form === null ? (
        <button type="button" className="button button-small" onClick={() => setForm({ ...BLANK })}>
          Add MCP Server
        </button>
      ) : (
        <form
          className="ai-settings-form"
          aria-label={form.id === null ? 'Add MCP Server' : 'Edit MCP Server'}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              const result = await api.saveMcpServer(toInput(form));
              if (!result.ok) {
                return { text: result.error.message, error: true };
              }
              onState(result.value);
              await loadStatuses();
              setForm(null);
              return { text: 'Server saved. Connect it to use its tools.', error: false };
            });
          }}
        >
          <div className="field">
            <label htmlFor="mcp-name">Server name</label>
            <input id="mcp-name" value={form.name} maxLength={60} onChange={(event) => change({ name: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="mcp-transport">Type</label>
            <select id="mcp-transport" value={form.transport} onChange={(event) => change({ transport: event.target.value === 'http' ? 'http' : 'stdio' })}>
              <option value="stdio">Local process</option>
              <option value="http">Remote (HTTP)</option>
            </select>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <div className="field">
                <label htmlFor="mcp-command">Executable</label>
                <input id="mcp-command" value={form.command} placeholder="npx or /absolute/path/to/server" onChange={(event) => change({ command: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="mcp-args">Arguments (one per line)</label>
                <textarea id="mcp-args" rows={3} value={form.args} onChange={(event) => change({ args: event.target.value })} />
              </div>
              {preview !== null && (
                <p className="field-hint">
                  Command that will run: <code className="ai-command">{preview}</code>
                </p>
              )}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="mcp-url">Server URL</label>
                <input id="mcp-url" value={form.url} placeholder="https://example.com/mcp" onChange={(event) => change({ url: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="mcp-token">Bearer token (optional)</label>
                <input id="mcp-token" type="password" autoComplete="off" value={form.authToken} placeholder={form.id === null ? '' : 'Leave empty to keep the stored token'} onChange={(event) => change({ authToken: event.target.value })} />
              </div>
            </>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={form.enabled} onChange={(event) => change({ enabled: event.target.checked })} />
            <span>Enabled</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={form.trusted} onChange={(event) => change({ trusted: event.target.checked })} />
            <span>I trust this server and allow the application to {form.transport === 'stdio' ? 'run it' : 'contact it'}</span>
          </label>
          <div className="dialog-actions">
            <button type="button" className="button" disabled={action.busy} onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={action.busy}>
              Save Server
            </button>
          </div>
        </form>
      )}
      {action.message !== null && (
        <p className={action.message.error ? 'form-error' : 'form-status'} role={action.message.error ? 'alert' : 'status'}>
          {action.message.text}
        </p>
      )}
    </section>
  );
}
