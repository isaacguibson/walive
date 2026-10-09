import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AssetsAPI } from '@shared/types/api';
import { ASSET_DRAG_MIME, type ProjectAsset, type ProjectAssetType } from '@shared/types/assets';
import { Dialog } from '../Dialog';
import { Icon, type IconName } from './icons';
import { IconButton } from './IconButton';

interface AssetPanelProps {
  assetsApi: AssetsAPI;
}

/** Image and audio files get their own icon; everything else uses the generic file icon. */
export function assetIcon(type: ProjectAssetType): IconName {
  if (type === 'image') {
    return 'image';
  }
  if (type === 'audio') {
    return 'music';
  }
  return 'file';
}

function baseName(asset: ProjectAsset): string {
  return asset.extension !== '' && asset.name.toLowerCase().endsWith(`.${asset.extension}`)
    ? asset.name.slice(0, -(asset.extension.length + 1))
    : asset.name;
}

/** Compact, file-explorer style list of the files that really exist in the open project's assets folders. */
export function AssetPanel({ assetsApi }: AssetPanelProps) {
  const [assets, setAssets] = useState<ProjectAsset[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ProjectAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Enter submits the form and disables the input; that must not be mistaken for a click outside. */
  const committingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await assetsApi.listAssets();
    if (!mounted.current) {
      return;
    }
    if (result.ok) {
      setAssets(result.value);
      setSelectedId((current) => (result.value.some((asset) => asset.id === current) ? current : null));
    } else {
      setAssets((current) => current ?? []);
      setError(result.error.message);
    }
  }, [assetsApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importAssets() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assetsApi.importAssets();
      if (!mounted.current) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { imported, skipped } = result.value;
      if (imported.length > 0) {
        setSelectedId(imported[imported.length - 1]?.id ?? null);
      }
      const parts: string[] = [];
      if (imported.length > 0) {
        parts.push(`Imported ${imported.length} ${imported.length === 1 ? 'asset' : 'assets'}.`);
      }
      for (const item of skipped) {
        parts.push(`${item.name}: ${item.reason}`);
      }
      setNotice(parts.length > 0 ? parts.join(' ') : null);
      await refresh();
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function startRename(asset: ProjectAsset) {
    setError(null);
    setNotice(null);
    setSelectedId(asset.id);
    setRenamingId(asset.id);
    setRenameValue(baseName(asset));
  }

  async function commitRename(event: FormEvent<HTMLFormElement>, asset: ProjectAsset) {
    event.preventDefault();
    committingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await assetsApi.renameAsset(asset.id, renameValue);
      if (!mounted.current) {
        return;
      }
      if (!result.ok) {
        // Keep the input open so the name can be corrected.
        setError(result.error.message);
        return;
      }
      setRenamingId(null);
      setSelectedId(result.value.id);
      await refresh();
    } finally {
      committingRef.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  /** Escape, or a click outside the input: leaves the name unchanged. */
  function cancelRename() {
    setRenamingId(null);
    setError(null);
  }

  async function confirmDelete(asset: ProjectAsset) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assetsApi.deleteAsset(asset.id);
      if (!mounted.current) {
        return;
      }
      setDeleting(null);
      if (!result.ok) {
        setError(result.error.message);
      } else if (selectedId === asset.id) {
        setSelectedId(null);
      }
      await refresh();
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="asset-panel" aria-label="Project Assets">
      <div className="asset-header">
        <h2 className="panel-title">Project Assets</h2>
        <IconButton
          icon="plus"
          label="Import Asset"
          size={16}
          className="asset-import"
          disabled={busy}
          onClick={() => void importAssets()}
        />
      </div>

      {error !== null && (
        <p className="asset-message asset-message-error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="asset-message" role="status">
          {notice}
        </p>
      )}

      {assets === null ? (
        <p className="asset-message muted">Loading assets…</p>
      ) : assets.length === 0 ? (
        <p className="asset-message muted">No assets yet. Use Import Asset to add files.</p>
      ) : (
        <ul className="asset-list" aria-label="Project asset list">
          {assets.map((asset) => {
            const selected = asset.id === selectedId;
            const renaming = asset.id === renamingId;
            return (
              <li
                key={asset.id}
                className={selected ? 'asset-row is-selected' : 'asset-row'}
                data-asset-type={asset.type}
                draggable={asset.type === 'image' && !renaming}
                onDragStart={(event) => {
                  if (asset.type !== 'image') {
                    return;
                  }
                  event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify({ assetId: asset.id, assetName: asset.name }));
                  event.dataTransfer.effectAllowed = 'copy';
                }}
              >
                {renaming ? (
                  <form className="asset-rename" onSubmit={(event) => void commitRename(event, asset)}>
                    <span className="asset-icon" data-asset-icon={assetIcon(asset.type)} aria-hidden="true">
                      <Icon name={assetIcon(asset.type)} size={16} />
                    </span>
                    <input
                      className="asset-rename-input"
                      aria-label={`New name for ${asset.name}`}
                      value={renameValue}
                      autoFocus
                      disabled={busy}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => {
                        if (!committingRef.current) {
                          cancelRename();
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          cancelRename();
                        }
                      }}
                    />
                    {asset.extension !== '' && <span className="asset-extension">.{asset.extension}</span>}
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="asset-row-main"
                      title={asset.relativePath}
                      aria-pressed={selected}
                      onClick={() => setSelectedId(asset.id)}
                      onDoubleClick={() => startRename(asset)}
                    >
                      <span className="asset-icon" data-asset-icon={assetIcon(asset.type)} aria-hidden="true">
                        <Icon name={assetIcon(asset.type)} size={16} />
                      </span>
                      <span className="asset-name">{asset.name}</span>
                    </button>
                    {selected && (
                      <span className="asset-actions">
                        <IconButton
                          icon="edit"
                          label={`Rename ${asset.name}`}
                          size={14}
                          className="asset-action"
                          disabled={busy}
                          onClick={() => startRename(asset)}
                        />
                        <IconButton
                          icon="trash"
                          label={`Delete ${asset.name}`}
                          size={14}
                          className="asset-action"
                          disabled={busy}
                          onClick={() => setDeleting(asset)}
                        />
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deleting !== null && (
        <Dialog title={`Delete "${deleting.name}"?`} titleId="confirm-delete-asset-title" onCancel={() => setDeleting(null)}>
          <p>This permanently deletes the file from the project folder.</p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirmDelete(deleting)}>
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
