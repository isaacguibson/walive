import { TOOL_DEFINITIONS } from '@editor/tools';
import type { ToolType } from '@editor/model';
import { IconButton } from './IconButton';
import type { IconName } from './icons';

const TOOL_ICONS: Record<ToolType, IconName> = {
  brush: 'brush',
  bezier: 'bezier',
  eraser: 'eraser',
  fill: 'fill'
};

interface ToolPanelProps {
  selectedTool: ToolType;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelect(tool: ToolType): void;
  onUndo(): void;
  onRedo(): void;
}

/** Area 1: the drawing tools (exactly one selected) and the history actions. */
export function ToolPanel({ selectedTool, disabled, canUndo, canRedo, onSelect, onUndo, onRedo }: ToolPanelProps) {
  return (
    <nav className="tool-panel" aria-label="Tools">
      <div className="tool-group">
        {TOOL_DEFINITIONS.map((tool) => (
          <IconButton
            key={tool.id}
            icon={TOOL_ICONS[tool.id]}
            label={tool.name}
            size={22}
            pressed={selectedTool === tool.id}
            disabled={disabled}
            onClick={() => onSelect(tool.id)}
          />
        ))}
      </div>
      <div className="tool-group tool-group-history">
        <IconButton icon="undo" label="Undo" size={22} disabled={!canUndo} onClick={onUndo} />
        <IconButton icon="redo" label="Redo" size={22} disabled={!canRedo} onClick={onRedo} />
      </div>
    </nav>
  );
}
