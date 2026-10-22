import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';
import paper from 'paper';

const packageRoot = new URL('../node_modules/lucide-static/', import.meta.url);
const canonical = Object.keys(JSON.parse(await readFile(new URL('icon-nodes.json', packageRoot), 'utf8')));
const installed = (await readdir(new URL('icons/', packageRoot))).filter(name => name.endsWith('.svg'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const failures = [];
try {
  const { parseLucideSvg } = await vite.ssrLoadModule('/src/engine/compose.ts');
  for (const name of canonical) {
    try {
      const svg = await readFile(new URL(`icons/${name}.svg`, packageRoot), 'utf8');
      const scope = new paper.PaperScope();
      scope.setup(new scope.Size(24, 24));
      const paths = parseLucideSvg(scope, svg);
      if (paths.some(path => !Number.isFinite(path.length) || path.length < 1e-6)) {
        throw new Error('Contains a degenerate path');
      }
    } catch (error) {
      failures.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
} finally {
  await vite.close();
}
process.stdout.write(`Lucide ${JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8')).version}: ${canonical.length} canonical icons, ${installed.length - canonical.length} aliases, ${failures.length} parse failures.\n`);
for (const { name, reason } of failures) process.stdout.write(`  ${name}: ${reason}\n`);
if (failures.length) process.exitCode = 1;
