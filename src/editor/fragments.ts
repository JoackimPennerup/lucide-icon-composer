import { parseStrictSvg } from '../engine/strictSvg';
import { type SourcePart } from './parts';
import { type ElementTransform } from '../engine/compose';

export interface SavedFragment { id: string; name: string; sourceName: string; sourceVersion: string;
  parts: (SourcePart & { transform?: ElementTransform })[]; groupTransform?: ElementTransform; grouped: boolean }
const key = 'lucide-icon-designer.fragments.v1';
function validTransform(value: unknown): value is ElementTransform {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['scale', 'offsetX', 'offsetY', 'pivotX', 'pivotY'].every(field => typeof item[field] === 'number' && Number.isFinite(item[field]) && Math.abs(item[field] as number) <= 1000) &&
    (item.scale as number) > 0 && (item.scale as number) <= 3;
}
export function parseFragments(json: string): SavedFragment[] {
  if (json.length > 2_000_000) throw new Error('Fragment file is too large.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Fragment file is not valid JSON.'); }
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid fragment library.');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid fragment.');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id) || ids.has(item.id) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 ||
      typeof item.sourceName !== 'string' || item.sourceName.length > 100 ||
      typeof item.sourceVersion !== 'string' || item.sourceVersion.length > 32 ||
      typeof item.grouped !== 'boolean' || !Array.isArray(item.parts) || !item.parts.length || item.parts.length > 200) throw new Error('Invalid fragment metadata.');
    if (item.groupTransform !== undefined && !validTransform(item.groupTransform)) throw new Error('Invalid fragment group transform.');
    ids.add(item.id);
    const parts: SourcePart[] = item.parts.map((rawPart: unknown) => {
      if (!rawPart || typeof rawPart !== 'object') throw new Error('Invalid fragment element.');
      const part = rawPart as Record<string, unknown>;
      if (typeof part.id !== 'string' || !part.id || part.id.length > 150 ||
        typeof part.label !== 'string' || part.label.length > 100 || typeof part.svg !== 'string' ||
        !['path', 'line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon'].includes(part.tag as string)) throw new Error('Invalid fragment element.');
      const parsed = parseStrictSvg(part.svg);
      if (parsed.length !== 1 || parsed[0].tag !== part.tag) throw new Error('Fragment element must contain one matching SVG primitive.');
      if (part.transform !== undefined && !validTransform(part.transform)) throw new Error('Invalid fragment element transform.');
      return { id: part.id, label: part.label, tag: part.tag as SourcePart['tag'], svg: part.svg,
        ...(part.transform ? { transform: part.transform } : {}) };
    });
    return { id: item.id, name: item.name, sourceName: item.sourceName, sourceVersion: item.sourceVersion,
      grouped: item.grouped, parts, ...(item.groupTransform ? { groupTransform: item.groupTransform } : {}) };
  });
}
export function loadFragments(): SavedFragment[] {
  try { return parseFragments(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}
export function storeFragments(fragments: SavedFragment[]) { localStorage.setItem(key, JSON.stringify(fragments)); }
