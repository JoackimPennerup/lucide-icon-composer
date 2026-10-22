import { describe, expect, it } from 'vitest';
import { parseStrictSvg } from './strictSvg';
import { subjects } from '../proof/icons';

describe('strict SVG source parsing', () => {
  it('accepts the supported Lucide primitives', () => {
    expect(parseStrictSvg(subjects.file).length).toBeGreaterThan(0);
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['image', '<image href="https://example.invalid/x"/>'],
    ['filter', '<filter id="f"/>'],
    ['nested markup', '<g><path d="M2 2h2"/></g>'],
    ['event handler', '<path onload="alert(1)" d="M2 2h2"/>'],
    ['external reference', '<path href="https://example.invalid/x" d="M2 2h2"/>'],
  ])('rejects %s', (_name, child) => {
    const svg = subjects.file.replace('</svg>', `${child}</svg>`);
    expect(() => parseStrictSvg(svg)).toThrow();
  });

  it('rejects doctypes, processing instructions and malformed XML', () => {
    expect(() => parseStrictSvg(`<!DOCTYPE svg>${subjects.file}`)).toThrow();
    expect(() => parseStrictSvg(`<?xml version="1.0"?>${subjects.file}`)).toThrow();
    expect(() => parseStrictSvg(subjects.file.replace('</svg>', ''))).toThrow();
  });

  it('rejects changes to the export contract', () => {
    expect(() => parseStrictSvg(subjects.file.replace('0 0 24 24', '0 0 32 32'))).toThrow();
    expect(() => parseStrictSvg(subjects.file.replace('stroke-width="2"', 'stroke-width="3"'))).toThrow();
    expect(() => parseStrictSvg(subjects.file.replace('stroke-linecap="round"', 'stroke-linecap="square"'))).toThrow();
    expect(() => parseStrictSvg(subjects.file.replace('fill="none"', 'fill="red"'))).toThrow();
  });

  it('accepts an official filled dot only when its 2px stroke covers the interior', () => {
    const source = subjects.file.replace('</svg>', '<circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>');
    expect(parseStrictSvg(source).at(-1)?.tag).toBe('circle');
    expect(() => parseStrictSvg(source.replace('r=".5"', 'r="2"'))).toThrow('Filled geometry');
  });
});
