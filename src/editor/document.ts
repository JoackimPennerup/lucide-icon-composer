import paper from 'paper';
import { DEFAULT_SUBJECT_TRANSFORM, parseLucideSvg, type Anchor, type CompositionInput, type ElementTransform } from '../engine/compose';

export interface IconSource { name: string; svg: string }
export interface CompositionDocument {
  version: 4;
  lucideVersion: string;
  subject: IconSource;
  modifier: IconSource | null;
  subjectTransform: ElementTransform;
  modifierTransform: ElementTransform;
  modifierAnchor: Anchor;
  clearance: number;
  mode: 'cutout';
}

const anchors: Anchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
export const anchorPositions: Record<Anchor, { x: number; y: number }> = {
  'top-left': { x: 6, y: 6 }, 'top-right': { x: 18, y: 6 },
  'bottom-left': { x: 6, y: 18 }, 'bottom-right': { x: 18, y: 18 }, center: { x: 12, y: 12 },
};

export function transformPosition(transform: ElementTransform) {
  return { x: transform.pivotX + transform.offsetX, y: transform.pivotY + transform.offsetY };
}

export function withPosition(transform: ElementTransform, position: { x: number; y: number }): ElementTransform {
  return { ...transform, offsetX: position.x - transform.pivotX, offsetY: position.y - transform.pivotY };
}

function sourceCenter(svg: string) {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  const paths = parseLucideSvg(scope, svg);
  const bounds = paths.reduce((all, path) => all.unite(path.bounds), paths[0].bounds.clone());
  return bounds.center;
}

export function defaultModifierTransform(svg: string, position = { x: 18, y: 18 }, scale = 0.45): ElementTransform {
  const center = sourceCenter(svg);
  return { scale, pivotX: center.x, pivotY: center.y, offsetX: position.x - center.x, offsetY: position.y - center.y };
}

export function toCompositionInput(document: CompositionDocument): CompositionInput {
  return {
    subjectSvg: document.subject.svg,
    modifierSvg: document.modifier?.svg ?? null,
    placement: { anchor: 'center', offsetX: 0, offsetY: 0, scale: 1 },
    subjectTransform: document.subjectTransform,
    modifierTransform: document.modifierTransform,
    composition: { mode: document.mode, clearance: document.clearance },
  };
}

export function serializeDocument(document: CompositionDocument): string { return JSON.stringify(document, null, 2); }

function icon(value: unknown, label: string): IconSource {
  if (!value || typeof value !== 'object') throw new Error(`${label} icon is missing.`);
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 100 || typeof candidate.svg !== 'string') {
    throw new Error(`${label} icon needs a name and SVG source.`);
  }
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(24, 24));
  try {
    const paths = parseLucideSvg(scope, candidate.svg);
    if (paths.some(path => !Number.isFinite(path.length) || path.length < 1e-6)) throw new Error('Geometry contains a degenerate path.');
  } catch (error) { throw new Error(`${label} SVG is unsupported: ${error instanceof Error ? error.message : 'invalid geometry'}`); }
  return { name: candidate.name, svg: candidate.svg };
}

function transform(value: unknown, label: string): ElementTransform {
  if (!value || typeof value !== 'object') throw new Error(`${label} transform is missing.`);
  const item = value as Record<string, unknown>;
  const keys = ['scale', 'offsetX', 'offsetY', 'pivotX', 'pivotY'] as const;
  if (keys.some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]) || Math.abs(item[key] as number) > 1000) ||
      (item.scale as number) <= 0 || (item.scale as number) > 3) throw new Error(`${label} transform is invalid.`);
  return Object.fromEntries(keys.map(key => [key, item[key]])) as unknown as ElementTransform;
}

/** Parses untrusted project files into a fresh, allowlisted declarative model. */
export function parseDocument(json: string): CompositionDocument {
  if (json.length > 300_000) throw new Error('Composition JSON is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Composition is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Composition JSON must contain an object.');
  const value = parsed as Record<string, unknown>;
  if (typeof value.version !== 'number' || ![1, 2, 3, 4].includes(value.version)) throw new Error('Unsupported composition schema version.');
  const version = value.version;
  const clearance = value.clearance;
  if (typeof clearance !== 'number' || !Number.isFinite(clearance) || clearance < 0 || clearance > 4) throw new Error('Invalid clearance.');
  if (version !== 1 && value.mode !== 'cutout') throw new Error('Unsupported composition mode.');
  if (version >= 3 && (typeof value.lucideVersion !== 'string' || !value.lucideVersion.trim() || value.lucideVersion.length > 32)) {
    throw new Error('Composition Lucide version is missing.');
  }
  const subject = icon(value.subject, 'Subject');
  const modifier = value.modifier === null ? null : icon(value.modifier, 'Modifier');
  let subjectTransform: ElementTransform;
  let modifierTransform: ElementTransform;
  let modifierAnchor: Anchor;
  if (version === 4) {
    subjectTransform = transform(value.subjectTransform, 'Subject');
    modifierTransform = transform(value.modifierTransform, 'Modifier');
    modifierAnchor = value.modifierAnchor as Anchor;
  } else {
    const placement = value.placement as Record<string, unknown> | undefined;
    if (!placement || ![placement.x, placement.y, placement.scale].every(item => typeof item === 'number' && Number.isFinite(item)) ||
        Math.abs(placement.x as number) > 1000 || Math.abs(placement.y as number) > 1000 ||
        (placement.scale as number) <= 0 || (placement.scale as number) > 3) throw new Error('Invalid legacy placement.');
    modifierAnchor = (version === 1 ? 'bottom-right' : placement.anchor) as Anchor;
    subjectTransform = { ...DEFAULT_SUBJECT_TRANSFORM };
    modifierTransform = defaultModifierTransform((modifier ?? subject).svg,
      { x: placement.x as number, y: placement.y as number }, placement.scale as number);
  }
  if (!anchors.includes(modifierAnchor)) throw new Error('Unsupported placement anchor.');
  return { version: 4, lucideVersion: version >= 3 ? value.lucideVersion as string : 'unknown',
    subject, modifier, subjectTransform, modifierTransform, modifierAnchor, clearance, mode: 'cutout' };
}
