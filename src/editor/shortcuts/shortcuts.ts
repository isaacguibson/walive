export type ShortcutModifier = 'ctrl' | 'shift' | 'alt';

export type ShortcutAction =
  | 'frame.copy'
  | 'frame.paste'
  | 'frame.cut'
  | 'frame.duplicate'
  | 'frame.next'
  | 'frame.previous'
  | 'playback.toggle'
  | 'history.undo'
  | 'history.redo'
  | 'project.save';

export interface Shortcut {
  /** Lower-case `KeyboardEvent.key`. */
  key: string;
  /** `ctrl` means the platform command key: Ctrl, or Cmd on macOS. */
  modifiers: readonly ShortcutModifier[];
  action: ShortcutAction;
}

/** Central shortcut table (HU_00004 §54). */
export const DEFAULT_SHORTCUTS: readonly Shortcut[] = [
  { key: 'c', modifiers: ['ctrl'], action: 'frame.copy' },
  { key: 'v', modifiers: ['ctrl'], action: 'frame.paste' },
  { key: 'x', modifiers: ['ctrl'], action: 'frame.cut' },
  { key: 'd', modifiers: ['ctrl'], action: 'frame.duplicate' },
  { key: 'w', modifiers: ['ctrl'], action: 'frame.next' },
  { key: 'a', modifiers: ['ctrl'], action: 'frame.previous' },
  { key: 'space', modifiers: [], action: 'playback.toggle' },
  { key: 'z', modifiers: ['ctrl'], action: 'history.undo' },
  { key: 'z', modifiers: ['ctrl', 'shift'], action: 'history.redo' },
  { key: 'y', modifiers: ['ctrl'], action: 'history.redo' },
  { key: 's', modifiers: ['ctrl'], action: 'project.save' }
];

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Finds the action bound to a key event. Modifiers must match exactly. */
export function matchShortcut(event: KeyEventLike, shortcuts: readonly Shortcut[] = DEFAULT_SHORTCUTS): ShortcutAction | null {
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  for (const shortcut of shortcuts) {
    if (
      shortcut.key === key &&
      shortcut.modifiers.includes('ctrl') === command &&
      shortcut.modifiers.includes('shift') === event.shiftKey &&
      shortcut.modifiers.includes('alt') === event.altKey
    ) {
      return shortcut.action;
    }
  }
  return null;
}
