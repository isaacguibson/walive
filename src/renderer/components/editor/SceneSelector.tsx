import { useEffect, useRef, useState } from 'react';
import type { SceneInfo } from '@shared/types/scenes';
import { Icon } from './icons';

interface SceneSelectorProps {
  scenes: readonly SceneInfo[];
  activeSceneId: string;
  disabled: boolean;
  onSelect(sceneId: string): void;
  onCreate(): void;
  onRename(): void;
  onDelete(): void;
}

/** Header dropdown that shows the active scene, switches scenes and opens the scene actions. */
export function SceneSelector({ scenes, activeSceneId, disabled, onSelect, onCreate, onRename, onDelete }: SceneSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = scenes.find((scene) => scene.id === activeSceneId);
  const isLastScene = scenes.length <= 1;
  const expanded = open && !disabled;

  useEffect(() => {
    if (!expanded) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      ref={rootRef}
      className="scene-selector"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="button button-small scene-selector-trigger"
        title="Select Scene"
        aria-haspopup="menu"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="scene-name" title={active?.name}>
          {active?.name ?? 'Scene'}
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {expanded && (
        <div className="context-menu scene-menu" role="menu" aria-label="Scenes">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              role="menuitemradio"
              aria-checked={scene.id === activeSceneId}
              className="context-menu-item scene-menu-item"
              title={scene.name}
              onClick={() => choose(() => onSelect(scene.id))}
            >
              <span className="scene-name">{scene.name}</span>
            </button>
          ))}
          <div className="context-menu-divider" />
          <button type="button" role="menuitem" className="context-menu-item" title="Create a new scene" onClick={() => choose(onCreate)}>
            New Scene…
          </button>
          <button type="button" role="menuitem" className="context-menu-item" title="Rename the current scene" onClick={() => choose(onRename)}>
            Rename Scene…
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            title={isLastScene ? 'A project needs at least one scene' : 'Delete the current scene'}
            disabled={isLastScene}
            onClick={() => choose(onDelete)}
          >
            Delete Scene…
          </button>
        </div>
      )}
    </div>
  );
}
