import { readFileSync } from 'node:fs';
import paper from 'paper';
import { expect, it } from 'vitest';
import { parseLucideSvg } from './compose';

const root = new URL('../../', import.meta.url);
const canonical = Object.keys(JSON.parse(readFileSync(new URL('node_modules/lucide-static/icon-nodes.json', root), 'utf8')));

it('parses every canonical icon in the installed Lucide package', () => {
  const failures: string[] = [];
  for (const name of canonical) {
    try {
      const source = readFileSync(new URL(`node_modules/lucide-static/icons/${name}.svg`, root), 'utf8');
      const scope = new paper.PaperScope();
      scope.setup(new scope.Size(24, 24));
      const paths = parseLucideSvg(scope, source);
      if (paths.some(path => !Number.isFinite(path.length) || path.length < 1e-6)) throw new Error('Degenerate path');
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
