import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ANIMATION_LIMITS } from '@shared/types/animation';
import type { Layer } from '@editor/model';
import { IconButton } from './IconButton';

interface LayerPanelProps {
  layers: readonly Layer[];
  activeLayerId: string;
  /** Layer edits are disabled while an animation is playing. */
  disabled: boolean;
  onSelect(layerId: string): void;
  onAdd(): void;
  onRename(layerId: string, name: string): boolean;
  onRemove(layerId: string): void;
  onMove(layerId: string, direction: 'up' | 'down'): void;
  onToggleVisible(layerId: string, visible: boolean): void;
}

/** Lower right section: layers of the active frame, top-most first. */
export function LayerPanel({
  layers,
  activeLayerId,
  disabled,
  onSelect,
  onAdd,
  onRename,
  onRemove,
  onMove,
  onToggleVisible
}: LayerPanelProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId);
  const activeLayer = layers[activeIndex];

  useEffect(() => {
    if (renamingId !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renamingId]);

  // A rename never survives a change of frame/layers.
  useEffect(() => {
    if (renamingId !== null && !layers.some((layer) => layer.id === renamingId)) {
      setRenamingId(null);
    }
  }, [layers, renamingId]);

  function startRename(layer: Layer) {
    if (disabled) {
      return;
    }
    setDraft(layer.name);
    setRenamingId(layer.id);
  }

  function commitRename() {
    if (renamingId === null) {
      return;
    }
    if (onRename(renamingId, draft)) {
      setRenamingId(null);
    }
  }

  function onRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setRenamingId(null);
    }
  }

  return (
    <section className="layer-panel" aria-label="Layers">
      <h2 className="panel-title">Layers</h2>
      <ul className="layer-list">
        {layers.map((layer) => {
          const active = layer.id === activeLayerId;
          return (
            <li key={layer.id} className={active ? 'layer-item is-active' : 'layer-item'}>
              <IconButton
                icon={layer.visible ? 'eye' : 'eyeOff'}
                label={layer.visible ? 'Hide Layer' : 'Show Layer'}
                size={16}
                disabled={disabled}
                onClick={() => onToggleVisible(layer.id, !layer.visible)}
              />
              {renamingId === layer.id ? (
                <input
                  ref={inputRef}
                  className="layer-name-input"
                  aria-label="Layer name"
                  maxLength={ANIMATION_LIMITS.maxLayerNameLength}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onRenameKeyDown}
                  onBlur={() => setRenamingId(null)}
                />
              ) : (
                <button
                  type="button"
                  className="layer-name"
                  title="Select Layer"
                  aria-current={active ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => onSelect(layer.id)}
                  onDoubleClick={() => startRename(layer)}
                >
                  {layer.name}
                </button>
              )}
              {!layer.visible && <span className="layer-hidden-tag">Hidden</span>}
            </li>
          );
        })}
      </ul>
      <div className="layer-actions">
        <IconButton icon="plus" label="Add Layer" disabled={disabled} onClick={onAdd} />
        <button
          type="button"
          className="button button-small"
          title="Rename Layer"
          disabled={disabled || activeLayer === undefined}
          onClick={() => activeLayer !== undefined && startRename(activeLayer)}
        >
          Rename
        </button>
        <IconButton
          icon="arrowUp"
          label="Move Layer Up"
          disabled={disabled || activeIndex <= 0}
          onClick={() => onMove(activeLayerId, 'up')}
        />
        <IconButton
          icon="arrowDown"
          label="Move Layer Down"
          disabled={disabled || activeIndex < 0 || activeIndex >= layers.length - 1}
          onClick={() => onMove(activeLayerId, 'down')}
        />
        <IconButton
          icon="trash"
          label="Remove Layer"
          disabled={disabled || layers.length <= 1}
          onClick={() => onRemove(activeLayerId)}
        />
      </div>
    </section>
  );
}
