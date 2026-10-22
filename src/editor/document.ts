import paper from 'paper';
import { parseLucideSvg, type Anchor, type CompositionInput } from '../engine/compose';

export interface IconSource { name: string; svg: string }
export interface CompositionDocument {
  version: 3;
  lucideVersion: string;
  subject: IconSource;
  modifier: IconSource | null;
  placement: { anchor: Anchor; x: number; y: number; scale: number };
  clearance: number;
  mode: 'cutout';
}

const anchors: Anchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
export const anchorPositions: Record<Anchor, { x: number; y: number }> = {
  'top-left': { x: 6, y: 6 }, 'top-right': { x: 18, y: 6 },
  'bottom-left': { x: 6, y: 18 }, 'bottom-right': { x: 18, y: 18 }, center: { x: 12, y: 12 },
};

export function toCompositionInput(document: CompositionDocument): CompositionInput {
  return {
    subjectSvg: document.subject.svg,
    modifierSvg: document.modifier?.svg ?? null,
    placement: { anchor: 'center', offsetX: document.placement.x - 12, offsetY: document.placement.y - 12, scale: document.placement.scale },
    composition: { mode: document.mode, clearance: document.clearance },
  };
}

export function serializeDocument(document: CompositionDocument): string {
  return JSON.stringify(document, null, 2);
}

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
    if (paths.some(path => !Number.isFinite(path.length) || path.length < 1e-6)) {
      throw new Error('Geometry contains a degenerate path.');
    }
  }
  catch (error) { throw new Error(`${label} SVG is unsupported: ${error instanceof Error ? error.message : 'invalid geometry'}`); }
  return { name: candidate.name, svg: candidate.svg };
}

/** Parses untrusted project files into a fresh, allowlisted declarative model. */
export function parseDocument(json: string): CompositionDocument {
  if (json.length > 300_000) throw new Error('Composition JSON is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Composition is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Composition JSON must contain an object.');
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new Error('Unsupported composition schema version.');
  const placement = value.placement as Record<string, unknown> | undefined;
  if (!placement) throw new Error('Composition placement is missing.');
  const { x, y, scale } = placement;
  const clearance = value.clearance;
  if (![x, y, scale, clearance].every(item => typeof item === 'number' && Number.isFinite(item)) ||
      Math.abs(x as number) > 1000 || Math.abs(y as number) > 1000 ||
      (scale as number) <= 0 || (scale as number) > 3 ||
      (clearance as number) < 0 || (clearance as number) > 4) {
    throw new Error('Composition has invalid position, scale, or clearance.');
  }
  const anchor = value.version === 1 ? 'bottom-right' : placement.anchor;
  if (!anchors.includes(anchor as Anchor)) throw new Error('Unsupported placement anchor.');
  if (value.version !== 1 && value.mode !== 'cutout') throw new Error('Unsupported composition mode.');
  if (value.version === 3 && (typeof value.lucideVersion !== 'string' || !value.lucideVersion.trim() || value.lucideVersion.length > 32)) {
    throw new Error('Composition Lucide version is missing.');
  }
  return {
    version: 3,
    lucideVersion: value.version === 3 ? value.lucideVersion as string : 'unknown',
    subject: icon(value.subject, 'Subject'),
    modifier: value.modifier === null ? null : icon(value.modifier, 'Modifier'),
    placement: { anchor: anchor as Anchor, x: x as number, y: y as number, scale: scale as number },
    clearance: clearance as number,
    mode: 'cutout',
  };
}
