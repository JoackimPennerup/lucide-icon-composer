import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import paper from 'paper';
import { parseLucideSvg } from '../engine/compose';
import { extractParts, type SourcePart } from './parts';

type Bounds = { x: number; y: number; width: number; height: number };
function boundsOf(paths: paper.Path[]): Bounds {
  const bounds = paths.reduce((all, path) => all.unite(path.bounds), paths[0].bounds.clone());
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}
function intersects(a: Bounds, b: Bounds) { return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y; }
function union(bounds: Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map(b => b.x)); const y = Math.min(...bounds.map(b => b.y));
  return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y };
}
export function PartSelector({ name, svg, onCancel, onAdd, onSave }: {
  name: string; svg: string; onCancel: () => void; onAdd: (parts: SourcePart[]) => void; onSave: (parts: SourcePart[]) => void;
}) {
  const parts = useMemo(() => extractParts(name, svg), [name, svg]);
  const graphics = useMemo(() => {
    const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
    return parts.map(part => {
      const paths = parseLucideSvg(scope, part.svg);
      return { paths: paths.map(path => path.pathData), bounds: boundsOf(paths) };
    });
  }, [parts]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ start: { x: number; y: number }; now: { x: number; y: number }; additive: boolean } | null>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); cancelRef.current(); } };
    window.addEventListener('keydown', escape, true);
    list.current?.querySelector('button')?.focus();
    return () => window.removeEventListener('keydown', escape, true);
  }, []);
  function point(event: PointerEvent<SVGSVGElement>) {
    const matrix = canvas.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: value.x, y: value.y };
  }
  function toggle(id: string, additive: boolean) {
    setSelected(current => {
      const next = new Set(additive ? current : []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    const id = target.closest('[data-part-id]')?.getAttribute('data-part-id');
    if (id) { toggle(id, event.shiftKey); return; }
    const start = point(event);
    setMarquee({ start, now: start, additive: event.shiftKey });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    if (!marquee) return;
    const box = { x: Math.min(marquee.start.x, marquee.now.x), y: Math.min(marquee.start.y, marquee.now.y),
      width: Math.abs(marquee.now.x - marquee.start.x), height: Math.abs(marquee.now.y - marquee.start.y) };
    const ids = parts.filter((_, index) => intersects(box, graphics[index].bounds)).map(part => part.id);
    setSelected(current => new Set([...(marquee.additive ? current : []), ...ids]));
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const selectedParts = parts.filter(part => selected.has(part.id));
  const selectionBounds = union(parts.flatMap((part, index) => selected.has(part.id) ? [graphics[index].bounds] : []));
  const marqueeBox = marquee && { x: Math.min(marquee.start.x, marquee.now.x), y: Math.min(marquee.start.y, marquee.now.y),
    width: Math.abs(marquee.now.x - marquee.start.x), height: Math.abs(marquee.now.y - marquee.start.y) };
  return <div className="parts-backdrop" role="presentation"><section className="parts-dialog" role="dialog" aria-modal="true" aria-label={`Select parts from ${name}`}>
    <div className="parts-heading"><div><span>Break Apart · {name}</span><h2>Select source elements</h2></div><button type="button" aria-label="Close part selector" onClick={onCancel}>×</button></div>
    <div className="parts-main"><div className="parts-canvas-wrap"><svg ref={canvas} viewBox="-2 -2 28 28" role="application" aria-label="Source icon parts" onPointerDown={start}
      onPointerMove={event => { if (marquee) setMarquee({ ...marquee, now: point(event) }); }} onPointerUp={finish}
      onPointerCancel={() => setMarquee(null)}>
      <rect x="0" y="0" width="24" height="24" className="parts-artboard" />
      {graphics.map((item, index) => <g key={parts[index].id} className={`parts-shape ${selected.has(parts[index].id) ? 'selected' : selected.size ? 'dimmed' : ''} ${hovered === parts[index].id ? 'hovered' : ''}`}>
        {item.paths.map((d, pathIndex) => <g key={pathIndex}><path d={d} className="parts-visible" /><path d={d} data-part-id={parts[index].id} className="parts-hit" /></g>)}
      </g>)}
      {selectionBounds && <rect className="parts-selection-bounds" x={selectionBounds.x - .5} y={selectionBounds.y - .5} width={selectionBounds.width + 1} height={selectionBounds.height + 1} pointerEvents="none" />}
      {marqueeBox && <rect className="parts-marquee" {...marqueeBox} pointerEvents="none" />}
    </svg><p>Click a stroke, Shift+click to combine, or drag a marquee.</p></div>
    <div className="parts-sidebar"><div className="parts-actions"><button type="button" onClick={() => setSelected(new Set(parts.map(part => part.id)))}>Select All</button>
      <button type="button" onClick={() => setSelected(new Set())}>Clear Selection</button>
      <button type="button" onClick={() => setSelected(new Set(parts.filter(part => !selected.has(part.id)).map(part => part.id)))}>Invert Selection</button></div>
      <strong>{selected.size} of {parts.length} elements selected</strong>
      <div ref={list} className="parts-list" aria-label="Source elements">{parts.map(part => <button key={part.id} type="button" aria-pressed={selected.has(part.id)}
        onMouseEnter={() => setHovered(part.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(part.id)} onBlur={() => setHovered(null)}
        onClick={event => toggle(part.id, event.shiftKey)}>{part.label}</button>)}</div>
      <div className="parts-preview"><span>Selected geometry preview</span><svg viewBox="0 0 24 24" role="img" aria-label="Selected parts preview">
        {graphics.map((item, index) => selected.has(parts[index].id) && item.paths.map((d, pathIndex) => <path key={`${index}-${pathIndex}`} d={d} />))}</svg></div>
    </div></div>
    <div className="parts-footer"><button type="button" onClick={onCancel}>Cancel</button><button type="button" disabled={!selected.size} onClick={() => onSave(selectedParts)}>Save fragment</button>
      <button type="button" className="primary" disabled={!selected.size} onClick={() => onAdd(selectedParts)}>Add selected parts</button></div>
  </section></div>;
}
