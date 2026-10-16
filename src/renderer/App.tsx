import { useMemo, useState } from 'react';
import type { AIAPI, AnimationAPI, AssetsAPI, ExportAPI, LayoutAPI, ProjectAPI, ScenesAPI } from '@shared/types/api';
import type { ProjectMetadata } from '@shared/types/project';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { getAiApi, getAnimationApi, getAssetsApi, getExportApi, getLayoutApi, getProjectApi, getScenesApi } from './services/projectClient';

type View = { name: 'home' } | { name: 'editor'; project: ProjectMetadata };

interface AppProps {
  /** Injectable for tests; defaults to the API exposed by the preload script. */
  api?: ProjectAPI;
  animationApi?: AnimationAPI;
  assetsApi?: AssetsAPI;
  scenesApi?: ScenesAPI;
  exportApi?: ExportAPI;
  aiApi?: AIAPI;
  layoutApi?: LayoutAPI;
}

export function App({
  api: injectedApi,
  animationApi: injectedAnimationApi,
  assetsApi: injectedAssetsApi,
  scenesApi: injectedScenesApi,
  exportApi: injectedExportApi,
  aiApi: injectedAiApi,
  layoutApi: injectedLayoutApi
}: AppProps) {
  // Resolved once so effects depending on the API are not re-run on every render.
  const api = useMemo(() => injectedApi ?? getProjectApi(), [injectedApi]);
  const animationApi = useMemo(() => injectedAnimationApi ?? getAnimationApi(), [injectedAnimationApi]);
  const assetsApi = useMemo(() => injectedAssetsApi ?? getAssetsApi(), [injectedAssetsApi]);
  const scenesApi = useMemo(() => injectedScenesApi ?? getScenesApi(), [injectedScenesApi]);
  const exportApi = useMemo(() => injectedExportApi ?? getExportApi(), [injectedExportApi]);
  const aiApi = useMemo(() => injectedAiApi ?? getAiApi(), [injectedAiApi]);
  const layoutApi = useMemo(() => injectedLayoutApi ?? getLayoutApi(), [injectedLayoutApi]);
  // The application always starts on the Home; the editor replaces it once a project is open.
  const [view, setView] = useState<View>({ name: 'home' });

  if (view.name === 'editor') {
    return (
      <EditorPage
        api={api}
        animationApi={animationApi}
        assetsApi={assetsApi}
        scenesApi={scenesApi}
        exportApi={exportApi}
        aiApi={aiApi}
        {...(layoutApi !== undefined ? { layoutApi } : {})}
        project={view.project}
        onClosed={() => setView({ name: 'home' })}
      />
    );
  }
  return <HomePage api={api} onProjectOpened={(project) => setView({ name: 'editor', project })} />;
}
