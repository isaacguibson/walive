import type { ProjectCanvas } from '@shared/types/project';

/** Name of the root metadata file that identifies an Animation Studio project. */
export const PROJECT_FILE_NAME = 'project.json';

/** Current version of the `project.json` format. Increment on breaking changes. */
export const PROJECT_FORMAT_VERSION = 1;

/**
 * Directories every project must contain, as path segments relative to the
 * project root. `.cache/` is intentionally absent: it holds regenerable data
 * and must never be required for a project to be valid.
 */
export const REQUIRED_PROJECT_DIRECTORIES: readonly (readonly string[])[] = [
  ['scenes'],
  ['assets', 'images'],
  ['assets', 'audio'],
  ['assets', 'video'],
  ['assets', 'fonts'],
  ['drawings'],
  ['exports']
];

/** Generated data directory; created for new projects but optional afterwards. */
export const CACHE_DIRECTORY: readonly string[] = ['.cache'];

export const MAX_PROJECT_NAME_LENGTH = 100;

export const MAX_SCENE_NAME_LENGTH = 100;

/** Name given to the first scene of a project (also used when migrating a legacy single animation). */
export const DEFAULT_SCENE_NAME = 'Scene 1';

/** Directory with the scene registry and one sub-directory per scene. */
export const SCENES_DIRECTORY = 'scenes';

export const SCENE_REGISTRY_FILE = 'scenes.json';

export const DEFAULT_PROJECT_CANVAS: ProjectCanvas = {
  width: 1920,
  height: 1080,
  keepAspectRatio: false
};
