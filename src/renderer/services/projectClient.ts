import type { AnimationAPI, ProjectAPI } from '@shared/types/api';

/** Returns the project API provided by the preload script. */
export function getProjectApi(): ProjectAPI {
  return window.api.project;
}

/** Returns the animation persistence API provided by the preload script. */
export function getAnimationApi(): AnimationAPI {
  return window.api.animation;
}
