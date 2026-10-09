import type { Point } from '../model';

/**
 * "Lazy rope" stroke stabilizer (like Blender's Stabilize Stroke). The brush is
 * tied to the pointer by a rope of `radius` canvas pixels: it stays still while
 * the pointer moves inside the radius and is dragged behind it otherwise, so the
 * line visibly trails the cursor and small tremors never reach the drawing.
 */
export class StrokeStabilizer {
  private position: Point | null = null;

  constructor(private readonly radius: number) {}

  /** Moves the rope toward `pointer` and returns the new brush position. */
  push(pointer: Point): Point {
    if (this.position === null) {
      this.position = { x: pointer.x, y: pointer.y };
      return this.position;
    }
    const dx = pointer.x - this.position.x;
    const dy = pointer.y - this.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance > this.radius) {
      const pull = (distance - this.radius) / distance;
      this.position = { x: this.position.x + dx * pull, y: this.position.y + dy * pull };
    }
    return this.position;
  }

  reset(): void {
    this.position = null;
  }
}
