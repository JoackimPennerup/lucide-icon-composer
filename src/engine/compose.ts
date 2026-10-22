import paper from 'paper';
import { parseStrictSvg } from './strictSvg';
import { normalizePathData } from './pathData';

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export type CompositionMode = 'cutout' | 'overlay' | 'replace';
export interface ElementTransform { scale: number; offsetX: number; offsetY: number; pivotX: number; pivotY: number }
export const DEFAULT_SUBJECT_TRANSFORM: ElementTransform = { scale: 1, offsetX: 0, offsetY: 0, pivotX: 12, pivotY: 12 };

export interface CompositionInput {
  subjectSvg: string;
  modifierSvg: string | null;
  /** Legacy modifier placement, retained for existing callers. */
  placement: { anchor: Anchor; offsetX: number; offsetY: number; scale: number };
  subjectTransform?: ElementTransform;
  modifierTransform?: ElementTransform;
  composition: { mode: CompositionMode; clearance: number };
}

export interface CompositionResult {
  svg: string;
  subjectSvg: string;
  modifierSvg: string;
  exclusionSvg: string;
  originalSubjectPaths: string[];
  subjectPaths: string[];
  modifierPaths: string[];
  exclusionRadius: number;
  modifierBounds: { x: number; y: number; width: number; height: number } | null;
  subjectBounds: { x: number; y: number; width: number; height: number } | null;
  transformedSubjectLength: number;
  warnings: string[];
}

const STROKE_WIDTH = 2;
const SAMPLE_STEP = 0.025;
const BOUNDARY_TOLERANCE = 0.0001;
const MIN_FRAGMENT = 0.18;
const NUMERICAL_MARGIN = 0.015;
type Scope = paper.PaperScope;
type Path = paper.Path;

function numberAttr(attrs: Record<string, string>, name: string, fallback = 0): number {
  const value = Number(attrs[name]);
  return Number.isFinite(value) ? value : fallback;
}

/** Parses the untransformed, stroke-only primitives used by Lucide. */
export function parseLucideSvg(scope: Scope, svg: string): Path[] {
  const paths: Path[] = [];
  for (const { tag, attrs } of parseStrictSvg(svg)) {
    let path: Path;
    switch (tag) {
      case 'path': {
        const d = attrs.d;
        if (!d) continue;
        const compound = new scope.CompoundPath({ pathData: normalizePathData(d), insert: false });
        for (const child of [...compound.children]) {
          const detached = child.clone({ insert: false }) as Path;
          paths.push(detached);
        }
        continue;
      }
      case 'line': {
        const x1 = numberAttr(attrs, 'x1');
        const y1 = numberAttr(attrs, 'y1');
        const x2 = numberAttr(attrs, 'x2');
        const y2 = numberAttr(attrs, 'y2');
        // Lucide uses coincident line endpoints for round dots. Paper needs a
        // nonzero centerline to retain and export them; 0.01px is imperceptible.
        path = new scope.Path.Line({
          from: [x1, y1], to: x1 === x2 && y1 === y2 ? [x1 + 0.01, y1] : [x2, y2], insert: false,
        });
        break;
      }
      case 'circle':
        path = new scope.Path.Circle({ center: [numberAttr(attrs, 'cx'), numberAttr(attrs, 'cy')], radius: numberAttr(attrs, 'r'), insert: false });
        break;
      case 'ellipse':
        path = new scope.Path.Ellipse({ rectangle: new scope.Rectangle(
          numberAttr(attrs, 'cx') - numberAttr(attrs, 'rx'), numberAttr(attrs, 'cy') - numberAttr(attrs, 'ry'),
          numberAttr(attrs, 'rx') * 2, numberAttr(attrs, 'ry') * 2,
        ), insert: false });
        break;
      case 'rect': {
        const rectangle = new scope.Rectangle(numberAttr(attrs, 'x'), numberAttr(attrs, 'y'), numberAttr(attrs, 'width'), numberAttr(attrs, 'height'));
        const rx = numberAttr(attrs, 'rx');
        const ry = numberAttr(attrs, 'ry', rx);
        path = new scope.Path.Rectangle({ rectangle, radius: new scope.Size(rx, ry), insert: false });
        break;
      }
      default: {
        const points = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
        if (points.length < 4 || points.length % 2 !== 0 || points.some(v => !Number.isFinite(v))) {
          throw new Error(`Invalid ${tag} points.`);
        }
        path = new scope.Path({ insert: false });
        for (let i = 0; i < points.length; i += 2) path.add(new scope.Point(points[i], points[i + 1]));
        path.closed = tag === 'polygon';
      }
    }
    paths.push(path);
  }
  if (paths.length === 0) throw new Error('SVG has no supported geometry.');
  return paths;
}

function pathMarkup(paths: Path[], stroke = STROKE_WIDTH): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths.map(path => `<path d="${path.pathData}"/>`).join('')}</svg>`;
}

function distanceToModifier(point: paper.Point, modifiers: Path[]): number {
  let closest = Infinity;
  for (const modifier of modifiers) {
    const nearest = modifier.getNearestPoint(point);
    if (nearest) closest = Math.min(closest, point.getDistance(nearest));
  }
  return closest;
}

function pointAt(path: Path, offset: number): paper.Point {
  return path.getPointAt(Math.max(0, Math.min(offset, path.length - 1e-7))) ?? path.lastSegment.point;
}

function boundary(path: Path, modifiers: Path[], radius: number, a: number, b: number, aSafe: boolean): number {
  for (let i = 0; i < 24 && b - a > BOUNDARY_TOLERANCE; i++) {
    const mid = (a + b) / 2;
    const safe = distanceToModifier(pointAt(path, mid), modifiers) >= radius;
    if (safe === aSafe) a = mid;
    else b = mid;
  }
  // Pick the safe side. This makes any bisection error increase the gap.
  return aSafe ? a : b;
}

function safeIntervals(path: Path, modifiers: Path[], radius: number, sampleStep = SAMPLE_STEP): [number, number][] {
  const length = path.length;
  // Lucide uses 0.01px centerline strokes as visible round dots. Preserve an
  // intact source dot unless it falls within the modifier's exclusion area.
  if (length <= MIN_FRAGMENT) {
    const safe = distanceToModifier(pointAt(path, length / 2), modifiers) >= radius + length / 2;
    return safe ? [[0, length]] : [];
  }
  const count = Math.max(1, Math.ceil(length / sampleStep));
  const intervals: [number, number][] = [];
  let previousOffset = 0;
  let previousSafe = distanceToModifier(pointAt(path, 0), modifiers) >= radius;
  let start = previousSafe ? 0 : -1;
  for (let i = 1; i <= count; i++) {
    const offset = length * i / count;
    const safe = distanceToModifier(pointAt(path, offset), modifiers) >= radius;
    if (safe !== previousSafe) {
      const crossing = boundary(path, modifiers, radius, previousOffset, offset, previousSafe);
      if (previousSafe) intervals.push([start, crossing]);
      else start = crossing;
    }
    previousOffset = offset;
    previousSafe = safe;
  }
  if (previousSafe) intervals.push([start, length]);
  return intervals.filter(([a, b]) => b - a >= MIN_FRAGMENT);
}

function extractInterval(path: Path, start: number, end: number): Path | null {
  const copy = path.clone({ insert: false }) as Path;
  if (start <= BOUNDARY_TOLERANCE && end >= path.length - BOUNDARY_TOLERANCE) return copy;
  if (copy.closed) {
    // Split a closed curve at the interval start, rotating its seam to that point.
    copy.splitAt(start);
    copy.closed = false;
    if (end - start < copy.length - BOUNDARY_TOLERANCE) copy.splitAt(end - start);
    return copy;
  }
  if (end < copy.length - BOUNDARY_TOLERANCE) copy.splitAt(end);
  if (start > BOUNDARY_TOLERANCE) return copy.splitAt(start) as Path;
  return copy;
}

function wholePixelPoint(point: paper.Point): paper.Point {
  return new paper.Point(Math.round(point.x), Math.round(point.y));
}

/** Retreats into a safe interval until rounding the endpoint cannot close the visible gap. */
function snappedBoundary(path: Path, modifiers: Path[], radius: number, offset: number, direction: 1 | -1, limit: number): number | null {
  const maxRetreat = Math.min(2.5, limit);
  for (let retreat = 0; retreat <= maxRetreat + 1e-8; retreat += 0.05) {
    const candidate = offset + direction * retreat;
    const point = pointAt(path, candidate);
    const snapped = wholePixelPoint(point);
    if (distanceToModifier(snapped, modifiers) >= radius + 0.02) return candidate;
  }
  return null;
}

function snappedInterval(path: Path, modifiers: Path[], radius: number, start: number, end: number, sampleStep: number): Path | null {
  const cutStart = start > BOUNDARY_TOLERANCE;
  const cutEnd = end < path.length - BOUNDARY_TOLERANCE;
  if (!cutStart && !cutEnd) return extractInterval(path, start, end);
  let from = cutStart ? snappedBoundary(path, modifiers, radius, start, 1, end - start) : start;
  let to = cutEnd ? snappedBoundary(path, modifiers, radius, end, -1, end - start) : end;
  if (from === null || to === null) return null;
  for (let attempt = 0; attempt < 24 && to - from >= MIN_FRAGMENT; attempt++) {
    const piece = extractInterval(path, from, to);
    if (!piece) return null;
    if (cutStart) piece.firstSegment.point = wholePixelPoint(piece.firstSegment.point);
    if (cutEnd) piece.lastSegment.point = wholePixelPoint(piece.lastSegment.point);
    const count = Math.max(1, Math.ceil(piece.length / sampleStep));
    let safe = true;
    for (let i = 0; i <= count; i++) {
      if (distanceToModifier(pointAt(piece, piece.length * i / count), modifiers) < radius - 0.001) { safe = false; break; }
    }
    if (safe && piece.length >= MIN_FRAGMENT) return piece;
    if (cutStart) from = Math.min(from + 0.1, end);
    if (cutEnd) to = Math.max(to - 0.1, start);
  }
  return null;
}

function anchorPoint(scope: Scope, anchor: Anchor): paper.Point {
  const positions: Record<Anchor, [number, number]> = {
    'top-left': [6, 6], 'top-right': [18, 6],
    'bottom-left': [6, 18], 'bottom-right': [18, 18], center: [12, 12],
  };
  return new scope.Point(...positions[anchor]);
}

function applyElementTransform(scope: Scope, paths: Path[], transform: ElementTransform): void {
  if (![transform.scale, transform.offsetX, transform.offsetY, transform.pivotX, transform.pivotY].every(Number.isFinite) ||
      transform.scale <= 0 || transform.scale > 3 || Math.abs(transform.offsetX) > 1000 || Math.abs(transform.offsetY) > 1000 ||
      Math.abs(transform.pivotX) > 1000 || Math.abs(transform.pivotY) > 1000) throw new Error('Invalid element transform.');
  const pivot = new scope.Point(transform.pivotX, transform.pivotY);
  const offset = new scope.Point(transform.offsetX, transform.offsetY);
  for (const path of paths) {
    // These paths have no Paper stroke style. Only their centerlines are scaled;
    // pathMarkup supplies the final, constant 2-unit SVG stroke.
    path.scale(transform.scale, pivot);
    path.translate(offset);
  }
}

function boundsOf(paths: Path[]) {
  if (!paths.length) return null;
  const bounds = paths.reduce((all, path) => all.unite(path.bounds), paths[0].bounds.clone());
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** Pure input/output composition; PaperScope and all geometry are local to each call. */
export function composeIcon(input: CompositionInput, options: { preview?: boolean } = {}): CompositionResult {
  const { composition } = input;
  if (!Number.isFinite(composition.clearance) || composition.clearance < 0 || composition.clearance > 4) throw new Error('Clearance must be between 0 and 4.');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  const subject = parseLucideSvg(scope, input.subjectSvg);
  const modifier = input.modifierSvg ? parseLucideSvg(scope, input.modifierSvg) : [];
  applyElementTransform(scope, subject, input.subjectTransform ?? DEFAULT_SUBJECT_TRANSFORM);
  const transformedSubjectLength = subject.reduce((total, path) => total + path.length, 0);
  const subjectBounds = boundsOf(subject);
  if (modifier.length && input.modifierTransform) applyElementTransform(scope, modifier, input.modifierTransform);
  else if (modifier.length && input.placement) {
    const placement = input.placement;
    if (!Number.isFinite(placement.scale) || placement.scale <= 0 || placement.scale > 3 ||
        !Number.isFinite(placement.offsetX) || !Number.isFinite(placement.offsetY)) throw new Error('Invalid modifier placement.');
    const bounds = modifier.reduce((all, path) => all.unite(path.bounds), modifier[0].bounds.clone());
    const target = anchorPoint(scope, placement.anchor).add(new scope.Point(placement.offsetX, placement.offsetY));
    applyElementTransform(scope, modifier, { scale: placement.scale, pivotX: bounds.center.x, pivotY: bounds.center.y,
      offsetX: target.x - bounds.center.x, offsetY: target.y - bounds.center.y });
  }

  const warnings: string[] = [];
  const outputSubject: Path[] = [];
  // A round stroke is the union of radius-(width / 2) discs along its
  // centerline, including at newly cut endpoints. The two stroke radii are
  // therefore counted once each when turning visible edge gap into a
  // centerline distance. A small margin covers sampling and path rounding.
  // A wider sample and matching radius margin keep pointer previews responsive.
  // Every committed result and SVG export use the precise defaults above.
  const sampleStep = options.preview ? 0.25 : SAMPLE_STEP;
  const margin = options.preview ? 0.14 : NUMERICAL_MARGIN;
  const exclusionRadius = STROKE_WIDTH / 2 + STROKE_WIDTH / 2 + composition.clearance + margin;
  if (composition.mode === 'replace') throw new Error('Replace mode is reserved for a future version.');
  if (composition.mode === 'overlay') outputSubject.push(...subject);
  else {
    for (const path of subject) {
      const intervals = safeIntervals(path, modifier, exclusionRadius, sampleStep);
      for (const [start, end] of intervals) {
        const piece = snappedInterval(path, modifier, exclusionRadius, start, end, sampleStep);
        if (piece && (piece.length >= MIN_FRAGMENT || path.length <= MIN_FRAGMENT)) outputSubject.push(piece);
      }
    }
  }
  if (outputSubject.length === 0) warnings.push('The modifier removes the entire subject. Try a smaller scale or another placement.');
  const allPaths = [...outputSubject, ...modifier];
  const allBounds = allPaths.length ? allPaths.reduce((all, path) => all.unite(path.bounds), allPaths[0].bounds.clone()) : null;
  const modifierOutputBounds = boundsOf(modifier);
  if (allBounds && (allBounds.left < 2 - NUMERICAL_MARGIN || allBounds.top < 2 - NUMERICAL_MARGIN ||
      allBounds.right > 22 + NUMERICAL_MARGIN || allBounds.bottom > 22 + NUMERICAL_MARGIN)) {
    warnings.push('A stroke may extend outside the 1px canvas safe zone.');
  }
  if (modifier.length && composition.clearance < 2) warnings.push('Lucide normally uses at least 2px between distinct elements.');
  const exclusionSvg = pathMarkup(modifier, exclusionRadius * 2);
  return {
    svg: pathMarkup(allPaths),
    subjectSvg: pathMarkup(subject),
    modifierSvg: pathMarkup(modifier),
    exclusionSvg,
    originalSubjectPaths: subject.map(path => path.pathData),
    subjectPaths: outputSubject.map(path => path.pathData),
    modifierPaths: modifier.map(path => path.pathData),
    exclusionRadius,
    modifierBounds: modifierOutputBounds,
    subjectBounds,
    transformedSubjectLength,
    warnings,
  };
}
