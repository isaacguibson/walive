export type EditorErrorCode =
  | 'INVALID_VALUE'
  | 'NOT_FOUND'
  | 'LAST_LAYER'
  | 'LAYER_HIDDEN'
  | 'LIMIT_EXCEEDED'
  | 'NOTHING_TO_PASTE'
  | 'CANVAS_MISMATCH'
  | 'CANVAS_UNSUPPORTED'
  | 'CANVAS_INIT_FAILED';

/** Error raised by the editor domain. `message` is always safe to show to the user. */
export class EditorError extends Error {
  readonly code: EditorErrorCode;

  constructor(code: EditorErrorCode, message: string) {
    super(message);
    this.name = 'EditorError';
    this.code = code;
  }
}
