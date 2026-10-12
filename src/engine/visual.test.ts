import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { expect, it } from 'vitest';
import { composeIcon } from './compose';
import { modifiers, subjects } from '../proof/icons';

const baselineDir = fileURLToPath(new URL('../../test/baselines/', import.meta.url));
const cases = [
  ['file-plus', subjects.file, modifiers.plus, 0.45],
  ['folder-check', subjects.folder, modifiers.check, 0.48],
  ['user-minus', subjects['user-round'], modifiers.minus, 0.46],
] as const;

for (const [name, subjectSvg, modifierSvg, scale] of cases) {
  for (const theme of ['light', 'dark'] as const) {
    it(`matches ${name} on ${theme} background`, () => {
      const result = composeIcon({
        subjectSvg, modifierSvg,
        placement: { anchor: 'bottom-right', offsetX: 0, offsetY: 0, scale },
        composition: { mode: 'cutout', clearance: 2 },
      });
      const foreground = theme === 'light' ? '#213b2b' : '#e4f3e8';
      const background = theme === 'light' ? '#ffffff' : '#18291f';
      const rendered = new Resvg(result.svg.replaceAll('currentColor', foreground), {
        fitTo: { mode: 'width', value: 240 }, background,
      }).render().asPng();
      const path = `${baselineDir}${name}-${theme}.png`;
      if (process.env.UPDATE_VISUALS === '1') {
        mkdirSync(baselineDir, { recursive: true });
        writeFileSync(path, rendered);
      }
      expect(existsSync(path), `Missing baseline ${path}; run with UPDATE_VISUALS=1`).toBe(true);
      const actual = PNG.sync.read(rendered);
      const expected = PNG.sync.read(readFileSync(path));
      expect(actual.width).toBe(expected.width);
      expect(actual.height).toBe(expected.height);
      const changed = pixelmatch(actual.data, expected.data, null, actual.width, actual.height, { threshold: 0.02, includeAA: true });
      expect(changed).toBeLessThanOrEqual(8);
      // A solid background would pass a snapshot generated from an empty icon.
      let foregroundPixels = 0;
      for (let i = 0; i < actual.data.length; i += 4) {
        if (Math.abs(actual.data[i] - expected.data[0]) > 20) foregroundPixels++;
      }
      expect(foregroundPixels).toBeGreaterThan(100);
    });
  }
}
