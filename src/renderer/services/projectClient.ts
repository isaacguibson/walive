import type { AnimationAPI, AssetsAPI, ExportAPI, ProjectAPI, ScenesAPI } from '@shared/types/api';

/** Returns the project API provided by the preload script. */
export function getProjectApi(): ProjectAPI {
  return window.api.project;
}

/** Returns the animation persistence API provided by the preload script. */
export function getAnimationApi(): AnimationAPI {
  return window.api.animation;
}

/** Returns the scene management API provided by the preload script. */
export function getScenesApi(): ScenesAPI {
  return window.api.scenes;
}

/** Returns the project asset API provided by the preload script. */
export function getAssetsApi(): AssetsAPI {
  return window.api.assets;
}

/** Returns the export API provided by the preload script. */
export function getExportApi(): ExportAPI {
  return window.api.export;
}
