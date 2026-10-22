import { describe, expect, it } from 'vitest';
import { moveModifier, nudgeModifier, screenToSvg, snapPosition } from './placement';

describe('manual placement', () => {
  it.each([1, 0.5, 0.25] as const)('snaps one stable reference point to a %s-unit grid', increment => {
    const moved = moveModifier({ x: 18, y: 18 }, { x: -1.26, y: 0.63 }, { enabled: true, increment });
    expect(moved.position).toEqual(snapPosition({ x: 16.74, y: 18.63 }, increment));
    expect(moved.snapped).toBe(true);
  });

  it('preserves pointer delta and bypasses snap while Alt is held', () => {
    expect(moveModifier({ x: 18, y: 18 }, { x: -1.26, y: 0.63 }, { enabled: false, increment: 1 }).position).toEqual({ x: 16.74, y: 18.63 });
    expect(moveModifier({ x: 18, y: 18 }, { x: -1.26, y: 0.63 }, { enabled: true, increment: 1, alt: true }).position).toEqual({ x: 16.74, y: 18.63 });
  });

  it('converts pointer coordinates through zoom, pan and a rotated affine matrix', () => {
    expect(screenToSvg({ x: 230, y: 150 }, { a: 10, b: 0, c: 0, d: 10, e: 100, f: 50 })).toEqual({ x: 13, y: 10 });
    expect(screenToSvg({ x: 80, y: 120 }, { a: 0, b: 4, c: -4, d: 0, e: 100, f: 80 })).toEqual({ x: 10, y: 5 });
  });

  it('nudges by grid step, Shift 2 units, and Alt 0.1 unit', () => {
    expect(nudgeModifier({ x: 18, y: 18 }, 'ArrowLeft', 0.25, false, false).x).toBe(17.75);
    expect(nudgeModifier({ x: 18, y: 18 }, 'ArrowUp', 1, true, false).y).toBe(16);
    expect(nudgeModifier({ x: 18, y: 18 }, 'ArrowRight', 1, false, true).x).toBe(18.1);
  });
});
