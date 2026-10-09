const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Formats a "last opened" timestamp as Today / Yesterday / short date. */
export function formatLastOpened(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  const dayDifference = Math.round((startOfDay(now) - startOfDay(date)) / MS_PER_DAY);
  if (dayDifference === 0) {
    return 'Today';
  }
  if (dayDifference === 1) {
    return 'Yesterday';
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(date);
}
