import { expect, it } from 'vitest';
import { normalizePathData } from './pathData';

it('expands compact SVG arc flags used by Lucide without changing values', () => {
  expect(normalizePathData('M10 3a41 41 0 000 18')).toBe('M 10 3 a 41 41 0 0 0 0 18');
  expect(normalizePathData('M16.997 21a2 2 0 001.68-.92')).toBe('M 16.997 21 a 2 2 0 0 0 1.68 -.92');
});

it('rejects incomplete commands and invalid arc flags', () => {
  expect(() => normalizePathData('M1 1 L')).toThrow();
  expect(() => normalizePathData('M1 1 A2 2 0 2 0 3 3')).toThrow();
});
