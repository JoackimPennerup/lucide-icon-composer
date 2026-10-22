import paper from 'paper';
import { parseLucideSvg, type ElementTransform } from '../engine/compose';
import { parseStrictSvg, type SvgPrimitive } from '../engine/strictSvg';

export interface SourcePart { id: string; label: string; tag: SvgPrimitive['tag']; svg: string }
export interface EditablePart extends SourcePart { sourceId?: string; visible: boolean; locked: boolean; transform: ElementTransform }
export interface FragmentLayer {
  id: string; name: string; sourceName: string; sourceVersion: string;
  parts: EditablePart[]; transform: ElementTransform; visible: boolean; locked: boolean;
  cutout: boolean; grouped: boolean;
}

const root = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
function escape(value: string) { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
export function primitiveMarkup(part: SvgPrimitive) {
  return `<${part.tag}${Object.entries(part.attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}/>`;
}
export function partsSvg(parts: Pick<SourcePart, 'svg'>[]): string {
  return root + parts.flatMap(part => parseStrictSvg(part.svg).map(primitiveMarkup)).join('') + '</svg>';
}
export function extractParts(iconName: string, svg: string): SourcePart[] {
  return parseStrictSvg(svg).map((part, index) => ({
    id: `${iconName}:${index}:${hash(primitiveMarkup(part))}`,
    label: `${part.tag[0].toUpperCase()}${part.tag.slice(1)} ${index + 1}`,
    tag: part.tag,
    svg: root + primitiveMarkup(part) + '</svg>',
  }));
}
function hash(value: string) { let h = 2166136261; for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return (h >>> 0).toString(36); }
export function geometryBounds(parts: Pick<SourcePart, 'svg'>[]) {
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
  const paths = parts.flatMap(part => parseLucideSvg(scope, part.svg));
  const bounds = paths.reduce((acc, path) => acc.unite(path.bounds), paths[0].bounds.clone());
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}
export function createLayer(parts: SourcePart[], name: string, sourceName: string, sourceVersion: string): FragmentLayer {
  if (!parts.length) throw new Error('Choose at least one source element.');
  const bounds = geometryBounds(parts);
  return {
    id: crypto.randomUUID(), name, sourceName, sourceVersion,
    parts: parts.map(part => { const partBounds = geometryBounds([part]); return { ...part, id: crypto.randomUUID(), sourceId: part.id, visible: true, locked: false,
      transform: { scale: 1, pivotX: partBounds.x + partBounds.width / 2, pivotY: partBounds.y + partBounds.height / 2, offsetX: 0, offsetY: 0 } }; }),
    transform: { scale: 1, pivotX: bounds.x + bounds.width / 2, pivotY: bounds.y + bounds.height / 2, offsetX: 0, offsetY: 0 },
    visible: true, locked: false, cutout: true, grouped: true,
  };
}
