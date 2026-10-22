import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCatalog, iconUrl, loadIcon, searchIcons } from './catalog';

const root = new URL('../../', import.meta.url);
const installed = JSON.parse(readFileSync(new URL('node_modules/lucide-static/package.json', root), 'utf8'));
const nodes = JSON.parse(readFileSync(new URL('node_modules/lucide-static/icon-nodes.json', root), 'utf8'));
const files = readdirSync(new URL('node_modules/lucide-static/icons/', root)).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4));
const catalog = createCatalog(JSON.parse(readFileSync(new URL('public/lucide-catalog.json', root), 'utf8')));

describe('generated full Lucide catalog', () => {
  it('matches every installed canonical name, alias, and the pinned package version', () => {
    expect(catalog.version).toBe(installed.version);
    expect(catalog.icons.map(icon => icon.name)).toEqual(Object.keys(nodes).sort());
    expect([...catalog.byName.keys()].sort()).toEqual(files.sort());
    expect(catalog.icons.length).toBeGreaterThan(1000);
  });

  it('finds partial names, spaced names, aliases, and official tags', () => {
    expect(searchIcons(catalog, 'file').some(icon => icon.name === 'file')).toBe(true);
    expect(searchIcons(catalog, 'arrow').length).toBeGreaterThan(20);
    expect(searchIcons(catalog, 'check').length).toBeGreaterThan(10);
    expect(searchIcons(catalog, 'user round').some(icon => icon.name === 'user-round')).toBe(true);
    expect(searchIcons(catalog, 'alarm check').some(icon => icon.name === 'alarm-clock-check')).toBe(true);
    expect(searchIcons(catalog, 'residence').some(icon => icon.name === 'house')).toBe(true);
    expect(searchIcons(catalog, 'no-icon-has-this-string')).toEqual([]);
  });

  it('serves unchanged canonical SVGs locally and rejects unknown names', async () => {
    for (const name of ['file', 'user-round', 'chart-scatter', 'barrel']) {
      expect(readFileSync(new URL(`public/lucide-icons/${name}.svg`, root), 'utf8'))
        .toBe(readFileSync(new URL(`node_modules/lucide-static/icons/${name}.svg`, root), 'utf8'));
      expect(iconUrl(name)).toContain(`/lucide-icons/${name}.svg`);
    }
    await expect(loadIcon('not-a-real-icon', catalog)).rejects.toThrow('Unknown Lucide icon');
    expect(() => iconUrl('../escape')).toThrow();
  });
});
