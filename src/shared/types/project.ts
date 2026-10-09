/** Describes the project's logical canvas dimensions and optional locked aspect ratio. */
export interface ProjectAspectRatio {
  width: number;
  height: number;
}

export interface ProjectCanvas {
  width: number;
  height: number;
  keepAspectRatio: boolean;
  aspectRatio?: ProjectAspectRatio;
}

/** Persistent project metadata stored in `<project>/project.json`. */
export interface ProjectMetadata {
  formatVersion: number;
  id: string;
  name: string;
  /** UTC ISO-8601 timestamp. */
  createdAt: string;
  /** UTC ISO-8601 timestamp. */
  updatedAt: string;
  canvas: ProjectCanvas;
}

/** Reference to a project kept in application-level state (never inside a project). */
export interface RecentProject {
  projectId: string;
  name: string;
  /** Absolute path of the project directory. */
  path: string;
  /** UTC ISO-8601 timestamp. */
  lastOpenedAt: string;
  /** Computed at read time; never persisted. */
  available: boolean;
}
