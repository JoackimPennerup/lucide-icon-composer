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
    expect(edgeGap).toBeLessThan(2.04);
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
