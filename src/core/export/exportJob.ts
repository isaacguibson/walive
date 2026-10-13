import { AppError } from '../errors';
import type { ExportProgress } from '@shared/types/export';

/** Progress and cancellation of one running export. */
export class ExportJob {
  private done = 0;

  constructor(
    readonly total: number,
    private readonly signal: AbortSignal,
    private readonly report: (progress: ExportProgress) => void
  ) {}

  throwIfCancelled(): void {
    if (this.signal.aborted) {
      throw new AppError('EXPORT_CANCELLED', 'The export was cancelled.');
    }
  }

  /** Counts a finished frame, publishes progress and lets pending requests (such as cancel) run. */
  async frameDone(sceneName: string): Promise<void> {
    this.done += 1;
    this.report({ stage: 'rendering', current: this.done, total: this.total, sceneName });
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.throwIfCancelled();
  }

  finalizing(): void {
    this.report({ stage: 'finalizing', current: this.total, total: this.total, sceneName: null });
  }
}
