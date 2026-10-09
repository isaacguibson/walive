import { MAX_HISTORY_ENTRIES } from '../constants';

/** Selection restored when a command is undone/redone (so the user sees what changed). */
export interface CommandFocus {
  readonly frameId: string;
  readonly layerId: string;
}

/**
 * A reversible editor operation. All undoable work in the editor is expressed as
 * commands so that one history serves drawing, layers and frames (HU_00004 §31).
 */
export interface Command {
  readonly label: string;
  readonly focus?: CommandFocus;
  execute(): void;
  undo(): void;
}

interface HistoryEntry {
  readonly id: number;
  readonly command: Command;
}

/**
 * Undo/redo stacks. Tracks a "saved" token so the document can tell whether it
 * differs from what was last persisted.
 */
export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private nextId = 1;
  /** Token of the state that precedes the oldest remembered command. */
  private baseToken = 0;
  private savedToken = 0;

  constructor(private readonly limit: number = MAX_HISTORY_ENTRIES) {}

  /** Runs a command and remembers it. If it throws, nothing is recorded. */
  execute(command: Command): void {
    command.execute();
    this.record(command);
  }

  /** Remembers a command whose effect has already been applied. */
  record(command: Command): void {
    this.undoStack.push({ id: this.nextId, command });
    this.nextId += 1;
    this.redoStack = [];
    while (this.undoStack.length > this.limit) {
      const dropped = this.undoStack.shift() as HistoryEntry;
      this.baseToken = dropped.id;
    }
  }

  undo(): Command | null {
    const entry = this.undoStack.pop();
    if (entry === undefined) {
      return null;
    }
    entry.command.undo();
    this.redoStack.push(entry);
    return entry.command;
  }

  redo(): Command | null {
    const entry = this.redoStack.pop();
    if (entry === undefined) {
      return null;
    }
    entry.command.execute();
    this.undoStack.push(entry);
    return entry.command;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Identifies the current document state; changes whenever a command is applied, undone or redone. */
  getToken(): number {
    const top = this.undoStack[this.undoStack.length - 1];
    return top === undefined ? this.baseToken : top.id;
  }

  markSaved(token: number = this.getToken()): void {
    this.savedToken = token;
  }

  get isDirty(): boolean {
    return this.getToken() !== this.savedToken;
  }
}
