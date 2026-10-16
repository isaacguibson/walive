export type IconName =
  | 'brush'
  | 'bezier'
  | 'eraser'
  | 'fill'
  | 'shapes'
  | 'select'
  | 'settings'
  | 'history'
  | 'play'
  | 'stop'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'chevronDown'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'clear'
  | 'trash'
  | 'eye'
  | 'eyeOff'
  | 'arrowUp'
  | 'arrowDown'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'loop'
  | 'save'
  | 'export'
  | 'close'
  | 'image'
  | 'music'
  | 'file'
  | 'edit'
  | 'onion'
  | 'pressure'
  | 'stabilize'
  | 'opacity'
  | 'paperPlane'
  | 'panelCollapse'
  | 'sparkles';

const PATHS: Record<IconName, readonly string[]> = {
  brush: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  bezier: ['M5 15C5 9 9 5 17 5', 'M3 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M17 5a2 2 0 1 0 4 0 2 2 0 1 0-4 0'],
  eraser: [
    'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21',
    'M22 21H7',
    'm5 11 9 9'
  ],
  fill: [
    'm19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z',
    'm5 2 5 5',
    'M2 13h15',
    'M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z'
  ],
  shapes: ['M3 3h8v8H3Z', 'M13 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0', 'M3 21l4.5-8L12 21Z', 'M14 21l7-7'],
  select: [
    'M5 3a2 2 0 0 0-2 2',
    'M19 3a2 2 0 0 1 2 2',
    'M21 19a2 2 0 0 1-2 2',
    'M5 21a2 2 0 0 1-2-2',
    'M9 3h1',
    'M9 21h1',
    'M14 3h1',
    'M14 21h1',
    'M3 9v1',
    'M21 9v1',
    'M3 14v1',
    'M21 14v1'
  ],
  settings: ['M4 7h9', 'M17 7h3', 'M15 5v4', 'M4 17h3', 'M11 17h9', 'M9 15v4'],
  history: ['M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 'M12 7v5l3 2'],
  play: ['M7 4.5v15l12.5-7.5Z'],
  stop: ['M6 6h12v12H6Z'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['m6 9 6 6 6-6'],
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
  ],
  cut: [
    'M3 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    'M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    'M20 4 8.1 15.9',
    'M14.5 14.5 20 20',
    'M8.1 8.1 12 12'
  ],
  paste: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6v4H9z'],
  duplicate: [
    'M8 8V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-4',
    'M3 8h13v13H3z',
    'M9.5 11v7',
    'M6 14.5h7'
  ],
  clear: ['M3 3h18v18H3z', 'm9 9 6 6', 'm15 9-6 6'],
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M10 11v6',
    'M14 11v6'
  ],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0'],
  eyeOff: [
    'M9.9 4.2A9.1 9.1 0 0 1 12 5c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7',
    'M6.6 6.6A13.5 13.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
    'M2 2l20 20'
  ],
  arrowUp: ['M12 19V5', 'm5 12 7-7 7 7'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  fullscreen: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  exitFullscreen: ['M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M3 16h3a2 2 0 0 1 2 2v3', 'M16 21v-3a2 2 0 0 1 2-2h3'],
  loop: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  export: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M7 9a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
    'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'
  ],
  music: ['M9 18V5l12-2v13', 'M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M15 16a3 3 0 1 0 6 0 3 3 0 1 0-6 0'],
  file: ['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z', 'M14 2v6h6'],
  edit: ['M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  onion: ['M12 2v2', 'M8 6a6 6 0 1 0 8 0', 'M6 5 4.5 3.5', 'M18 5l1.5-1.5', 'M4 12H2', 'M22 12h-2', 'M8 11a4 4 0 1 0 8 0', 'M10 20h4'],
  pressure: ['M12 3 6 12l6 9 6-9Z', 'M12 11v7'],
  stabilize: ['M3 16c3-9 6-9 9-1s6 8 9-1'],
  opacity: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z', 'M6.2 14h11.6'],
  paperPlane: ['M22 2 15 22l-4-9-9-4Z', 'M22 2 11 13'],
  panelCollapse: ['M3 5h18v14H3Z', 'M15 5v14', 'm9 9 3 3-3 3'],
  sparkles: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z', 'M19 16v4', 'M17 18h4'],
};

const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play', 'stop']);

interface IconProps {
  name: IconName;
  size?: number;
}

/** Decorative icon; the button that contains it provides the accessible name. */
export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
