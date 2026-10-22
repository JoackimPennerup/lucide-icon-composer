import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { iconUrl, loadCatalog, searchIcons, type IconCatalog } from '../library/catalog';

const COLUMNS = 4;
const ROW_HEIGHT = 82;
const VIEW_HEIGHT = 330;

function label(name: string) { return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '); }

export function IconPicker({ title, selected, onChoose, onSelectParts }: {
  title: 'Subject' | 'Modifier'; selected: string | null; onChoose: (name: string) => void; onSelectParts: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<IconCatalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => catalog ? searchIcons(catalog, query) : [], [catalog, query]);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const lastRow = Math.min(Math.ceil(matches.length / COLUMNS), firstRow + Math.ceil(VIEW_HEIGHT / ROW_HEIGHT) + 5);
  const visible = matches.slice(firstRow * COLUMNS, lastRow * COLUMNS);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCatalog().then(value => {
      if (!alive) return;
      setCatalog(value);
      requestAnimationFrame(() => {
        if (!alive || search.current?.value) return;
        const canonical = value.byName.get(selected ?? '')?.name;
        const index = value.icons.findIndex(icon => icon.name === canonical);
        if (index < 0 || !scroller.current) return;
        const top = Math.max(0, Math.floor(index / COLUMNS) * ROW_HEIGHT - ROW_HEIGHT);
        scroller.current.scrollTop = top;
        setScrollTop(top);
      });
    })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load icons.'); });
    requestAnimationFrame(() => search.current?.focus());
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => { alive = false; window.removeEventListener('pointerdown', outside); };
  }, [open]);

  useEffect(() => {
    if (activeIndex === null || !open) return;
    const scroll = scroller.current;
    if (!scroll) return;
    const top = Math.floor(activeIndex / COLUMNS) * ROW_HEIGHT;
    if (top < scroll.scrollTop) scroll.scrollTop = top;
    else if (top + ROW_HEIGHT > scroll.scrollTop + VIEW_HEIGHT) scroll.scrollTop = top + ROW_HEIGHT - VIEW_HEIGHT;
    requestAnimationFrame(() => picker.current?.querySelector<HTMLButtonElement>(`[data-icon-index="${activeIndex}"]`)?.focus());
  }, [activeIndex, open, scrollTop]);

  function close() { setOpen(false); setActiveIndex(null); trigger.current?.focus(); }
  function openPicker() {
    setQuery(''); setError(''); setScrollTop(0); setActiveIndex(null); setOpen(true);
  }
  function changeQuery(value: string) {
    setQuery(value); setActiveIndex(null); setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const current = (event.target as HTMLElement).dataset.iconIndex;
    const index = current === undefined ? -1 : Number(current);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : index + COLUMNS;
    if (event.key === 'ArrowUp') next = index < 0 ? 0 : index - COLUMNS;
    if (event.key === 'ArrowRight' && index >= 0) next = index + 1;
    if (event.key === 'ArrowLeft' && index >= 0) next = index - 1;
    if (event.key === 'Home' && index >= 0) next = 0;
    if (event.key === 'End' && index >= 0) next = matches.length - 1;
    if (next !== null && matches.length) {
      event.preventDefault(); setActiveIndex(Math.max(0, Math.min(matches.length - 1, next)));
    }
  }

  return <div className="library-picker">
    <button ref={trigger} type="button" className="library-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Choose ${title.toLowerCase()} icon, current ${selected ? label(selected) : 'none'}`}
      onClick={() => open ? close() : openPicker()}>
      <span>{title}</span><strong>{selected ? label(selected) : 'None selected'}</strong><em>Browse all ↗</em>
    </button>
    {open && <div ref={picker} className="library-popover" role="dialog" aria-label={`Choose ${title.toLowerCase()} icon`} onKeyDown={keyDown}>
      <div className="library-popover-heading"><strong>{title} icon</strong><button type="button" aria-label={`Close ${title.toLowerCase()} picker`} onClick={close}>×</button></div>
      <input ref={search} type="search" aria-label={`Search ${title.toLowerCase()} icons`} placeholder="Search names, aliases, tags" value={query} onChange={event => changeQuery(event.target.value)} />
      {error ? <p className="library-error" role="alert">{error}</p> : !catalog ? <p className="library-status">Loading local Lucide library…</p> : <>
        <p className="library-status" role="status">{matches.length.toLocaleString('en-US')} matching icons · Lucide {catalog.version}</p>
        {!matches.length ? <p className="library-empty">No matching icons. Try a different name or tag.</p> :
          <div ref={scroller} className="library-scroll" style={{ height: VIEW_HEIGHT }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
            <div className="library-grid-space" style={{ height: Math.ceil(matches.length / COLUMNS) * ROW_HEIGHT }}>
              {visible.map((icon, visibleIndex) => {
                const index = firstRow * COLUMNS + visibleIndex;
                return <div key={icon.name} className="library-icon-cell" style={{ top: Math.floor(index / COLUMNS) * ROW_HEIGHT, left: `${(index % COLUMNS) * 25}%` }}><button type="button" data-icon-index={index} className="library-icon"
                  aria-label={label(icon.name)} aria-pressed={catalog?.byName.get(selected ?? '')?.name === icon.name} title={icon.name}
                  onClick={() => { onChoose(icon.name); close(); }}>
                  <img loading="lazy" alt="" src={iconUrl(icon.name)} /><span>{label(icon.name)}</span>
                </button><button type="button" className="library-parts-action" aria-label={`Select parts from ${label(icon.name)}`}
                  onClick={() => { onSelectParts(icon.name); close(); }}>Parts</button></div>;
              })}
            </div>
          </div>}
      </>}
      <p className="library-hint">Choose an icon or select Parts to extract source elements. Escape closes.</p>
    </div>}
  </div>;
}
