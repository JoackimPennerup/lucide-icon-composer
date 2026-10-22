import { describe, expect, it } from 'vitest';
import { snapScaleToPixels, sourceGeometrySpan, stepScaleByPixels } from './scale';
import { subjects, modifiers } from '../proof/icons';

describe('geometry-aware scale snapping', () => {
  it('uses the source path bounds instead of percentage rounding', () => {
    const span = sourceGeometrySpan(subjects.file);
    const scale = snapScaleToPixels(0.83, span, 0.5, 1.2);
    expect(scale * span).toBeCloseTo(Math.round(scale * span));
    expect(Math.abs(scale - 0.83)).toBeLessThan(1 / span);
  });

  it('steps by a whole geometry pixel and respects both scale ranges', () => {
    const span = sourceGeometrySpan(modifiers.plus);
    const start = snapScaleToPixels(0.45, span, 0.1, 1.5);
    expect(stepScaleByPixels(start, span, 1, 0.1, 1.5) * span).toBeCloseTo(start * span + 1);
    expect(stepScaleByPixels(start, span, -1, 0.1, 1.5) * span).toBeCloseTo(start * span - 1);
    expect(snapScaleToPixels(10, span, 0.5, 1.2)).toBeLessThanOrEqual(1.2);
  });
});
