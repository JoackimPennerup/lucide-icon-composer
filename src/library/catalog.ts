import type { IconSource } from '../editor/document';

export interface IconEntry { name: string; aliases: string[]; tags: string[] }
export interface IconCatalog { version: string; icons: IconEntry[]; byName: Map<string, IconEntry> }

const base = import.meta.env.BASE_URL;
let catalogPromise: Promise<IconCatalog> | undefined;
const sourceCache = new Map<string, Promise<string>>();

export function iconUrl(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unknown Lucide icon: ${name}`);
  return `${base}lucide-icons/${name}.svg`;
}

export function createCatalog(data: unknown): IconCatalog {
  if (!data || typeof data !== 'object') throw new Error('Lucide catalog is invalid.');
  const value = data as Record<string, unknown>;
  if (typeof value.version !== 'string' || !Array.isArray(value.icons)) throw new Error('Lucide catalog is incomplete.');
  const icons = value.icons as IconEntry[];
  const byName = new Map<string, IconEntry>();
  for (const entry of icons) {
    if (!entry || !/^[a-z0-9-]+$/.test(entry.name) || !Array.isArray(entry.aliases) || !Array.isArray(entry.tags) ||
        !entry.tags.every(tag => typeof tag === 'string') || byName.has(entry.name)) {
      throw new Error('Lucide catalog contains an invalid icon.');
    }
    byName.set(entry.name, entry);
    for (const alias of entry.aliases) {
      if (!/^[a-z0-9-]+$/.test(alias) || byName.has(alias)) throw new Error('Lucide catalog contains an invalid alias.');
      byName.set(alias, entry);
    }
  }
  return { version: value.version, icons, byName };
}

export function loadCatalog(): Promise<IconCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(`${base}lucide-catalog.json`).then(async response => {
      if (!response.ok) throw new Error(`Could not load the local Lucide catalog (${response.status}).`);
      return createCatalog(await response.json());
    }).catch(error => { catalogPromise = undefined; throw error; });
  }
  return catalogPromise;
}

export function searchIcons(catalog: IconCatalog, query: string): IconEntry[] {
  const terms = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
  if (!terms.length) return catalog.icons;
  return catalog.icons.filter(icon => {
    const names = [icon.name, ...icon.aliases].join(' ');
    const searchable = `${names} ${icon.tags.join(' ')}`.toLowerCase().replaceAll('-', ' ');
    return terms.every(term => searchable.includes(term));
  });
}

export async function loadIcon(name: string, catalog: IconCatalog): Promise<IconSource> {
  const entry = catalog.byName.get(name);
  if (!entry) throw new Error(`Unknown Lucide icon: ${name}. Search the current library and select an available icon.`);
  if (!sourceCache.has(entry.name)) {
    sourceCache.set(entry.name, fetch(iconUrl(entry.name)).then(async response => {
      if (!response.ok) throw new Error(`Could not load ${entry.name} from the local icon library (${response.status}).`);
      return response.text();
    }).catch(error => { sourceCache.delete(entry.name); throw error; }));
  }
  return { name: entry.name, svg: await sourceCache.get(entry.name)! };
}
