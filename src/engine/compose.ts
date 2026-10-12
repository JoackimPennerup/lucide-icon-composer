import paper from 'paper';

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export type CompositionMode = 'cutout' | 'overlay' | 'replace';

export interface CompositionInput {
  subjectSvg: string;
  modifierSvg: string;
  placement: { anchor: Anchor; offsetX: number; offsetY: number; scale: number };
  composition: { mode: CompositionMode; clearance: number };
}

export interface CompositionResult {
  svg: string;
  subjectSvg: string;
  modifierSvg: string;
  exclusionSvg: string;
  subjectPaths: string[];
  modifierPaths: string[];
  exclusionRadius: number;
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

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[match[1]] = match[3];
  return attrs;
}

/** Parses the untransformed, stroke-only primitives used by Lucide. */
export function parseLucideSvg(scope: Scope, svg: string): Path[] {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new Error('Expected an SVG root element.');
  const rootAttrs = parseAttributes(root[1]);
  if (rootAttrs.viewBox && rootAttrs.viewBox.trim().replace(/[\s,]+/g, ' ') !== '0 0 24 24') {
    throw new Error('Only a 0 0 24 24 viewBox is supported.');
  }
  if (rootAttrs['stroke-width'] && Number(rootAttrs['stroke-width']) !== STROKE_WIDTH) {
    throw new Error('Only 2px source strokes are supported.');
  }
  if (/\btransform\s*=|\bstroke-dasharray\s*=/i.test(svg)) {
    throw new Error('Transforms and dashed strokes are not yet supported.');
  }
  if (/<(?:script|foreignObject|image|use|mask|clipPath|filter)\b/i.test(svg)) {
    throw new Error('Unsupported SVG element. Only stroke-based Lucide primitives are accepted.');
  }
  const paths: Path[] = [];
  for (const match of svg.matchAll(/<(path|line|circle|ellipse|rect|polyline|polygon)\b([^>]*)\/?\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2]);
    if (attrs.transform) throw new Error('SVG transforms are not yet supported.');
    let path: Path;
    switch (tag) {
      case 'path': {
        const d = attrs.d;
        if (!d) continue;
        const compound = new scope.CompoundPath({ pathData: d, insert: false });
        for (const child of [...compound.children]) {
          const detached = child.clone({ insert: false }) as Path;
          paths.push(detached);
        }
        continue;
      }
      case 'line':
        path = new scope.Path.Line({
          from: [numberAttr(attrs, 'x1'), numberAttr(attrs, 'y1')],
          to: [numberAttr(attrs, 'x2'), numberAttr(attrs, 'y2')], insert: false,
        });
        break;
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

function safeIntervals(path: Path, modifiers: Path[], radius: number): [number, number][] {
  const length = path.length;
  if (length <= MIN_FRAGMENT) return [];
  const count = Math.max(1, Math.ceil(length / SAMPLE_STEP));
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

function anchorPoint(scope: Scope, anchor: Anchor): paper.Point {
  const positions: Record<Anchor, [number, number]> = {
    'top-left': [6, 6], 'top-right': [18, 6],
    'bottom-left': [6, 18], 'bottom-right': [18, 18], center: [12, 12],
  };
  return new scope.Point(...positions[anchor]);
}

/** Pure input/output composition; PaperScope and all geometry are local to each call. */
export function composeIcon(input: CompositionInput): CompositionResult {
  const { placement, composition } = input;
  if (!Number.isFinite(placement.scale) || placement.scale <= 0 || placement.scale > 3) throw new Error('Scale must be between 0 and 3.');
  if (!Number.isFinite(composition.clearance) || composition.clearance < 0 || composition.clearance > 4) throw new Error('Clearance must be between 0 and 4.');
  if (!Number.isFinite(placement.offsetX) || !Number.isFinite(placement.offsetY)) throw new Error('Offsets must be finite.');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  const subject = parseLucideSvg(scope, input.subjectSvg);
  const modifier = parseLucideSvg(scope, input.modifierSvg);
  const bounds = modifier.reduce((all, path) => all.unite(path.bounds), modifier[0].bounds.clone());
  const target = anchorPoint(scope, placement.anchor).add(new scope.Point(placement.offsetX, placement.offsetY));
  for (const path of modifier) {
    path.scale(placement.scale, bounds.center);
    path.translate(target.subtract(bounds.center));
  }

  const warnings: string[] = [];
  const outputSubject: Path[] = [];
  // A round stroke is the union of radius-(width / 2) discs along its
  // centerline, including at newly cut endpoints. The two stroke radii are
  // therefore counted once each when turning visible edge gap into a
  // centerline distance. A small margin covers sampling and path rounding.
  const exclusionRadius = STROKE_WIDTH / 2 + STROKE_WIDTH / 2 + composition.clearance + NUMERICAL_MARGIN;
  if (composition.mode === 'replace') throw new Error('Replace mode is reserved for a future version.');
  if (composition.mode === 'overlay') outputSubject.push(...subject);
  else {
    for (const path of subject) {
      const intervals = safeIntervals(path, modifier, exclusionRadius);
      for (const [start, end] of intervals) {
        const piece = extractInterval(path, start, end);
        if (piece && piece.length >= MIN_FRAGMENT) outputSubject.push(piece);
      }
    }
  }
  if (outputSubject.length === 0) warnings.push('The modifier removes the entire subject. Try a smaller scale or another placement.');
  const allPaths = [...outputSubject, ...modifier];
  const allBounds = allPaths.reduce((all, path) => all.unite(path.bounds), allPaths[0].bounds.clone());
  if (allBounds.left < 2 - NUMERICAL_MARGIN || allBounds.top < 2 - NUMERICAL_MARGIN ||
      allBounds.right > 22 + NUMERICAL_MARGIN || allBounds.bottom > 22 + NUMERICAL_MARGIN) {
    warnings.push('A stroke may extend outside the 1px canvas safe zone.');
  }
  if (composition.clearance < 2) warnings.push('Lucide normally uses at least 2px between distinct elements.');
  const exclusionSvg = pathMarkup(modifier, exclusionRadius * 2);
  return {
    svg: pathMarkup(allPaths),
    subjectSvg: pathMarkup(subject),
    modifierSvg: pathMarkup(modifier),
    exclusionSvg,
    subjectPaths: outputSubject.map(path => path.pathData),
    modifierPaths: modifier.map(path => path.pathData),
    exclusionRadius,
    warnings,
  };
}
