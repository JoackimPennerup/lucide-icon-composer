import paper from 'paper';
import { describe, expect, it } from 'vitest';
import { composeIcon, parseLucideSvg, type CompositionInput } from './compose';
import { modifiers, subjects } from '../proof/icons';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

function input(subjectSvg: string, modifierSvg: string, clearance = 2): CompositionInput {
  return {
    subjectSvg, modifierSvg,
    placement: { anchor: 'center', offsetX: 0, offsetY: 0, scale: 1 },
    composition: { mode: 'cutout', clearance },
  };
}

function assertVisibleGap(result: ReturnType<typeof composeIcon>, clearance: number) {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  const output = parseLucideSvg(scope, result.svg);
  const subjectsOnly = output.slice(0, result.subjectPaths.length);
  const modifiersOnly = output.slice(result.subjectPaths.length);
  let minimum = Infinity;
  for (const subject of subjectsOnly) {
    for (let i = 0; i <= Math.ceil(subject.length / 0.02); i++) {
      const offset = Math.min(subject.length - 1e-7, i * subject.length / Math.ceil(subject.length / 0.02));
      const point = subject.getPointAt(offset) ?? subject.lastSegment.point;
      for (const modifier of modifiersOnly) {
        const nearest = modifier.getNearestPoint(point);
        minimum = Math.min(minimum, point.getDistance(nearest) - 2);
      }
    }
  }
  // The subject and modifier stroke radii are each counted once, including
  // the round cap newly created at a trim boundary.
  expect(minimum).toBeGreaterThanOrEqual(clearance - 0.03);
}

describe('SVG composition geometry', () => {
  it('splits two crossing straight lines and respects edge clearance', () => {
    const result = composeIcon(input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22))));
    expect(result.subjectPaths).toHaveLength(2);
    expect(result.exclusionRadius).toBeCloseTo(4.015, 3);
    assertVisibleGap(result, 2);
  });

  it('trims a straight line against a Bézier curve', () => {
    const result = composeIcon(input(svg(line(2, 12, 22, 12)), svg('<path d="M10 2 C10 8 14 16 14 22"/>')));
    expect(result.subjectPaths.length).toBeGreaterThanOrEqual(2);
    assertVisibleGap(result, 2);
  });

  it('trims a circle at multiple intersections', () => {
    const result = composeIcon(input(svg('<circle cx="12" cy="12" r="8"/>'), svg(line(12, 2, 12, 22))));
    expect(result.subjectPaths.length).toBeGreaterThanOrEqual(2);
    assertVisibleGap(result, 2);
  });

  it('partially trims a closed rounded rectangle', () => {
    const model = input(svg('<rect x="2" y="2" width="20" height="20" rx="2"/>'), svg(line(12, 2, 12, 22)));
    model.placement.anchor = 'bottom-right';
    const result = composeIcon(model);
    expect(result.subjectPaths.length).toBeGreaterThan(0);
    expect(result.subjectPaths[0]).not.toMatch(/[zZ]\s*$/);
    assertVisibleGap(result, 2);
  });

  it('handles multiple cuts on the same path', () => {
    const result = composeIcon(input(svg(line(2, 12, 22, 12)), svg('<path d="M8 2v20 M16 2v20"/>'), 0));
    expect(result.subjectPaths).toHaveLength(3);
    assertVisibleGap(result, 0);
  });

  it('allows for round subject end caps at an intersection', () => {
    const result = composeIcon(input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)), 2));
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(24, 24));
    const paths = parseLucideSvg(scope, result.svg);
    const leftEndpoint = paths[0].lastSegment.point;
    const modifier = paths.at(-1)!;
    const edgeGap = leftEndpoint.getDistance(modifier.getNearestPoint(leftEndpoint)) - 2;
    expect(edgeGap).toBeGreaterThanOrEqual(2);
    expect(edgeGap).toBeLessThanOrEqual(3);
    expect(leftEndpoint.x).toBe(Math.round(leftEndpoint.x));
    expect(leftEndpoint.y).toBe(Math.round(leftEndpoint.y));
  });

  it('snaps cut endpoints to the whole-pixel grid after independent transforms', () => {
    const model = input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)));
    model.subjectTransform = { scale: 0.8, offsetX: 1, offsetY: 0, pivotX: 12, pivotY: 12 };
    model.modifierTransform = { scale: 0.6, offsetX: 1, offsetY: 0, pivotX: 12, pivotY: 12 };
    const result = composeIcon(model);
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(24, 24));
    const cutPaths = parseLucideSvg(scope, result.svg).slice(0, result.subjectPaths.length);
    expect(cutPaths).toHaveLength(2);
    for (const endpoint of [cutPaths[0].lastSegment.point, cutPaths[1].firstSegment.point]) {
      expect(endpoint.x).toBe(Math.round(endpoint.x));
      expect(endpoint.y).toBe(Math.round(endpoint.y));
    }
    assertVisibleGap(result, 2);
  });

  it('snaps curved cut endpoints without breaking the requested stroke clearance', () => {
    const result = composeIcon(input(svg('<path d="M2 12 Q12 2 22 12"/>'), svg(line(12, 2, 12, 22))));
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(24, 24));
    const parts = parseLucideSvg(scope, result.svg).slice(0, result.subjectPaths.length);
    expect(parts).toHaveLength(2);
    for (const point of [parts[0].lastSegment.point, parts[1].firstSegment.point]) {
      expect(point.x).toBe(Math.round(point.x));
      expect(point.y).toBe(Math.round(point.y));
    }
    assertVisibleGap(result, 2);
  });

  it('removes tiny fragments and fully covered paths', () => {
    const result = composeIcon(input(svg(line(10, 12, 14, 12)), svg(line(12, 2, 12, 22))));
    expect(result.subjectPaths).toHaveLength(0);
    expect(result.warnings.some(warning => warning.includes('entire subject'))).toBe(true);
  });

  it('leaves the subject untouched when the modifier is outside it', () => {
    const model = input(svg(line(3, 12, 12, 12)), svg(line(12, 2, 12, 22)));
    model.placement.offsetX = 25;
    const result = composeIcon(model);
    expect(result.subjectPaths).toHaveLength(1);
    expect(result.subjectPaths[0]).toContain('M3,12');
  });

  it('accepts zero clearance and recomputes when the modifier moves', () => {
    const model = input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)), 0);
    const first = composeIcon(model);
    assertVisibleGap(first, 0);
    model.placement.offsetX = 2;
    const moved = composeIcon(model);
    expect(moved.svg).not.toBe(first.svg);
    assertVisibleGap(moved, 0);
  });

  it('recomputes a scaled modifier without changing its exported stroke width', () => {
    const model = input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)), 1.5);
    const full = composeIcon(model);
    model.placement.scale = 0.5;
    const scaled = composeIcon(model);
    expect(scaled.svg).not.toBe(full.svg);
    expect(scaled.svg).toContain('stroke-width="2"');
    expect(scaled.modifierBounds?.height).toBeCloseTo((full.modifierBounds?.height ?? 0) / 2, 3);
    assertVisibleGap(scaled, 1.5);
  });

  it('scales subject geometry around its pivot while preserving the 2-unit stroke', () => {
    const model = input(svg(line(4, 12, 20, 12)), svg(line(12, 4, 12, 20)));
    model.modifierSvg = null;
    model.subjectTransform = { scale: 0.5, offsetX: 2, offsetY: -1, pivotX: 12, pivotY: 12 };
    const result = composeIcon(model);
    expect(result.svg).toContain('stroke-width="2"');
    expect(result.svg).not.toContain('<g');
    expect(result.subjectPaths[0]).toContain('M10,11');
    expect(result.subjectBounds?.width).toBeCloseTo(8);
    expect(model.subjectSvg).toContain('x1="4"');
  });

  it('transforms both elements before cutting and keeps the final visible gap', () => {
    const model = input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)));
    model.subjectTransform = { scale: 0.8, offsetX: 1, offsetY: -1, pivotX: 12, pivotY: 12 };
    model.modifierTransform = { scale: 0.6, offsetX: 3, offsetY: 0.5, pivotX: 12, pivotY: 12 };
    const result = composeIcon(model);
    expect(result.subjectPaths.length).toBeGreaterThan(1);
    expect(result.modifierBounds?.height).toBeCloseTo(12);
    assertVisibleGap(result, 2);
    expect(composeIcon(model).svg).toBe(result.svg);
  });

  it('keeps the temporary drag preview stroke-aware without changing exact output', () => {
    const model = input(svg(line(2, 12, 22, 12)), svg(line(12, 2, 12, 22)));
    const exact = composeIcon(model);
    const preview = composeIcon(model, { preview: true });
    assertVisibleGap(preview, 2);
    expect(composeIcon(model).svg).toBe(exact.svg);
  });

  it('preserves original Lucide round dots made from tiny paths and coincident lines', () => {
    const model = input(subjects.file, svg(line(2, 2, 2, 2)));
    model.modifierSvg = null;
    const tiny = svg('<path d="M6 8h.01"/><line x1="12" y1="16" x2="12" y2="16"/>');
    model.subjectSvg = tiny;
    const result = composeIcon(model);
    expect(result.subjectPaths).toHaveLength(2);
    expect(result.svg).toContain('stroke-width="2"');
  });

  it('is deterministic and exports only minimal stroke paths', () => {
    const model = input(subjects.file, modifiers.plus);
    model.placement.anchor = 'bottom-right';
    model.placement.scale = 0.45;
    const first = composeIcon(model);
    expect(composeIcon(model).svg).toBe(first.svg);
    expect(first.svg).toMatch(/viewBox="0 0 24 24"/);
    expect(first.svg).toMatch(/stroke-width="2"/);
    expect(first.svg).not.toMatch(/<(mask|clipPath|filter|image|rect|circle|line|g)\b/i);
    assertVisibleGap(first, 2);
  });

  it.each([
    ['folder + check', subjects.folder, modifiers.check],
    ['user-round + minus', subjects['user-round'], modifiers.minus],
    ['calendar + pencil', subjects.calendar, modifiers.pencil],
  ])('composes real Lucide %s', (_name, subjectSvg, modifierSvg) => {
    const model = input(subjectSvg, modifierSvg);
    model.placement.anchor = 'bottom-right';
    model.placement.scale = 0.46;
    const result = composeIcon(model);
    expect(result.subjectPaths.length).toBeGreaterThan(0);
    assertVisibleGap(result, 2);
  });

  it('rejects unsupported external SVG content', () => {
    expect(() => composeIcon(input(svg('<image href="x.png"/>'), svg(line(2, 2, 20, 20))))).toThrow('Unsupported SVG element');
  });
});
