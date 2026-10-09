let fallbackCounter = 0;

/** Creates unique identifiers made only of characters that are safe in file names. */
export function createIdGenerator(): () => string {
  return () => {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    fallbackCounter += 1;
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${fallbackCounter}`;
  };
}
