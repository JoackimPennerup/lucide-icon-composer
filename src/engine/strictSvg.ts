import { DOMParser, type Element } from '@xmldom/xmldom';
import { normalizePathData } from './pathData';

export interface SvgPrimitive {
  tag: 'path' | 'line' | 'circle' | 'ellipse' | 'rect' | 'polyline' | 'polygon';
  attrs: Record<string, string>;
}

const geometryAttributes: Record<SvgPrimitive['tag'], Set<string>> = {
  path: new Set(['d']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  polyline: new Set(['points']),
  polygon: new Set(['points']),
};
const rootAttributes = new Set(['xmlns', 'class', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
const inheritedAttributes = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
const requiredNumeric: Partial<Record<SvgPrimitive['tag'], string[]>> = {
  line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height'],
};

function attributes(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    result[attribute.name] = attribute.value;
  }
  return result;
}

/** The only SVG input path. Returns data, never markup for direct DOM injection. */
export function parseStrictSvg(svg: string): SvgPrimitive[] {
  if (svg.length > 100_000) throw new Error('SVG source is too large.');
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(svg)) throw new Error('SVG document types, entities and processing instructions are unsupported.');
  const document = new DOMParser({ onError: (_level, message) => { throw new Error(`Malformed SVG: ${message}`); } })
    .parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (!root || root.tagName !== 'svg') throw new Error('Expected an SVG root element.');
  for (let node = document.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1 && node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent?.trim())) {
      throw new Error('Unsupported content outside the SVG root.');
    }
  }
  const rootAttrs = attributes(root);
  for (const key of Object.keys(rootAttrs)) if (!rootAttributes.has(key)) throw new Error(`Unsupported SVG attribute: ${key}.`);
  if ((rootAttrs.viewBox ?? '').trim().replace(/[\s,]+/g, ' ') !== '0 0 24 24') throw new Error('Only a 0 0 24 24 viewBox is supported.');
  if (rootAttrs['stroke-width'] !== '2' || rootAttrs['stroke-linecap'] !== 'round' || rootAttrs['stroke-linejoin'] !== 'round' || rootAttrs.fill !== 'none') {
    throw new Error('Lucide source SVGs need 2px strokes, round caps and joins, and no fill.');
  }
  if (rootAttrs.stroke && rootAttrs.stroke !== 'currentColor') throw new Error('Only currentColor strokes are supported.');
  if ((rootAttrs.width && Number(rootAttrs.width) !== 24) || (rootAttrs.height && Number(rootAttrs.height) !== 24)) throw new Error('Source SVG dimensions must be 24×24.');

  const primitives: SvgPrimitive[] = [];
  const visit = (element: Element) => {
    for (let node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 8 || (node.nodeType === 3 && !node.textContent?.trim())) continue;
      if (node.nodeType !== 1) throw new Error('Only stroke geometry is supported inside SVG.');
      const child = node as Element;
      const tag = child.tagName as SvgPrimitive['tag'];
      const allowed = geometryAttributes[tag];
      if (!allowed) throw new Error(`Unsupported SVG element: <${child.tagName}>.`);
      const attrs = attributes(child);
      for (const [key, value] of Object.entries(attrs)) {
        if (!allowed.has(key) && !inheritedAttributes.has(key)) throw new Error(`Unsupported <${tag}> attribute: ${key}.`);
        if (key === 'fill' && value !== 'none' && !(tag === 'circle' && value === 'currentColor' && Number(attrs.r) <= 1)) {
          throw new Error('Filled geometry is unsupported.');
        }
        if (key === 'stroke' && value !== 'currentColor') throw new Error('Only currentColor strokes are supported.');
        if (key === 'stroke-width' && Number(value) !== 2) throw new Error('Mixed stroke widths are unsupported.');
        if ((key === 'stroke-linecap' || key === 'stroke-linejoin') && value !== 'round') throw new Error('Stroke caps and joins must be round.');
      }
      if (tag === 'path' && (!attrs.d || !/^[\s\d.,+eEMmZzLlHhVvCcSsQqTtAa-]+$/.test(attrs.d))) {
        throw new Error('Invalid path data.');
      }
      if (tag === 'path') normalizePathData(attrs.d);
      for (const key of requiredNumeric[tag] ?? []) {
        if (!(key in attrs) || !attrs[key].trim() || !Number.isFinite(Number(attrs[key]))) throw new Error(`Invalid <${tag}> ${key} coordinate.`);
      }
      if ((tag === 'circle' && Number(attrs.r) <= 0) ||
          (tag === 'ellipse' && (Number(attrs.rx) <= 0 || Number(attrs.ry) <= 0)) ||
          (tag === 'rect' && (Number(attrs.width) <= 0 || Number(attrs.height) <= 0))) {
        throw new Error(`Invalid <${tag}> dimensions.`);
      }
      if (tag === 'rect' && ['rx', 'ry'].some(key => key in attrs && (!Number.isFinite(Number(attrs[key])) || Number(attrs[key]) < 0))) {
        throw new Error('Invalid rectangle corner radius.');
      }
      if (tag === 'polyline' || tag === 'polygon') {
        const points = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
        if (points.length < 4 || points.length % 2 !== 0 || points.some(value => !Number.isFinite(value))) throw new Error(`Invalid <${tag}> points.`);
      }
      for (let grandchild = child.firstChild; grandchild; grandchild = grandchild.nextSibling) {
        if (grandchild.nodeType !== 8 && !(grandchild.nodeType === 3 && !grandchild.textContent?.trim())) throw new Error(`Nested content in <${tag}> is unsupported.`);
      }
      primitives.push({ tag, attrs });
    }
  };
  visit(root);
  if (!primitives.length) throw new Error('SVG has no supported geometry.');
  return primitives;
}
