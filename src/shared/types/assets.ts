export type ProjectAssetType = 'image' | 'audio' | 'video' | 'font' | 'other';

/** Drag-and-drop payload used by the renderer when an asset is dragged into the canvas. */
export const ASSET_DRAG_MIME = 'application/x-walive-asset';

/** A file owned by the open project. Paths are always relative to the project directory (POSIX separators). */
export interface ProjectAsset {
  /** Opaque identifier; currently the project-relative path. Only ever resolved by trusted code. */
  id: string;
  /** File name including its extension. */
  name: string;
  type: ProjectAssetType;
  relativePath: string;
  /** Lower-case extension without the dot; empty when there is none. */
  extension: string;
}

export interface SkippedAsset {
  name: string;
  reason: string;
}

export interface AssetImportResult {
  imported: ProjectAsset[];
  skipped: SkippedAsset[];
}
