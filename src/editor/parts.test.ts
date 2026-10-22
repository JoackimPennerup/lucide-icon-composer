import { describe, expect, it } from 'vitest';
import wand from 'lucide-static/icons/wand-sparkles.svg?raw';
import image from 'lucide-static/icons/image.svg?raw';
import { composeIcon, DEFAULT_SUBJECT_TRANSFORM } from '../engine/compose';
import { defaultBaseLayers, defaultModifierTransform, parseDocument, serializeDocument, toCompositionInput, type CompositionDocument } from './document';
import { createLayer, extractParts, partsSvg } from './parts';
import { parseFragments } from './fragments';
import { commitHistory, initialHistory, undoHistory } from './history';

function project(): CompositionDocument {
  return { version: 5, lucideVersion: '1.55.0', subject: { name: 'image', svg: image }, modifier: null,
    subjectTransform: { ...DEFAULT_SUBJECT_TRANSFORM }, modifierTransform: defaultModifierTransform(image),
    modifierAnchor: 'bottom-right', clearance: 2, mode: 'cutout', layers: [], layerOrder: ['subject', 'modifier'], baseLayers: defaultBaseLayers() };
}

describe('source fragments and layered composition', () => {
  it('keeps all eight wand-sparkles source elements distinct and preserves six sparkle coordinates', () => {
    const parts = extractParts('wand-sparkles', wand);
    expect(parts).toHaveLength(8);
    expect(parts.map(part => part.label)).toEqual(Array.from({ length: 8 }, (_, index) => `Path ${index + 1}`));
    const selected = parts.slice(2);
    expect(selected).toHaveLength(6);
    expect(partsSvg(selected)).toContain('d="M5 6v4"');
    expect(partsSvg(selected)).not.toContain('21.64');
    expect(extractParts('wand-sparkles', wand).map(part => part.id)).toEqual(parts.map(part => part.id));
    const one = createLayer(selected, 'One', 'wand-sparkles', '1.55.0');
    const two = createLayer(selected, 'Two', 'wand-sparkles', '1.55.0');
    expect(one.parts.map(part => part.sourceId)).toEqual(two.parts.map(part => part.sourceId));
    expect(one.parts.map(part => part.id)).not.toEqual(two.parts.map(part => part.id));
  });

  it('composes independent groups, visibility, ordering and real cutouts with constant stroke width', () => {
    const layer = createLayer(extractParts('wand-sparkles', wand).slice(2), 'Sparkles', 'wand-sparkles', '1.55.0');
    const base = project();
    const withLayer = { ...base, layers: [layer], layerOrder: ['subject', layer.id, 'modifier'] };
    const result = composeIcon(toCompositionInput(withLayer));
    expect(result.layerPaths?.[layer.id]).toHaveLength(6);
    expect(result.svg).toContain('stroke-width="2"');
    expect(result.svg).not.toMatch(/<mask|<clipPath|<g |transform=/);
    expect(result.subjectPaths.join('')).not.toBe(composeIcon(toCompositionInput(base)).subjectPaths.join(''));
    const hidden = composeIcon(toCompositionInput({ ...withLayer, layers: [{ ...layer, visible: false }] }));
    expect(hidden.layerPaths?.[layer.id]).toBeUndefined();
    const oneLess = composeIcon(toCompositionInput({ ...withLayer, layers: [{ ...layer,
      parts: layer.parts.map((part, index) => index === 0 ? { ...part, visible: false } : part) }] }));
    expect(oneLess.layerPaths?.[layer.id]).toHaveLength(5);
    const overlay = composeIcon(toCompositionInput({ ...withLayer, layers: [{ ...layer, cutout: false }] }));
    expect(overlay.subjectPaths.join('')).toBe(composeIcon(toCompositionInput(base)).subjectPaths.join(''));
    const behind = composeIcon(toCompositionInput({ ...withLayer, layerOrder: [layer.id, 'subject', 'modifier'] }));
    expect(behind.subjectPaths.join('')).toBe(composeIcon(toCompositionInput(base)).subjectPaths.join(''));
    const moved = composeIcon(toCompositionInput({ ...withLayer, layers: [{ ...layer, transform: { ...layer.transform, scale: 0.6, offsetX: 2 } }] }));
    expect(moved.svg).not.toBe(result.svg);
    expect(moved.svg).toContain('stroke-width="2"');
  });

  it('round trips grouped elements, undo, fragments and legacy v4 documents', () => {
    const layer = createLayer(extractParts('wand-sparkles', wand).slice(2), 'Sparkles', 'wand-sparkles', '1.55.0');
    const document = { ...project(), layers: [layer], layerOrder: ['subject', layer.id, 'modifier'] };
    const ungrouped = { ...document, layers: [{ ...layer, grouped: false }] };
    expect(ungrouped.layers[0].parts.map(part => part.svg)).toEqual(layer.parts.map(part => part.svg));
    const history = commitHistory(initialHistory(document), ungrouped);
    expect(undoHistory(history).present).toEqual(document);
    const restored = parseDocument(serializeDocument(ungrouped));
    expect(restored).toEqual(ungrouped);
    expect(composeIcon(toCompositionInput(restored)).svg).toBe(composeIcon(toCompositionInput(ungrouped)).svg);
    const fragment = { id: 'saved-1', name: 'Sparkles', sourceName: 'wand-sparkles', sourceVersion: '1.55.0', grouped: true,
      parts: layer.parts.map(({ id, label, tag, svg }) => ({ id, label, tag, svg })) };
    expect(parseFragments(JSON.stringify([fragment]))).toEqual([fragment]);
    expect(() => parseFragments(JSON.stringify([{ ...fragment, parts: [{ ...fragment.parts[0], svg: fragment.parts[0].svg.replace('<path ', '<path onclick="bad" ') }] }]))).toThrow();
    const legacy = { ...project(), version: 4 } as unknown as Record<string, unknown>;
    delete legacy.layers; delete legacy.layerOrder; delete legacy.baseLayers;
    const migrated = parseDocument(JSON.stringify(legacy));
    expect(migrated.version).toBe(5);
    expect(composeIcon(toCompositionInput(migrated)).svg).toBe(composeIcon(toCompositionInput(project())).svg);
  });
});
