import type { BrushDefinition } from './brush';
import { SegmentStroke } from './painter';

/** Plain round brush: solid, smooth and continuous. */
export const basicBrush: BrushDefinition = {
  id: 'basic',
  name: 'Basic Brush',
  options: [],
  defaultSettings: {},
  startStroke: (_settings, context) => new SegmentStroke(context)
};
