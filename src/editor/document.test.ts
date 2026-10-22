import { describe, expect, it } from 'vitest';
import { defaultBaseLayers, defaultModifierTransform, parseDocument, serializeDocument, toCompositionInput, type CompositionDocument } from './document';
import { subjects, modifiers } from '../proof/icons';
import { composeIcon, DEFAULT_SUBJECT_TRANSFORM } from '../engine/compose';

const document: CompositionDocument = {
  version: 5, lucideVersion: '1.55.0', subject: { name: 'file', svg: subjects.file }, modifier: { name: 'plus', svg: modifiers.plus },
  subjectTransform: { ...DEFAULT_SUBJECT_TRANSFORM }, modifierTransform: defaultModifierTransform(modifiers.plus, { x: 18.25, y: 17.9 }, 0.42),
  modifierAnchor: 'bottom-right', clearance: 2, mode: 'cutout', layers: [], layerOrder: ['subject', 'modifier'], baseLayers: defaultBaseLayers(),
};

describe('editable composition JSON', () => {
  it('round trips both transforms and geometry deterministically', () => {
    const reopened = parseDocument(serializeDocument(document));
    expect(reopened).toEqual(document);
    expect(composeIcon(toCompositionInput(reopened)).svg).toBe(composeIcon(toCompositionInput(document)).svg);
  });
  it('reopens v1–v3 compositions without changing geometry', () => {
    for (const version of [1, 2, 3]) {
      const old = { version, lucideVersion: '1.55.0', subject: document.subject, modifier: document.modifier,
        placement: { anchor: 'bottom-right', x: 18.25, y: 17.9, scale: 0.42 }, clearance: 2, mode: 'cutout' };
      const reopened = parseDocument(JSON.stringify(old));
      expect(reopened.subjectTransform).toEqual(DEFAULT_SUBJECT_TRANSFORM);
      expect(reopened.modifierAnchor).toBe('bottom-right');
      expect(composeIcon(toCompositionInput(reopened)).svg).toBe(composeIcon({ subjectSvg: subjects.file, modifierSvg: modifiers.plus,
        placement: { anchor: 'center', offsetX: 6.25, offsetY: 5.9, scale: 0.42 }, composition: { mode: 'cutout', clearance: 2 } }).svg);
      expect(reopened.lucideVersion).toBe(version === 3 ? '1.55.0' : 'unknown');
    }
    const solo = parseDocument(serializeDocument({ ...document, modifier: null }));
    expect(composeIcon(toCompositionInput(solo)).modifierPaths).toHaveLength(0);
  });
  it('rejects unsupported source markup and invalid numeric state', () => {
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: '<svg viewBox="0 0 24 24"><image href="x"/></svg>' } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, subjectTransform: { ...document.subjectTransform, scale: -1 } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: subjects.file.replace('<path ', '<path onload="alert(1)" ') } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: '<!DOCTYPE svg><svg viewBox="0 0 24 24"/>' } }))).toThrow();
    expect(() => parseDocument(serializeDocument({ ...document, modifier: { name: 'bad', svg: subjects.file.replace(/<path[^>]+\/>/, '<path d="M1 1"/>') } }))).toThrow();
  });
});
