import { describe, expect, it } from 'vitest';
import { composeIcon, type CompositionInput } from './compose';
import { validateComposition, validateSourceSvg } from './guidelines';
import { subjects, modifiers } from '../proof/icons';

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
function model(subjectSvg = subjects.file, modifierSvg = modifiers.plus, clearance = 2): CompositionInput {
  return { subjectSvg, modifierSvg, placement: { anchor: 'center', offsetX: 6, offsetY: 6, scale: 0.45 }, composition: { mode: 'cutout', clearance } };
}

describe('Lucide guideline validation', () => {
  it('accepts normal Lucide source SVG and detects strict source violations', () => {
    expect(validateSourceSvg(subjects.file, 'Subject')).toEqual([]);
    const bad = `<svg viewBox="0 0 20 20" fill="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter"><path d="M2 2h10" transform="translate(1)"/><image href="photo.png"/></svg>`;
    const issues = validateSourceSvg(bad, 'Subject');
    expect(issues[0].id).toBe('Subject-source');
    expect(issues[0].level).toBe('error');
  });

  it('flags safe-zone violations and identifies affected output geometry', () => {
    const input = model(svg('<line x1="1" y1="4" x2="1" y2="20"/>'));
    input.placement.offsetX = 16;
    const result = composeIcon(input);
    const issues = validateComposition(input, result);
    expect(issues.some(issue => issue.id === 'bounds-0' && issue.level === 'warning' && issue.target?.layer === 'subject')).toBe(true);
  });

  it('recommends 2px of measured visible separation without changing placement', () => {
    const input = model(svg('<line x1="2" y1="12" x2="22" y2="12"/>'), svg('<line x1="12" y1="2" x2="12" y2="22"/>'), 0);
    input.placement = { anchor: 'center', offsetX: 0, offsetY: 0, scale: 1 };
    const result = composeIcon(input);
    const issues = validateComposition(input, result);
    expect(issues.find(issue => issue.id === 'separation')?.level).toBe('warning');
    expect(result.svg).toContain('stroke-width="2"');
  });

  it('reports a fully removed subject as a design warning', () => {
    const input = model(svg('<line x1="10" y1="12" x2="14" y2="12"/>'), svg('<line x1="12" y1="2" x2="12" y2="22"/>'));
    input.placement = { anchor: 'center', offsetX: 0, offsetY: 0, scale: 1 };
    expect(validateComposition(input, composeIcon(input)).some(issue => issue.id === 'subject-removed' && issue.level === 'warning')).toBe(true);
  });

  it('does not mistake an original Lucide round dot for a cutout fragment', () => {
    const input = model(svg('<path d="M6 8h.01"/><path d="M4 18h14"/>'));
    input.modifierSvg = null;
    const issues = validateComposition(input, composeIcon(input));
    expect(issues.some(issue => issue.id.startsWith('short-'))).toBe(false);
  });

  it('warns about transformed small corners and strokes outside the canvas', () => {
    const input = model(svg('<rect x="2" y="2" width="20" height="20" rx="1.5"/>'));
    input.modifierSvg = null;
    input.subjectTransform = { scale: 0.5, offsetX: 14, offsetY: 0, pivotX: 12, pivotY: 12 };
    const issues = validateComposition(input, composeIcon(input));
    expect(issues.some(issue => issue.id === 'small-corners' && issue.level === 'warning')).toBe(true);
    expect(issues.some(issue => issue.id.startsWith('canvas-') && issue.target?.layer === 'subject')).toBe(true);
  });

  it('detects tight curved path corners after scaling', () => {
    const input = model(svg('<path d="M8 10 Q8 8 10 8"/>'));
    input.modifierSvg = null;
    input.subjectTransform = { scale: 0.5, offsetX: 0, offsetY: 0, pivotX: 12, pivotY: 12 };
    expect(validateComposition(input, composeIcon(input)).some(issue => issue.id === 'small-corners')).toBe(true);
  });
});
