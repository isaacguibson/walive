import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../errors';
import type { CopilotLogin } from '@shared/ai/copilot';
import type { FetchLike } from './adapter';
import type { SecureCredentialService } from '../secureCredentialService';

export class GitHubCopilotAuthenticationService {
  private readonly pending = new Map<string, { controller: AbortController; ready: Promise<void> }>();

  constructor(private readonly credentials: SecureCredentialService, private readonly fetchImpl: FetchLike, private readonly wait: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => delay(ms, undefined, { signal })) {}

  async token(id: string): Promise<string | null> {
    const stored = await this.credentials.get(`copilot:${id}`);
    if (stored === null) return null;
    const value = JSON.parse(stored) as { accessToken: string; expiresAt: number | null; refreshToken?: string; clientId: string };
    if (value.expiresAt === null || value.expiresAt > Date.now() + 60_000) return value.accessToken;
    if (!value.refreshToken) throw new AppError('AI_AUTH_FAILED', 'The GitHub authorization expired. Sign in again.');
    const refreshed = await this.post('https://github.com/login/oauth/access_token', { client_id: value.clientId, grant_type: 'refresh_token', refresh_token: value.refreshToken }, AbortSignal.timeout(20_000));
    await this.store(id, value.clientId, refreshed);
    return refreshed['access_token'] as string;
  }

  private async post(url: string, input: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchImpl(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
      if (!response.ok) throw new AppError('AI_AUTH_FAILED', 'GitHub authorization failed. Check the OAuth App configuration.');
      const value: unknown = await response.json();
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(signal.aborted ? 'AI_CANCELLED' : 'AI_NETWORK', signal.aborted ? 'GitHub sign-in was cancelled.' : 'GitHub could not be reached. Try again.');
    }
  }

  private async store(id: string, clientId: string, value: Record<string, unknown>): Promise<void> {
    if (typeof value['access_token'] !== 'string' || !/^(gho_|ghu_)/.test(value['access_token'])) throw new AppError('AI_AUTH_FAILED', 'GitHub did not return a supported user authorization. Sign in again.');
    await this.credentials.set(`copilot:${id}`, JSON.stringify({ clientId, accessToken: value['access_token'], refreshToken: value['refresh_token'], expiresAt: typeof value['expires_in'] === 'number' ? Date.now() + value['expires_in'] * 1000 : null }));
  }

  async begin(id: string, clientId: string): Promise<CopilotLogin> {
    if (!/^[A-Za-z0-9._-]{8,100}$/.test(clientId)) throw new AppError('AI_INVALID_CONFIG', 'Enter the Client ID of your registered GitHub OAuth App with Device Flow enabled.');
    this.cancel(id);
    const controller = new AbortController();
    const value = await this.post('https://github.com/login/device/code', { client_id: clientId }, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
    if (typeof value['device_code'] !== 'string' || typeof value['user_code'] !== 'string' || value['verification_uri'] !== 'https://github.com/login/device' || typeof value['expires_in'] !== 'number' || typeof value['interval'] !== 'number') {
      throw new AppError('AI_AUTH_FAILED', 'GitHub could not start authorization. Enable Device Flow in the registered OAuth App.');
    }
    const expiresAt = Date.now() + Math.min(value['expires_in'], 900) * 1000;
    const ready = this.poll(id, clientId, value['device_code'], Math.max(5, value['interval']), expiresAt, controller.signal);
    ready.catch(() => undefined);
    this.pending.set(id, { controller, ready });
    return { userCode: value['user_code'], verificationUri: 'https://github.com/login/device', expiresAt };
  }

  private async poll(id: string, clientId: string, deviceCode: string, interval: number, expiresAt: number, signal: AbortSignal): Promise<void> {
    while (Date.now() < expiresAt) {
      await this.wait(interval * 1000, signal);
      const value = await this.post('https://github.com/login/oauth/access_token', { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
      if (value['access_token'] !== undefined) { signal.throwIfAborted(); await this.store(id, clientId, value); return; }
      if (value['error'] === 'authorization_pending') continue;
      if (value['error'] === 'slow_down') { interval += 5; continue; }
      throw new AppError('AI_AUTH_FAILED', value['error'] === 'access_denied' ? 'GitHub authorization was rejected.' : 'GitHub authorization expired or failed. Start sign-in again.');
    }
    throw new AppError('AI_AUTH_FAILED', 'GitHub authorization expired. Start sign-in again.');
  }

  async finish(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (pending === undefined) throw new AppError('AI_AUTH_FAILED', 'Start GitHub sign-in first.');
    try { await pending.ready; } finally { if (this.pending.get(id) === pending) this.pending.delete(id); }
  }

  cancel(id: string): void { this.pending.get(id)?.controller.abort(); this.pending.delete(id); }
  async disconnect(id: string): Promise<void> { this.cancel(id); await this.credentials.delete(`copilot:${id}`); }
  close(): void { for (const id of this.pending.keys()) this.cancel(id); }
}