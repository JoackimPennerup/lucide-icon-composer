import paper from 'paper';
import { parseLucideSvg, type CompositionInput, type CompositionResult } from './compose';
import { parseStrictSvg } from './strictSvg';

export type GuidelineLevel = 'error' | 'warning' | 'suggestion';
export type GeometryTarget = { layer: string; indices: number[] };
export interface GuidelineIssue {
  id: string;
  level: GuidelineLevel;
  title: string;
  explanation: string;
  target?: GeometryTarget;
}

export function validateSourceSvg(svg: string, label: string): GuidelineIssue[] {
  try {
    parseStrictSvg(svg);
    const scope = new paper.PaperScope();
    scope.setup(new scope.Size(24, 24));
    const paths = parseLucideSvg(scope, svg);
    if (paths.some(path => !Number.isFinite(path.length) || path.length < 1e-6)) throw new Error('Geometry contains a degenerate path.');
    return [];
  } catch (error) {
    return [{ id: `${label}-source`, level: 'error', title: `${label} SVG is unsupported`,
      explanation: error instanceof Error ? error.message : 'SVG source could not be parsed.' }];
  }
}

function nearestGap(subjects: paper.Path[], modifiers: paper.Path[]) {
  let best = { gap: Infinity, subject: -1 };
  subjects.forEach((subject, index) => {
    const count = Math.max(1, Math.ceil(subject.length / 0.05));
    for (let i = 0; i <= count; i++) {
      const point = subject.getPointAt(Math.max(0, Math.min(subject.length - 1e-7, subject.length * i / count))) ?? subject.lastSegment?.point;
      if (!point) continue;
      for (const modifier of modifiers) {
        const nearest = modifier.getNearestPoint(point);
        if (nearest) {
          const gap = point.getDistance(nearest) - 2; // two 1px stroke radii
          if (gap < best.gap) best = { gap, subject: index };
        }
      }
    }
  });
  return best;
}

/** Advisory checks never move the designer's geometry. */
export function validateComposition(input: CompositionInput, result: CompositionResult): GuidelineIssue[] {
  if (input.layers && result.layerPaths) return validateLayeredComposition(input, result);
  const issues = [...validateSourceSvg(input.subjectSvg, 'Subject')];
  if (input.modifierSvg) issues.push(...validateSourceSvg(input.modifierSvg, 'Modifier'));
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  let paths: paper.Path[];
  try { paths = parseLucideSvg(scope, result.svg); }
  catch (error) { return [...issues, { id: 'output', level: 'error', title: 'Invalid export SVG', explanation: error instanceof Error ? error.message : 'The output cannot be parsed.' }]; }
  const subjects = paths.slice(0, result.subjectPaths.length);
  const modifiers = paths.slice(result.subjectPaths.length);
  if (!subjects.length) issues.push({ id: 'subject-removed', level: 'warning', title: 'Subject entirely removed', explanation: 'Move or shrink the modifier to keep the subject recognizable.' });
  paths.forEach((path, index) => {
    const layer = index < subjects.length ? 'subject' : 'modifier';
    const pathIndex = layer === 'subject' ? index : index - subjects.length;
    const target: GeometryTarget = { layer, indices: [pathIndex] };
    if (!Number.isFinite(path.length) || path.length < 1e-6 || !Number.isFinite(path.bounds.x) || !Number.isFinite(path.bounds.y)) {
      issues.push({ id: `invalid-${index}`, level: 'error', title: 'Invalid path geometry', explanation: 'This output path has no usable length or non-finite coordinates.', target });
    } else if (layer === 'subject' && path.length < 0.75 && !result.originalSubjectPaths.includes(result.subjectPaths[pathIndex])) {
      issues.push({ id: `short-${index}`, level: 'warning', title: 'Tiny stroke fragment', explanation: `A ${path.length.toFixed(2)}px fragment may disappear at actual size.`, target });
    }
    if (path.bounds.left < 1 - 0.01 || path.bounds.top < 1 - 0.01 || path.bounds.right > 23 + 0.01 || path.bounds.bottom > 23 + 0.01) {
      issues.push({ id: `canvas-${index}`, level: 'warning', title: 'Stroke extends beyond the canvas', explanation: 'The final 2px stroke crosses the 24×24 canvas edge.', target });
    }
    if (path.bounds.left < 2 - 0.01 || path.bounds.top < 2 - 0.01 || path.bounds.right > 22 + 0.01 || path.bounds.bottom > 22 + 0.01) {
      issues.push({ id: `bounds-${index}`, level: 'warning', title: 'Stroke enters the safe zone', explanation: 'A 2px centered stroke should keep its centerline inside 2–22 for 1px of canvas padding.', target });
    }
  });
  const gap = nearestGap(subjects, modifiers);
  if (Number.isFinite(gap.gap) && gap.gap < 1.98) issues.push({ id: 'separation', level: 'warning', title: 'Less than 2px visible separation', explanation: `Closest measured subject–modifier gap is ${Math.max(0, gap.gap).toFixed(2)}px. Lucide recommends at least 2px.`, target: { layer: 'subject', indices: [gap.subject] } });
  if (result.modifierBounds) {
    const b = result.modifierBounds;
    const visibleWidth = Math.max(0, Math.min(24, b.x + b.width + 1) - Math.max(0, b.x - 1));
    const visibleHeight = Math.max(0, Math.min(24, b.y + b.height + 1) - Math.max(0, b.y - 1));
    const fraction = visibleWidth * visibleHeight / Math.max(0.01, (b.width + 2) * (b.height + 2));
    if (fraction < 0.05) issues.push({ id: 'modifier-outside', level: 'warning', title: 'Modifier is outside the canvas', explanation: 'Move the modifier back onto the 24×24 artboard.' });
    else if (fraction < 0.5) issues.push({ id: 'modifier-clipped', level: 'warning', title: 'Modifier is mostly off canvas', explanation: 'Much of the modifier will be clipped in the exported icon.' });
    if ((input.modifierTransform?.scale ?? input.placement?.scale ?? 1) < 0.25) issues.push({ id: 'small-modifier', level: 'suggestion', title: 'Modifier is very small', explanation: 'Review its weight at 16px and 24px before exporting.' });
  }
  try {
    const sourceScope = new paper.PaperScope();
    sourceScope.setup(new sourceScope.Size(24, 24));
    const source = parseLucideSvg(sourceScope, input.subjectSvg);
    const sourceLength = result.transformedSubjectLength;
    const remainingLength = subjects.reduce((sum, path) => sum + path.length, 0);
    if (sourceLength > 0 && remainingLength / sourceLength < 0.5) issues.push({ id: 'silhouette', level: 'suggestion', title: 'Much of the subject silhouette is gone', explanation: 'Check whether the subject remains recognizable at actual size.', target: { layer: 'subject', indices: subjects.map((_, index) => index) } });
    if (subjects.length > source.length + 2) issues.push({ id: 'disconnected', level: 'suggestion', title: 'Subject split into several pieces', explanation: 'Check that no small detail looks unintentionally detached.', target: { layer: 'subject', indices: subjects.map((_, index) => index) } });
  } catch { /* Source parse issues are already reported. */ }
  const scale = input.subjectTransform?.scale ?? 1;
  if (scale < 0.75) {
    const details = subjects.flatMap((path, index) => path.curves
      .filter(curve => curve.length > 0.01 && curve.length < 1.25)
      .map(() => index));
    if (details.length) issues.push({ id: 'small-details', level: 'suggestion', title: 'Subject details may be hard to read',
      explanation: 'Some transformed segments are shorter than 1.25px. Check the icon at 16px and 24px.',
      target: { layer: 'subject', indices: [...new Set(details)] } });
  }
  try {
    const primitiveCorner = parseStrictSvg(input.subjectSvg).some(({ tag, attrs }) =>
      (tag === 'rect' && ['rx', 'ry'].some(key => Number(attrs[key]) > 0 && Number(attrs[key]) * scale < 1)) ||
      (tag === 'circle' && Number(attrs.r) > 0 && Number(attrs.r) * scale < 1));
    const transformed = parseLucideSvg(scope, result.subjectSvg);
    const curvedCorner = transformed.some(path => path.curves.some(curve =>
      curve.length > 0.2 && (curve.handle1.length > 0.001 || curve.handle2.length > 0.001) &&
      [0.25, 0.5, 0.75].some(time => Math.abs(curve.getCurvatureAtTime(time)) > 1)));
    if (primitiveCorner || curvedCorner) issues.push({ id: 'small-corners', level: 'warning', title: 'Rounded corners are very small',
      explanation: 'A scaled radius is under 1 unit, smaller than the 2-unit stroke radius.' });
  } catch { /* Source errors are reported above. */ }
  const visibleLength = paths.reduce((sum, path) => sum + path.length, 0);
  if (visibleLength > 170) issues.push({ id: 'visual-density', level: 'suggestion', title: 'High visual density',
    explanation: 'Many stroke segments share the 24px canvas. Review the icon at actual size.' });
  return issues;
}

function validateLayeredComposition(input: CompositionInput, result: CompositionResult): GuidelineIssue[] {
  const issues: GuidelineIssue[] = [];
  for (const layer of input.layers ?? []) {
    if (layer.svg) issues.push(...validateSourceSvg(layer.svg, layer.id));
    for (const part of layer.parts ?? []) issues.push(...validateSourceSvg(part.svg, part.id));
  }
  issues.push(...validateSourceSvg(result.svg, 'Export'));
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
  const layerPaths = new Map<string, paper.Path[]>();
  for (const layer of input.layers ?? []) {
    const paths = (result.layerPaths?.[layer.id] ?? []).flatMap(d => parseLucideSvg(scope,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`));
    layerPaths.set(layer.id, paths);
    paths.forEach((path, index) => {
      const target = { layer: layer.id, indices: [index] };
      if (!Number.isFinite(path.length) || path.length < 1e-6) issues.push({ id: `invalid-${layer.id}-${index}`, level: 'error', title: 'Degenerate output path', explanation: 'The output path has no usable geometry.', target });
      else if (path.length < 0.75) issues.push({ id: `short-${layer.id}-${index}`, level: 'warning', title: 'Tiny stroke fragment', explanation: `A ${path.length.toFixed(2)}px fragment may disappear at actual size.`, target });
      if (path.bounds.left < 1 || path.bounds.top < 1 || path.bounds.right > 23 || path.bounds.bottom > 23)
        issues.push({ id: `canvas-${layer.id}-${index}`, level: 'warning', title: 'Stroke extends beyond canvas', explanation: 'A 2-unit stroke crosses the 24×24 canvas edge.', target });
      else if (path.bounds.left < 2 || path.bounds.top < 2 || path.bounds.right > 22 || path.bounds.bottom > 22)
        issues.push({ id: `safe-${layer.id}-${index}`, level: 'warning', title: 'Stroke enters safe zone', explanation: 'The centerline enters the recommended 2–22 bounds.', target });
    });
  }
  for (let upperIndex = 1; upperIndex < (input.layers?.length ?? 0); upperIndex++) {
    const upper = input.layers![upperIndex];
    if (!upper.visible || !upper.cutout) continue;
    const upperPaths = layerPaths.get(upper.id) ?? [];
    for (const lower of input.layers!.slice(0, upperIndex)) {
      const lowerPaths = layerPaths.get(lower.id) ?? [];
      if (!lower.visible || !lowerPaths.length || !upperPaths.length) continue;
      const gap = nearestGap(lowerPaths, upperPaths);
      if (gap.gap < input.composition.clearance - .03) issues.push({ id: `clearance-${lower.id}-${upper.id}`, level: 'warning',
        title: 'Visible clearance may be too small', explanation: `Measured gap between ${lower.id} and ${upper.id} is ${Math.max(0, gap.gap).toFixed(2)} units.` });
    }
  }
  const paths = [...layerPaths.values()].flat();
  const visibleLength = paths.reduce((sum, path) => sum + path.length, 0);
  if (visibleLength > 170) issues.push({ id: 'visual-density', level: 'suggestion', title: 'High visual density',
    explanation: 'Many stroke segments share the 24px canvas. Review the icon at actual size.' });
  return issues;
}
