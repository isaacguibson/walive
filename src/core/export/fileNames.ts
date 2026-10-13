const UNSAFE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MAX_NAME_LENGTH = 100;
const MIN_FRAME_DIGITS = 4;

/** Turns any user-facing name into a name that is valid on Windows, macOS and Linux. */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME_LENGTH);
  if (cleaned === '') {
    return fallback;
  }
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Sanitizes `names` and makes them unique (case-insensitively) without touching the originals. */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = sanitizeFileName(name);
    let candidate = base;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
      candidate = `${base}_${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Digits needed so that frame numbers up to `largest` sort alphabetically. */
export function frameNumberDigits(largest: number): number {
  return Math.max(MIN_FRAME_DIGITS, String(largest).length);
}

export function frameFileName(frameNumber: number, digits: number): string {
  return `frame_${String(frameNumber).padStart(digits, '0')}.png`;
}
