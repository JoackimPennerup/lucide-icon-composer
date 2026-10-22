import paper from 'paper';
import { parseLucideSvg } from '../engine/compose';

/** Largest unscaled path extent; the fixed 2-unit stroke adds an integer span. */
export function sourceGeometrySpan(svg: string): number {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  const paths = parseLucideSvg(scope, svg);
  const bounds = paths.reduce((all, path) => all.unite(path.bounds), paths[0].bounds.clone());
  // Paper's Bézier bounds can differ from an exact Lucide integer by a few
  // millionths. Normalize that noise before deriving user-facing scale steps.
  return Math.round(Math.max(bounds.width, bounds.height) * 1000) / 1000;
}

/** Chooses the closest legal scale whose dominant geometry span is a whole unit. */
export function snapScaleToPixels(raw: number, span: number, min: number, max: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(span) || span <= 0) return raw;
  const smallest = Math.ceil(min * span - 1e-9);
  const largest = Math.floor(max * span + 1e-9);
  if (smallest > largest) return Math.max(min, Math.min(max, raw));
  const pixels = Math.max(smallest, Math.min(largest, Math.round(raw * span)));
  return pixels / span;
}

export function stepScaleByPixels(current: number, span: number, direction: -1 | 1, min: number, max: number, count = 1): number {
  if (!Number.isFinite(span) || span <= 0) return Math.max(min, Math.min(max, current));
  const pixels = Math.round(current * span) + direction * count;
  return snapScaleToPixels(pixels / span, span, min, max);
}
