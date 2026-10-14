import { AppError } from '../errors';
import { JsonFile, SerialQueue } from './jsonFile';

/** Encryption backed by the operating system (Electron `safeStorage` in the application). */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): string;
  decrypt(encrypted: string): string;
}

interface SecretsFile {
  version: 1;
  /** Encrypted secrets by reference. Plain text is never written. */
  secrets: Record<string, string>;
}

function parseSecrets(value: unknown): SecretsFile {
  const secrets: Record<string, string> = {};
  const source = (value as Partial<SecretsFile> | undefined)?.secrets;
  if (typeof source === 'object' && source !== null) {
    for (const [key, encrypted] of Object.entries(source)) {
      if (typeof encrypted === 'string') {
        secrets[key] = encrypted;
      }
    }
  }
  return { version: 1, secrets };
}

/** Masked form of a secret for the UI: only the last four characters survive. */
export function maskSecret(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

/**
 * Stores credentials encrypted with the operating system. Callers refer to a secret by an opaque
 * reference; nothing here is ever exposed to the renderer.
 */
export class SecureCredentialService {
  private readonly file: JsonFile<SecretsFile>;
  private readonly queue = new SerialQueue();

  constructor(filePath: string, private readonly cipher: SecretCipher) {
    this.file = new JsonFile(filePath, parseSecrets, 'Credentials');
  }

  async set(reference: string, secret: string): Promise<void> {
    if (!this.cipher.isAvailable()) {
      throw new AppError('AI_STORAGE_UNAVAILABLE', 'Secure credential storage is not available on this system, so the key was not saved.');
    }
    const encrypted = this.cipher.encrypt(secret);
    await this.queue.run(async () => {
      const current = await this.file.read();
      await this.file.write({ ...current, secrets: { ...current.secrets, [reference]: encrypted } });
    });
  }

  async get(reference: string): Promise<string | null> {
    const encrypted = (await this.file.read()).secrets[reference];
    if (encrypted === undefined) {
      return null;
    }
    try {
      return this.cipher.decrypt(encrypted);
    } catch {
      throw new AppError('AI_STORAGE_UNAVAILABLE', 'A stored credential could not be decrypted. Enter it again.');
    }
  }

  async delete(reference: string): Promise<void> {
    await this.queue.run(async () => {
      const current = await this.file.read();
      if (current.secrets[reference] === undefined) {
        return;
      }
      const { [reference]: _removed, ...rest } = current.secrets;
      await this.file.write({ ...current, secrets: rest });
    });
  }
}
