import { useState } from 'react';
import type { CopilotLogin, CopilotStatus } from '@shared/ai/copilot';
import type { AIAPI } from '@shared/types/api';
import type { AIState, ProviderConfig } from '@shared/ai/types';

export function CopilotConnection({ provider, api, onState }: { provider: ProviderConfig; api: AIAPI; onState(state: AIState): void }) {
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [login, setLogin] = useState<CopilotLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(provider.oauthClientId ?? '');
  const [askClientId, setAskClientId] = useState(false);

  async function connect(device: boolean) {
    if (device && clientId.trim() === '') {
      setAskClientId(true);
      setStatus({ state: 'authentication-required', login: null, message: 'Enter the Client ID of a GitHub OAuth App with Device Flow enabled, then sign in again.' });
      return;
    }
    setBusy(true);
    setStatus({ state: 'connecting', login: null, message: 'Connecting to GitHub Copilot.' });
    try {
      if (device) {
        if (clientId.trim() !== (provider.oauthClientId ?? '')) {
          const saved = await api.saveProvider({ id: provider.id, kind: 'copilot', name: provider.name, baseUrl: null, apiKey: null, manualModels: [], oauthClientId: clientId.trim() });
          if (!saved.ok) { setStatus({ state: 'error', login: null, message: saved.error.message }); return; }
          onState(saved.value);
        }
        const started = await api.beginCopilotLogin(provider.id);
        if (!started.ok) { setStatus({ state: 'error', login: null, message: started.error.message }); return; }
        setLogin(started.value);
      }
      const result = await (device ? api.finishCopilotLogin(provider.id) : api.connectCopilot(provider.id));
      setStatus(result.ok ? result.value : { state: 'error', login: null, message: result.error.message });
      const state = await api.getState();
      if (state.ok) onState(state.value);
    } finally { setBusy(false); setLogin(null); }
  }

  async function disconnect() {
    const result = await api.disconnectProvider(provider.id);
    if (result.ok) {
      onState(result.value);
      setStatus({ state: 'disconnected', login: null, message: 'Disconnected from Animation Studio. Other GitHub applications remain signed in.' });
    } else setStatus({ state: 'error', login: null, message: result.error.message });
  }

  return (
    <div>
      <p role={status?.state === 'error' || status?.state === 'missing-entitlement' ? 'alert' : 'status'}>
        {status?.message ?? (provider.copilotConnected ? 'Connected to GitHub Copilot.' : 'Not connected.')}
        {status?.login ? ` Account: ${status.login}` : ''}
      </p>
      {login !== null && (
        <div role="group" aria-label="GitHub authorization">
          <p><a href="https://github.com/login/device" target="_blank" rel="noreferrer">Authorize on GitHub</a></p>
          <p>Device code: <strong>{login.userCode}</strong></p>
          <p className="field-hint">Waiting for authorization. This code expires in 15 minutes.</p>
        </div>
      )}
      {(askClientId || clientId !== '') && (
        <div className="field">
          <label htmlFor={`oauth-client-${provider.id}`}>GitHub OAuth App Client ID</label>
          <input id={`oauth-client-${provider.id}`} value={clientId} disabled={busy} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
          <p className="field-hint">
            The Client ID is public. Create an OAuth App at <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">github.com/settings/developers</a>,
            enable Device Flow and paste its Client ID. No client secret or repository permission is used.
          </p>
        </div>
      )}
      <div className="ai-settings-actions">
        <button type="button" className="button button-small" disabled={busy} onClick={() => void connect(false)}>Connect CLI Account</button>
        <button type="button" className="button button-small" disabled={busy} onClick={() => void connect(true)}>Sign in with GitHub</button>
        <button type="button" className="button button-small" onClick={() => void disconnect()}>{busy ? 'Cancel Sign-in' : 'Disconnect Copilot'}</button>
      </div>
      <p className="field-hint">
        Connect CLI Account uses an existing login of the official GitHub Copilot CLI: install it from github.com/features/copilot/cli, run <code>copilot login</code> in a terminal, then connect here.
        Usage is subject to your Copilot plan.
      </p>
    </div>
  );
}