import { safeStorage } from 'electron';
import type { SecretCipher } from '@core/ai/secureCredentialService';

/** Credentials are encrypted with the operating system's keychain through Electron. */
export class SafeStorageCipher implements SecretCipher {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(plainText: string): string {
    return safeStorage.encryptString(plainText).toString('base64');
  }

  decrypt(encrypted: string): string {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }
}
