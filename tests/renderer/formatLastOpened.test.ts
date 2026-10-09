import { describe, expect, it } from 'vitest';
import { formatLastOpened } from '../../src/renderer/services/formatLastOpened';

describe('formatLastOpened', () => {
  const now = new Date(2026, 9, 6, 15, 0, 0);

  it('formats today and yesterday', () => {
    expect(formatLastOpened(new Date(2026, 9, 6, 1, 0).toISOString(), now)).toBe('Today');
    expect(formatLastOpened(new Date(2026, 9, 5, 23, 59).toISOString(), now)).toBe('Yesterday');
  });

  it('formats older dates, adding the year when it differs', () => {
    expect(formatLastOpened(new Date(2026, 8, 30).toISOString(), now)).toBe('Sep 30');
    expect(formatLastOpened(new Date(2025, 11, 25).toISOString(), now)).toBe('Dec 25, 2025');
  });

  it('handles invalid timestamps', () => {
    expect(formatLastOpened('garbage', now)).toBe('Unknown');
  });
});
