export interface SceneInfo {
  /** Stable identifier; never changes when the scene is renamed. */
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** The scenes of a project in creation order, plus the one that is being edited. */
export interface SceneCollection {
  scenes: SceneInfo[];
  activeSceneId: string;
}
