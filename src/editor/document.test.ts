import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument, toCompositionInput, type CompositionDocument } from './document';
import { subjects, modifiers } from '../proof/icons';
import { composeIcon } from '../engine/compose';

const document: CompositionDocument = {
  version: 3, lucideVersion: '1.55.0', subject: { name: 'file', svg: subjects.file }, modifier: { name: 'plus', svg: modifiers.plus },
  placement: { anchor: 'bottom-right', x: 18.25, y: 17.9, scale: 0.42 }, clearance: 2, mode: 'cutout',
};

describe('editable composition JSON', () => {
  it('round trips sources, placement and geometry deterministically', () => {
    const reopened = parseDocument(serializeDocument(document));
    expect(reopened).toEqual(document);
    expect(composeIcon(toCompositionInput(reopened)).svg).toBe(composeIcon(toCompositionInput(document)).svg);
  });
  it('reopens an older Phase 1 composition and allows no modifier', () => {
    const old = { ...document, version: 1, placement: { x: 18, y: 18, scale: 0.45 } };
    expect(parseDocument(JSON.stringify(old)).placement.anchor).toBe('bottom-right');
    expect(parseDocument(JSON.stringify({ ...document, version: 2 })).lucideVersion).toBe('unknown');
    const solo = parseDocument(serializeDocument({ ...document, modifier: null }));
    expect(composeIcon(toCompositionInput(solo)).modifierPaths).toHaveLength(0);
  });
  it('rejects unsupported source markup and invalid numeric state', () => {
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: '<svg viewBox="0 0 24 24"><image href="x"/></svg>' } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, placement: { ...document.placement, scale: -1 } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: subjects.file.replace('<path ', '<path onload="alert(1)" ') } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: '<!DOCTYPE svg><svg viewBox="0 0 24 24"/>' } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: subjects.file.replace(/<path[^>]+\/>/, '<path d="M1 1"/>') } }))).toThrow();
  });
});
