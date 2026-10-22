import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const catalog = JSON.parse(await readFile('dist/lucide-catalog.json', 'utf8'));
const assets = (await readdir('dist/lucide-icons')).filter(file => file.endsWith('.svg'));
if (assets.length !== catalog.icons.length || catalog.icons.some(icon => !assets.includes(`${icon.name}.svg`))) {
  throw new Error('The production build is missing canonical Lucide SVG assets.');
}
const bundles = (await readdir('dist/assets')).filter(file => file.endsWith('.js'));
for (const bundle of bundles) {
  const code = await readFile(join('dist/assets', bundle), 'utf8');
  if (code.includes('lucide-a-arrow-down') || code.includes('lucide-zoom-out')) {
    throw new Error(`Full Lucide SVG source leaked into JavaScript bundle ${bundle}.`);
  }
}
process.stdout.write(`Production assets verified: ${assets.length} local canonical SVGs; SVG library absent from JavaScript bundles.\n`);
