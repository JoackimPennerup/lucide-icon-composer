import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('lucide-static/package.json'));
const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const assetDirectory = join(workspace, 'public', 'lucide-icons');
const catalogPath = join(workspace, 'public', 'lucide-catalog.json');
const { version } = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const canonicalNames = Object.keys(JSON.parse(await readFile(join(packageRoot, 'icon-nodes.json'), 'utf8'))).sort();
const canonical = new Set(canonicalNames);
const iconFiles = (await readdir(join(packageRoot, 'icons'))).filter(file => file.endsWith('.svg'));
let previous = '';
let previousData;
try { previous = await readFile(catalogPath, 'utf8'); previousData = JSON.parse(previous); } catch { /* First generation. */ }
let existingAssets = [];
try { existingAssets = (await readdir(assetDirectory)).filter(file => file.endsWith('.svg')); } catch { /* First generation. */ }
const current = previousData?.version === version &&
  previousData?.icons?.length === canonicalNames.length &&
  previousData.icons.every((entry, index) => entry.name === canonicalNames[index]) &&
  existingAssets.length === canonicalNames.length && existingAssets.every(file => canonical.has(file.slice(0, -4)));

function geometrySignature(svg) {
  return svg.replace(/<!--[\s\S]*?-->/g, '').replace(/lucide-[a-z0-9-]+/g, 'lucide-icon');
}

if (!current) {
const tags = JSON.parse(await readFile(join(packageRoot, 'tags.json'), 'utf8'));
const byGeometry = new Map();
for (const file of iconFiles) {
  const name = file.slice(0, -4);
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe Lucide icon name: ${name}`);
  const svg = await readFile(join(packageRoot, 'icons', file), 'utf8');
  const signature = geometrySignature(svg);
  const group = byGeometry.get(signature) ?? [];
  group.push(name);
  byGeometry.set(signature, group);
}

const aliases = new Map(canonicalNames.map(name => [name, []]));
for (const group of byGeometry.values()) {
  const targets = group.filter(name => canonical.has(name));
  for (const alias of group.filter(name => !canonical.has(name))) {
    if (targets.length !== 1) throw new Error(`Cannot resolve official Lucide alias ${alias}.`);
    aliases.get(targets[0]).push(alias);
  }
}
const unresolved = iconFiles.map(file => file.slice(0, -4)).filter(name => !canonical.has(name) && ![...aliases.values()].some(list => list.includes(name)));
if (unresolved.length) throw new Error(`Unresolved Lucide aliases: ${unresolved.join(', ')}`);
if (canonicalNames.some(name => !iconFiles.includes(`${name}.svg`))) throw new Error('Lucide canonical SVG assets are incomplete.');

const icons = canonicalNames.map(name => ({ name, aliases: aliases.get(name).sort(), tags: tags[name] ?? [] }));
const catalog = JSON.stringify({ version, icons });
await mkdir(assetDirectory, { recursive: true });
  for (const file of await readdir(assetDirectory)) {
    if (file.endsWith('.svg') && !canonical.has(file.slice(0, -4))) await unlink(join(assetDirectory, file));
  }
  for (let start = 0; start < canonicalNames.length; start += 32) {
    await Promise.all(canonicalNames.slice(start, start + 32).map(name =>
      copyFile(join(packageRoot, 'icons', `${name}.svg`), join(assetDirectory, `${name}.svg`))));
  }
  if (previous !== catalog) await writeFile(catalogPath, catalog);
}
process.stdout.write(`Lucide ${version}: ${canonicalNames.length} canonical icons, ${iconFiles.length - canonicalNames.length} searchable aliases.\n`);
