import type { AppErrorCode } from '@shared/types/errors';
import type { ProjectMetadata } from '@shared/types/project';

/** A project that is currently loaded: its metadata plus where it lives. */
export interface OpenProject {
  path: string;
  metadata: ProjectMetadata;
}

export type ProjectValidationResult =
  | { valid: true; metadata: ProjectMetadata; missingDirectories: [] }
  | { valid: false; code: AppErrorCode; message: string; missingDirectories: string[] };
