import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { EditorSession, EditorSnapshot } from '@editor/editorSession';
import { AddFramesPopover } from './AddFramesPopover';
import { FrameContextMenu, type FrameAction } from './FrameContextMenu';
import { FrameThumbnail } from './FrameThumbnail';
import { IconButton } from './IconButton';

interface TimelineProps {
  session: EditorSession;
  snapshot: EditorSnapshot;
  height?: number;
}

interface MenuState {
  frameId: string;
  x: number;
  y: number;
}

/** Area 3: frame management toolbar and the sequence of frames. */
export function Timeline({ session, snapshot, height = 168 }: TimelineProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const locked = snapshot.state.isPlaying;
  const activeFrameId = snapshot.state.activeFrameId;

  const closeAdd = useCallback(() => setAddOpen(false), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeFrameId]);

  function run(action: FrameAction, frameId: string) {
    switch (action) {
      case 'copy':
        session.copyFrame(frameId);
        break;
      case 'cut':
        session.cutFrame(frameId);
        break;
      case 'paste':
        session.pasteFrame(frameId);
        break;
      case 'duplicate':
        session.duplicateFrame(frameId);
        break;
      case 'clear':
        session.clearFrame(frameId);
        break;
      case 'remove':
        session.removeFrame(frameId);
        break;
    }
  }

  function onContextMenu(event: MouseEvent, frameId: string) {
    event.preventDefault();
    if (locked) {
      return;
    }
    // The menu always acts on the frame that was right-clicked.
    session.selectFrame(frameId);
    setAddOpen(false);
    setMenu({ frameId, x: event.clientX, y: event.clientY });
  }

  return (
    <section className="timeline" aria-label="Frame Management" style={{ height, flexBasis: `${height}px` }}>
      <div className="timeline-toolbar" role="toolbar" aria-label="Frame actions">
        <div className="split-button">
          <IconButton
            icon="plus"
            label="Add Frame"
            className="split-main"
            disabled={locked}
            onClick={() => session.addFrame()}
          />
          <IconButton
            icon="chevronDown"
            label="Add Multiple Frames"
            className="split-arrow"
            size={14}
            disabled={locked}
            aria-expanded={addOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setMenu(null);
              setAddOpen((open) => !open);
            }}
          />
          {addOpen && !locked && (
            <AddFramesPopover onAdd={(count) => session.addFrames(count)} onClose={closeAdd} />
          )}
        </div>
        <IconButton icon="copy" label="Copy Frame" disabled={locked} onClick={() => run('copy', snapshot.activeFrame.id)} />
        <IconButton icon="cut" label="Cut Frame" disabled={locked} onClick={() => run('cut', snapshot.activeFrame.id)} />
        <IconButton
          icon="paste"
          label="Paste Frame"
          disabled={locked || !snapshot.canPaste}
          onClick={() => run('paste', snapshot.activeFrame.id)}
        />
        <IconButton
          icon="duplicate"
          label="Duplicate Frame"
          disabled={locked}
          onClick={() => run('duplicate', snapshot.activeFrame.id)}
        />
        <IconButton icon="clear" label="Clear Frame" disabled={locked} onClick={() => run('clear', snapshot.activeFrame.id)} />
        <IconButton icon="trash" label="Remove Frame" disabled={locked} onClick={() => run('remove', snapshot.activeFrame.id)} />
        <span className="timeline-count muted">
          {snapshot.frames.length} {snapshot.frames.length === 1 ? 'frame' : 'frames'}
        </span>
      </div>

      <ol className="frame-strip" aria-label="Frames">
        {snapshot.frames.map((frame, index) => {
          const active = frame.id === activeFrameId;
          return (
            <li key={frame.id} className="frame-item">
              <button
                type="button"
                ref={active ? activeRef : undefined}
                className={active ? 'frame-button is-active' : 'frame-button'}
                aria-current={active ? 'true' : undefined}
                title={`Frame ${index + 1}`}
                onClick={() => session.selectFrame(frame.id)}
                onContextMenu={(event) => onContextMenu(event, frame.id)}
              >
                <span className="frame-preview">
                  <FrameThumbnail frame={frame} engine={session.engine} live={active} />
                </span>
                <span className="frame-label">Frame {index + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {menu !== null && (
        <FrameContextMenu
          x={menu.x}
          y={menu.y}
          canPaste={snapshot.canPaste}
          onAction={(action) => run(action, menu.frameId)}
          onClose={closeMenu}
        />
      )}
    </section>
  );
}
