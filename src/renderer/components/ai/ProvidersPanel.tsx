import { useState } from 'react';
import type { AIState, ManualModel, ProviderConfig, ProviderDescriptor, ProviderKind, SaveProviderInput } from '@shared/ai/types';
import type { AIAPI } from '@shared/types/api';
import { useAsyncAction } from './useAsyncAction';

interface ProviderForm {
  id: string | null;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  manualModels: ManualModel[];
}

function blankForm(descriptor: ProviderDescriptor): ProviderForm {
  return { id: null, kind: descriptor.kind, name: descriptor.label, baseUrl: '', apiKey: '', manualModels: [] };
}

function toInput(form: ProviderForm): SaveProviderInput {
  return {
    id: form.id,
    kind: form.kind,
    name: form.name,
    baseUrl: form.baseUrl.trim() === '' ? null : form.baseUrl,
    apiKey: form.apiKey === '' ? null : form.apiKey,
    manualModels: form.manualModels.filter((model) => model.id.trim() !== '')
  };
}

interface ProvidersPanelProps {
  ai: AIState;
  api: AIAPI;
  onState(state: AIState): void;
}

/** Provider connections: add, validate, edit, refresh models, disconnect and remove. */
export function ProvidersPanel({ ai, api, onState }: ProvidersPanelProps) {
  const [form, setForm] = useState<ProviderForm | null>(null);
  const action = useAsyncAction();
  const descriptors = ai.descriptors;
  const descriptor = form === null ? undefined : descriptors.find((candidate) => candidate.kind === form.kind);

  function edit(provider: ProviderConfig) {
    action.clear();
    setForm({ id: provider.id, kind: provider.kind, name: provider.name, baseUrl: provider.baseUrl ?? '', apiKey: '', manualModels: provider.manualModels });
  }

  function change(patch: Partial<ProviderForm>) {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  function changeModel(index: number, patch: Partial<ManualModel>) {
    setForm((current) => (current === null ? current : { ...current, manualModels: current.manualModels.map((model, position) => (position === index ? { ...model, ...patch } : model)) }));
  }

  async function mutate(operation: () => ReturnType<AIAPI['getState']>, success: string, afterSuccess?: () => void) {
    await action.run(async () => {
      const result = await operation();
      if (!result.ok) {
        return { text: result.error.message, error: true };
      }
      onState(result.value);
      afterSuccess?.();
      return { text: success, error: false };
    });
  }

  return (
    <section aria-label="AI Providers">
      <p className="field-hint">Credentials are encrypted by your operating system and are never shown again. Conversations are sent to the provider you select.</p>
      {ai.settings.providers.length === 0 && <p className="muted">No providers yet.</p>}
      <ul className="ai-settings-list">
        {ai.settings.providers.map((provider) => {
          const count = ai.models.filter((model) => model.providerId === provider.id).length;
          return (
            <li key={provider.id}>
              <div>
                <strong>{provider.name}</strong>
                <span className="muted">
                  {' '}
                  {descriptors.find((item) => item.kind === provider.kind)?.label ?? provider.kind} · {provider.credentialHint ?? 'No key'} · {count} model(s)
                </span>
              </div>
              <div className="ai-settings-actions">
                <button type="button" className="button button-small" disabled={action.busy} onClick={() => edit(provider)}>
                  Edit
                </button>
                <button type="button" className="button button-small" disabled={action.busy} onClick={() => void mutate(() => api.refreshModels(provider.id), 'Models updated.')}>
                  Refresh Models
                </button>
                <button
                  type="button"
                  className="button button-small"
                  disabled={action.busy || provider.credentialHint === null}
                  onClick={() => void mutate(() => api.disconnectProvider(provider.id), 'The key was removed.')}
                >
                  Disconnect
                </button>
                <button
                  type="button"
                  className="button button-small button-danger"
                  disabled={action.busy}
                  onClick={() => void mutate(() => api.removeProvider(provider.id), 'Provider removed.', () => setForm(null))}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {form === null ? (
        <div className="ai-settings-actions">
          <label className="visually-hidden" htmlFor="provider-kind">
            Provider type
          </label>
          <select
            id="provider-kind"
            value=""
            onChange={(event) => {
              const chosen = descriptors.find((candidate) => candidate.kind === event.target.value);
              if (chosen !== undefined) {
                action.clear();
                setForm(blankForm(chosen));
              }
            }}
          >
            <option value="">Add Provider…</option>
            {descriptors.map((item) => (
              <option key={item.kind} value={item.kind} disabled={!item.available}>
                {item.available ? item.label : `${item.label} (unavailable)`}
              </option>
            ))}
          </select>
          {descriptors.filter((item) => !item.available).map((item) => (
            <p key={item.kind} className="field-hint">
              {item.label}: {item.unavailableReason}
            </p>
          ))}
        </div>
      ) : (
        <form
          className="ai-settings-form"
          aria-label={form.id === null ? 'Add Provider' : 'Edit Provider'}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(() => api.saveProvider(toInput(form)), 'Provider saved.', () => setForm(null));
          }}
        >
          <p className="field-hint">{descriptor?.authHelp}</p>
          <div className="field">
            <label htmlFor="provider-name">Connection name</label>
            <input id="provider-name" value={form.name} maxLength={60} onChange={(event) => change({ name: event.target.value })} />
          </div>
          {descriptor !== undefined && descriptor.customEndpoint !== 'none' && (
            <div className="field">
              <label htmlFor="provider-endpoint">Endpoint URL{descriptor.customEndpoint === 'optional' ? ' (optional)' : ''}</label>
              <input
                id="provider-endpoint"
                value={form.baseUrl}
                placeholder={descriptor.defaultBaseUrl ?? 'https://example.com/v1'}
                onChange={(event) => change({ baseUrl: event.target.value })}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="provider-key">API key{descriptor?.needsApiKey === true ? '' : ' (optional)'}</label>
            <input
              id="provider-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              placeholder={form.id === null ? '' : 'Leave empty to keep the stored key'}
              onChange={(event) => change({ apiKey: event.target.value })}
            />
          </div>
          <fieldset className="ai-manual-models">
            <legend>Manual models</legend>
            <p className="field-hint">Use this when the provider cannot list its models. Only declare what you know the model supports.</p>
            {form.manualModels.map((model, index) => (
              <div key={index} className="ai-manual-model">
                <input aria-label={`Model identifier ${index + 1}`} value={model.id} placeholder="model-id" onChange={(event) => changeModel(index, { id: event.target.value, displayName: event.target.value })} />
                <label className="checkbox-row">
                  <input type="checkbox" checked={model.tools} onChange={(event) => changeModel(index, { tools: event.target.checked })} />
                  <span>Tools</span>
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={model.image} onChange={(event) => changeModel(index, { image: event.target.checked })} />
                  <span>Images</span>
                </label>
                <button type="button" className="button button-small" onClick={() => change({ manualModels: form.manualModels.filter((_, position) => position !== index) })}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="button button-small" onClick={() => change({ manualModels: [...form.manualModels, { id: '', displayName: '', image: false, tools: false, efforts: [] }] })}>
              Add Model
            </button>
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="button" disabled={action.busy} onClick={() => setForm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await api.testProvider(toInput(form));
                  return result.ok ? { text: `Connection works. ${result.value.modelCount} model(s) available.`, error: false } : { text: result.error.message, error: true };
                })
              }
            >
              Test Connection
            </button>
            <button type="submit" className="button button-primary" disabled={action.busy}>
              Save Provider
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
