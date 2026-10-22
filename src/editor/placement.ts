export interface Position { x: number; y: number }
export type GridIncrement = 1 | 0.5 | 0.25;
export interface SnapSettings { enabled: boolean; increment: GridIncrement; alt?: boolean }
export interface AffineMatrix { a: number; b: number; c: number; d: number; e: number; f: number }

export const roundPosition = (n: number) => Math.round(n * 1000) / 1000;

export function screenToSvg(point: Position, matrix: AffineMatrix): Position {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('Canvas transform is not invertible.');
  const x = point.x - matrix.e, y = point.y - matrix.f;
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}

export function snapPosition(position: Position, increment: GridIncrement): Position {
  return {
    x: roundPosition(Math.round(position.x / increment) * increment),
    y: roundPosition(Math.round(position.y / increment) * increment),
  };
}

/** Applies the drag delta to one stable modifier reference point. */
export function moveModifier(start: Position, delta: Position, settings: SnapSettings): { position: Position; snapped: boolean } {
  const raw = { x: roundPosition(start.x + delta.x), y: roundPosition(start.y + delta.y) };
  if (!settings.enabled || settings.alt) return { position: raw, snapped: false };
  return { position: snapPosition(raw, settings.increment), snapped: true };
}

export function nudgeModifier(start: Position, key: string, increment: GridIncrement, shift: boolean, alt: boolean): Position {
  const directions: Record<string, Position> = {
    ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
  };
  const direction = directions[key];
  if (!direction) return start;
  const step = alt ? 0.1 : shift ? 2 : increment;
  return { x: roundPosition(start.x + direction.x * step), y: roundPosition(start.y + direction.y * step) };
}
