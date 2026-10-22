import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import paper from 'paper';
import { composeIcon, parseLucideSvg, DEFAULT_SUBJECT_TRANSFORM, type CompositionResult, type ElementTransform } from '../engine/compose';
import { validateComposition, type GuidelineIssue } from '../engine/guidelines';
import { loadCatalog, loadIcon } from '../library/catalog';
import lucidePackage from 'lucide-static/package.json';
import fileSvg from 'lucide-static/icons/file.svg?raw';
import plusSvg from 'lucide-static/icons/plus.svg?raw';
import { anchorPositions, defaultBaseLayers, defaultModifierTransform, parseDocument, serializeDocument, toCompositionInput, transformPosition, withPosition, type CompositionDocument } from './document';
import { createLayer, partsSvg, type SourcePart, type FragmentLayer } from './parts';
import { loadFragments, parseFragments, storeFragments, type SavedFragment } from './fragments';
import { PartSelector } from './PartSelector';
import { commitHistory, initialHistory, redoHistory, undoHistory } from './history';
import { IconPicker } from './IconPicker';
import { moveModifier, nudgeModifier, roundPosition, screenToSvg, type AffineMatrix, type GridIncrement, type Position } from './placement';
import { snapScaleToPixels, sourceGeometrySpan, stepScaleByPixels } from './scale';
import './library-picker.css';

const initial: CompositionDocument = {
  version: 5,
  lucideVersion: lucidePackage.version,
  subject: { name: 'file', svg: fileSvg },
  modifier: { name: 'plus', svg: plusSvg },
  subjectTransform: { ...DEFAULT_SUBJECT_TRANSFORM },
  modifierTransform: defaultModifierTransform(plusSvg),
  modifierAnchor: 'bottom-right',
  clearance: 2,
  mode: 'cutout',
  layers: [], layerOrder: ['subject', 'modifier'], baseLayers: defaultBaseLayers(),
};

type LayerName = 'subject' | 'modifier';
const rangeStyle = (value: number, min: number, max: number): CSSProperties => ({
  '--range-progress': `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`,
}) as CSSProperties;
type Drag = {
  kind: string; pointerId: number; matrix: AffineMatrix; startClient: Position;
  originalPosition: Position; originalPan: Position; pending?: Position; frame?: number;
};

function saveFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = window.document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Layer({ paths, className, ...props }: { paths: string[]; className: string; 'data-drag-subject'?: string; 'data-drag-modifier'?: string }) {
  return <g className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {paths.map((d, index) => <path key={`${index}-${d}`} d={d} />)}
  </g>;
}

function ActualPreview({ result, size, dark }: { result: CompositionResult; size: number; dark: boolean }) {
  return <div className={`actual-card ${dark ? 'dark' : ''}`}><span>{size}px</span>
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${size} pixel preview`}>
      {result.layerPaths ? Object.values(result.layerPaths).map((paths, index) => <Layer key={index} paths={paths} className="actual-paths" />) : <><Layer paths={result.subjectPaths} className="actual-paths" /><Layer paths={result.modifierPaths} className="actual-paths" /></>}
    </svg>
  </div>;
}

function FragmentPreview({ fragment }: { fragment: SavedFragment }) {
  const paths = useMemo(() => {
    const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
    return fragment.parts.flatMap(part => parseLucideSvg(scope, part.svg).map(path => {
      for (const transform of [part.transform, fragment.groupTransform]) if (transform) {
        path.scale(transform.scale, new scope.Point(transform.pivotX, transform.pivotY));
        path.translate(new scope.Point(transform.offsetX, transform.offsetY));
      }
      return path.pathData;
    }));
  }, [fragment]);
  return <svg viewBox="0 0 24 24" role="img" aria-label={`${fragment.name} preview`}>
    {paths.map((d, index) => <path key={index} d={d} />)}
  </svg>;
}

export function Editor({ openProof }: { openProof: () => void }) {
  const [history, setHistory] = useState(() => initialHistory(initial));
  const [draft, setDraft] = useState<{ layer: string; position: Position } | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<LayerName>('modifier');
  const [selectedExtra, setSelectedExtra] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [partsSource, setPartsSource] = useState<{ name: string; svg: string; version: string } | null>(null);
  const [fragments, setFragments] = useState<SavedFragment[]>(loadFragments);
  const [fragmentQuery, setFragmentQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [showSafe, setShowSafe] = useState(true);
  const [showExclusion, setShowExclusion] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [snap, setSnap] = useState(true);
  const [gridIncrement, setGridIncrement] = useState<GridIncrement>(1);
  const [snapFeedback, setSnapFeedback] = useState(false);
  const [panTool, setPanTool] = useState(false);
  const [darkPreview, setDarkPreview] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [libraryMessage, setLibraryMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const fragmentFileInput = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const historyRef = useRef(history);
  const altPressed = useRef(false);
  const choiceSerial = useRef({ subject: 0, modifier: 0 });
  const lastValidResult = useRef<CompositionResult | null>(null);
  historyRef.current = history;

  const present = history.present;
  const transformKey = (layer: LayerName) => layer === 'subject' ? 'subjectTransform' : 'modifierTransform';
  function getTransform(document: CompositionDocument, id: string): ElementTransform {
    if (id === 'subject' || id === 'modifier') return document[transformKey(id)];
    if (id.startsWith('part:')) return document.layers.flatMap(layer => layer.parts).find(part => part.id === id.slice(5))?.transform ?? DEFAULT_SUBJECT_TRANSFORM;
    const layer = document.layers.find(item => item.id === id);
    if (!layer) return DEFAULT_SUBJECT_TRANSFORM;
    return layer.transform;
  }
  function transformed(document: CompositionDocument, id: string, transform: ElementTransform): CompositionDocument {
    if (id === 'subject' || id === 'modifier') return { ...document, [transformKey(id)]: transform };
    if (id.startsWith('part:')) return { ...document, layers: document.layers.map(layer => ({ ...layer,
      parts: layer.parts.map(part => part.id === id.slice(5) ? { ...part, transform } : part) })) };
    return { ...document, layers: document.layers.map(layer => layer.id === id ? { ...layer, transform } : layer) };
  }
  function toWorldPosition(document: CompositionDocument, id: string, position: Position): Position {
    if (!id.startsWith('part:')) return position;
    const group = document.layers.find(layer => layer.parts.some(part => part.id === id.slice(5)))?.transform;
    if (!group) return position;
    return { x: group.pivotX + (position.x - group.pivotX) * group.scale + group.offsetX,
      y: group.pivotY + (position.y - group.pivotY) * group.scale + group.offsetY };
  }
  function fromWorldPosition(document: CompositionDocument, id: string, position: Position): Position {
    if (!id.startsWith('part:')) return position;
    const group = document.layers.find(layer => layer.parts.some(part => part.id === id.slice(5)))?.transform;
    if (!group) return position;
    return { x: group.pivotX + (position.x - group.pivotX - group.offsetX) / group.scale,
      y: group.pivotY + (position.y - group.pivotY - group.offsetY) / group.scale };
  }
  const working = draft ? transformed(present, draft.layer, withPosition(getTransform(present, draft.layer), draft.position)) : present;
  const activeTransform = working[transformKey(selectedLayer)];
  const activePosition = transformPosition(activeTransform);
  const subjectSpan = useMemo(() => sourceGeometrySpan(present.subject.svg), [present.subject.svg]);
  const modifierSpan = useMemo(() => present.modifier ? sourceGeometrySpan(present.modifier.svg) : 0, [present.modifier?.svg]);
  const scaleSpan = selectedLayer === 'subject' ? subjectSpan : modifierSpan;
  const scaleMin = selectedLayer === 'subject' ? 0.5 : 0.1;
  const scaleMax = selectedLayer === 'subject' ? 1.2 : 1.5;
  const composition = useMemo(() => {
    try {
      const value = composeIcon(toCompositionInput(present));
      lastValidResult.current = value;
      return { value, error: null };
    } catch (error) {
      return { value: lastValidResult.current!, error: error instanceof Error ? error.message : 'Could not compose these icons.' };
    }
  }, [present]);
  const baseResult = composition.value;
  const result = useMemo(() => {
    if (!draft || composition.error) return baseResult;
    try { return composeIcon(toCompositionInput(working), { preview: true }); }
    catch { return baseResult; }
  }, [draft, present, working, baseResult, composition.error]);
  const issues = useMemo<GuidelineIssue[]>(() => composition.error ? [{
    id: 'composition-error', level: 'error', title: 'This composition cannot be rendered',
    explanation: `${composition.error} Try another placement, scale, or icon. The editable project can still be saved.`,
  }] : validateComposition(toCompositionInput(present), baseResult), [present, baseResult, composition.error]);
  const selected = issues.find(issue => issue.id === selectedIssue);
  const hasErrors = issues.some(issue => issue.level === 'error');
  const viewport = { size: 32 / zoom, x: 12 + pan.x - 16 / zoom, y: 12 + pan.y - 16 / zoom };
  const modifierBounds = result.modifierBounds;
  const activeBounds = selectedPart ? result.partBounds?.[selectedPart] ?? null : selectedExtra ? result.layerBounds?.[selectedExtra] ?? null : selectedLayer === 'subject' ? result.subjectBounds : modifierBounds;
  const activeExtraLayer = present.layers.find(layer => layer.id === selectedExtra);

  function updateTransform(layer: LayerName, transform: ElementTransform) {
    if (present.baseLayers[layer].locked) return;
    commit({ ...present, [transformKey(layer)]: transform });
  }
  function updateExtraLayer(id: string, update: (layer: FragmentLayer) => FragmentLayer) {
    commit({ ...present, layers: present.layers.map(layer => layer.id === id ? update(layer) : layer) });
  }
  function updateExtraTransform(id: string, transform: ElementTransform) {
    const layer = present.layers.find(item => id === item.id || item.parts.some(part => `part:${part.id}` === id));
    if (!layer || layer.locked || (id.startsWith('part:') && layer.parts.find(part => part.id === id.slice(5))?.locked)) return;
    commit(transformed(present, id, transform));
  }
  function chooseExtra(id: string, partId: string | null = null, additive = false) {
    setSelectedExtra(id); setSelectedPart(partId);
    setSelectedPartIds(current => partId ? new Set(additive && selectedExtra === id ? current.has(partId) ? [...current].filter(value => value !== partId) : [...current, partId] : [partId]) : new Set());
  }
  function chooseBase(id: LayerName) { setSelectedLayer(id); setSelectedExtra(null); setSelectedPart(null); setSelectedPartIds(new Set()); }
  function addLayer(parts: SourcePart[], source: { name: string; version: string }, label = source.name, fragment?: SavedFragment) {
    let layer = createLayer(parts, label, source.name, source.version);
    if (fragment) layer = { ...layer, grouped: fragment.grouped,
      transform: fragment.groupTransform ?? layer.transform,
      parts: layer.parts.map((part, index) => ({ ...part, transform: fragment.parts[index].transform ?? part.transform })) };
    commit({ ...present, layers: [...present.layers, layer], layerOrder: [...present.layerOrder, layer.id] });
    chooseExtra(layer.id); setPartsSource(null); setExpanded(current => new Set([...current, layer.id]));
    setNotice(`Added ${parts.length} part${parts.length === 1 ? '' : 's'} from ${source.name}.`);
  }
  function saveFragment(parts: SourcePart[], source: { name: string; version: string }, layer?: FragmentLayer) {
    const name = window.prompt('Fragment name', `${source.name} parts`)?.trim();
    if (!name) return;
    const next = [...fragments, { id: crypto.randomUUID(), name, sourceName: source.name, sourceVersion: source.version,
      parts: parts.map((part, index) => ({ ...part, ...(layer ? { transform: layer.parts[index].transform } : {}) })),
      ...(layer ? { groupTransform: layer.transform } : {}), grouped: layer?.grouped ?? true }];
    try { parseFragments(JSON.stringify(next)); storeFragments(next); setFragments(next); setNotice(`Saved fragment ${name}.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Browser storage is full. Export your fragments as JSON.'); }
  }
  function saveFragments(next: SavedFragment[]) {
    try { parseFragments(JSON.stringify(next)); storeFragments(next); setFragments(next); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save fragments in browser storage.'); }
  }
  function changeScale(raw: number, precise = altPressed.current) {
    const bounded = Math.max(scaleMin, Math.min(scaleMax, raw));
    updateTransform(selectedLayer, { ...present[transformKey(selectedLayer)],
      scale: precise ? Math.round(bounded * 1000) / 1000 : snapScaleToPixels(bounded, scaleSpan, scaleMin, scaleMax) });
  }
  function scaleKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    const direction = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key) ? 1 :
      ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 0;
    if (direction) {
      event.preventDefault();
      const count = event.key.startsWith('Page') ? 2 : 1;
      changeScale(event.altKey ? activeTransform.scale + direction * count * 0.005 :
        stepScaleByPixels(activeTransform.scale, scaleSpan, direction as -1 | 1, scaleMin, scaleMax, count), event.altKey);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      changeScale(event.key === 'Home' ? scaleMin : scaleMax, event.altKey);
    }
  }

  function commit(next: CompositionDocument) { setHistory(current => commitHistory(current, next)); setDraft(null); }
  function undo() { setHistory(undoHistory); setDraft(null); }
  function redo() { setHistory(redoHistory); setDraft(null); }

  function cancelDrag() {
    const action = drag.current;
    if (!action) return;
    if (action.frame !== undefined) cancelAnimationFrame(action.frame);
    if (action.kind === 'pan') setPan(action.originalPan);
    if (svgRef.current?.hasPointerCapture(action.pointerId)) svgRef.current.releasePointerCapture(action.pointerId);
    drag.current = null;
    setDraft(null); setSnapFeedback(false);
  }

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => { if (event.key === 'Alt') altPressed.current = true; };
    const onUp = (event: KeyboardEvent) => { if (event.key === 'Alt' || !event.altKey) altPressed.current = false; };
    const onBlur = () => { altPressed.current = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', onBlur); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancelDrag(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); setHistory(event.shiftKey ? redoHistory : undoHistory); setDraft(null); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); setHistory(redoHistory); setDraft(null); return;
      }
      if (window.document.activeElement !== svgRef.current || drag.current || (selectedLayer === 'modifier' && !historyRef.current.present.modifier && !selectedExtra)) return;
      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const current = historyRef.current.present;
        const id = selectedPart ? `part:${selectedPart}` : selectedExtra ?? selectedLayer;
        if (selectedExtra ? current.layers.find(layer => layer.id === selectedExtra)?.locked ||
          (selectedPart && current.layers.find(layer => layer.id === selectedExtra)?.parts.find(part => part.id === selectedPart)?.locked) : current.baseLayers[selectedLayer].locked) return;
        const old = getTransform(current, id);
        const next = nudgeModifier(toWorldPosition(current, id, transformPosition(old)), event.key, gridIncrement, event.shiftKey, event.altKey);
        commit(transformed(current, id, withPosition(old, fromWorldPosition(current, id, next))));
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedExtra) {
        event.preventDefault(); const current = historyRef.current.present;
        if (current.layers.find(layer => layer.id === selectedExtra)?.locked) return;
        if (selectedPart) {
          const layers = current.layers.map(layer => layer.id === selectedExtra ? { ...layer, parts: layer.parts.filter(part => part.id !== selectedPart) } : layer).filter(layer => layer.parts.length);
          commit({ ...current, layers, layerOrder: current.layerOrder.filter(id => id === 'subject' || id === 'modifier' || layers.some(layer => layer.id === id)) });
        }
        else commit({ ...current, layers: current.layers.filter(layer => layer.id !== selectedExtra), layerOrder: current.layerOrder.filter(id => id !== selectedExtra) });
        chooseBase('subject');
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLayer === 'modifier') {
        event.preventDefault(); const current = historyRef.current.present;
        if (current.baseLayers.modifier.locked) return;
        commit({ ...current, modifier: null }); setSelectedLayer('subject');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function startPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as Element;
    const partHit = target.closest?.('[data-part-id]')?.getAttribute('data-part-id');
    const extraHit = target.closest?.('[data-layer-id]')?.getAttribute('data-layer-id');
    const modifierHit = target.closest?.('[data-drag-modifier]');
    const subjectHit = target.closest?.('[data-drag-subject]');
    const kind: Drag['kind'] = !panTool && event.button !== 1 && partHit ?
      present.layers.find(layer => layer.parts.some(part => part.id === partHit))?.locked ||
      present.layers.flatMap(layer => layer.parts).find(part => part.id === partHit)?.locked ? 'pan' : `part:${partHit}` :
      !panTool && event.button !== 1 && extraHit && !present.layers.find(layer => layer.id === extraHit)?.locked ? extraHit :
      !panTool && event.button !== 1 && modifierHit && present.modifier && !present.baseLayers.modifier.locked ? 'modifier' :
      !panTool && event.button !== 1 && subjectHit && !present.baseLayers.subject.locked ? 'subject' : 'pan';
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    drag.current = {
      kind, pointerId: event.pointerId,
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      startClient: { x: event.clientX, y: event.clientY },
      originalPosition: kind === 'pan' ? { x: 0, y: 0 } : toWorldPosition(present, kind, transformPosition(getTransform(present, kind))), originalPan: pan,
    };
    if (kind === 'subject' || kind === 'modifier') chooseBase(kind);
    else if (kind.startsWith('part:')) chooseExtra(extraHit!, kind.slice(5));
    else if (kind !== 'pan') chooseExtra(kind);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    event.preventDefault();
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    const start = screenToSvg(action.startClient, action.matrix);
    const current = screenToSvg({ x: event.clientX, y: event.clientY }, action.matrix);
    const delta = { x: current.x - start.x, y: current.y - start.y };
    if (action.kind === 'pan') { setPan({ x: action.originalPan.x - delta.x, y: action.originalPan.y - delta.y }); return; }
    const moved = moveModifier(action.originalPosition, delta, { enabled: snap, increment: gridIncrement, alt: event.altKey });
    action.pending = fromWorldPosition(present, action.kind, moved.position);
    setSnapFeedback(moved.snapped);
    if (action.frame === undefined) action.frame = requestAnimationFrame(() => {
       if (drag.current === action && action.kind !== 'pan' && action.pending) { setDraft({ layer: action.kind, position: action.pending }); action.frame = undefined; }
    });
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    if (action.frame !== undefined) cancelAnimationFrame(action.frame);
    drag.current = null;
    if (!cancelled && action.kind !== 'pan' && action.pending) {
      const current = historyRef.current.present;
       const old = getTransform(current, action.kind);
       commit(transformed(current, action.kind, withPosition(old, action.pending)));
    } else if (cancelled && action.kind === 'pan') setPan(action.originalPan);
    setDraft(null); setSnapFeedback(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function choose(which: 'subject' | 'modifier', name: string) {
    if (present.baseLayers[which].locked) { setLibraryMessage(`Unlock the ${which} layer to replace its icon.`); return; }
    const request = ++choiceSerial.current[which];
    setLibraryMessage(`Loading ${name}…`);
    try {
      const catalog = await loadCatalog();
      const icon = await loadIcon(name, catalog);
      if (request !== choiceSerial.current[which]) return;
      setHistory(current => commitHistory(current, {
        ...current.present, [which]: icon, lucideVersion: catalog.version,
        ...(which === 'modifier' ? { modifierTransform: defaultModifierTransform(icon.svg,
          transformPosition(current.present.modifierTransform),
          snapScaleToPixels(current.present.modifierTransform.scale, sourceGeometrySpan(icon.svg), 0.1, 1.5)) } : {}),
      }));
      setDraft(null);
      chooseBase(which); setSelectedIssue(null); setLibraryMessage(''); setNotice('');
    } catch (error) {
      if (request === choiceSerial.current[which]) setLibraryMessage(error instanceof Error ? error.message : 'Could not load that icon.');
    }
  }
  async function selectParts(name: string) {
    setLibraryMessage(`Loading ${name} parts…`);
    try {
      const catalog = await loadCatalog();
      const icon = await loadIcon(name, catalog);
      setPartsSource({ name: icon.name, svg: icon.svg, version: catalog.version });
      setLibraryMessage('');
    } catch (error) { setLibraryMessage(error instanceof Error ? error.message : 'Could not load icon parts.'); }
  }
  function reorder(id: string, direction: -1 | 1) {
    const order = [...present.layerOrder]; const index = order.indexOf(id); const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    commit({ ...present, layerOrder: order });
  }
  function duplicateLayer(layer: FragmentLayer) {
    const duplicate = { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy`,
      parts: layer.parts.map(part => ({ ...part, id: crypto.randomUUID() })) };
    const index = present.layerOrder.indexOf(layer.id);
    const order = [...present.layerOrder]; order.splice(index + 1, 0, duplicate.id);
    commit({ ...present, layers: [...present.layers, duplicate], layerOrder: order }); chooseExtra(duplicate.id);
  }
  function groupSelected(layer: FragmentLayer) {
    const ids = selectedPartIds.size ? selectedPartIds : new Set(layer.parts.map(part => part.id));
    const selected = layer.parts.filter(part => ids.has(part.id));
    if (!selected.length) return;
    if (selected.length === layer.parts.length) {
      updateExtraLayer(layer.id, item => ({ ...item, grouped: true }));
      chooseExtra(layer.id); return;
    }
    const group = { ...layer, id: crypto.randomUUID(), name: `${layer.name} group`, parts: selected, grouped: true };
    const order = [...present.layerOrder]; order.splice(order.indexOf(layer.id) + 1, 0, group.id);
    commit({ ...present, layers: [...present.layers.map(item => item.id === layer.id ? { ...item, parts: item.parts.filter(part => !ids.has(part.id)) } : item), group], layerOrder: order });
    chooseExtra(group.id); setExpanded(current => new Set([...current, group.id]));
  }
  function removeLayer(id: string) {
    commit({ ...present, layers: present.layers.filter(layer => layer.id !== id), layerOrder: present.layerOrder.filter(item => item !== id) });
    chooseBase('subject');
  }
  function setBaseMeta(id: LayerName, field: 'visible' | 'locked' | 'cutout', value: boolean) {
    commit({ ...present, baseLayers: { ...present.baseLayers, [id]: { ...present.baseLayers[id], [field]: value } } });
  }
  function place(anchor: CompositionDocument['modifierAnchor']) {
    if (present.baseLayers.modifier.locked) return;
    commit({ ...present, modifierAnchor: anchor, modifierTransform: withPosition(present.modifierTransform, anchorPositions[anchor]) });
  }
  function fit() {
    const bounds = (result.layerBounds ? Object.values(result.layerBounds) : [result.subjectBounds, result.modifierBounds]).filter(b => b !== null);
    const left = Math.min(0, ...bounds.map(b => b.x - 1));
    const top = Math.min(0, ...bounds.map(b => b.y - 1));
    const right = Math.max(24, ...bounds.map(b => b.x + b.width + 1));
    const bottom = Math.max(24, ...bounds.map(b => b.y + b.height + 1));
    setZoom(Math.max(0.5, Math.min(5, 32 / (Math.max(right - left, bottom - top) + 4))));
    setPan({ x: (left + right) / 2 - 12, y: (top + bottom) / 2 - 12 });
  }
  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }
  async function copySvg() {
    try { await navigator.clipboard.writeText(baseResult.svg); setNotice('SVG copied to clipboard.'); }
    catch { setNotice('Clipboard unavailable. Download the SVG instead.'); }
  }
  async function reopen(file: File | undefined) {
    if (!file) return;
    try {
      const restored = parseDocument(await file.text());
      choiceSerial.current.subject++;
      choiceSerial.current.modifier++;
      commit(restored);
      setSelectedLayer(restored.modifier ? 'modifier' : 'subject');
      setSelectedExtra(null); setSelectedPart(null);
      setNotice(`Opened ${file.name}.`);
      setSelectedIssue(null);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open composition.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  const highlight = (layer: 'subject' | 'modifier', index: number) => showDiagnostics && selected?.target?.layer === layer && selected.target.indices.includes(index);

  return <main className="designer-page">
    <header className="designer-header">
      <div><p className="eyebrow">Lucide icon designer</p><h1><span>Compose</span> with precision.</h1><p className="subtitle">Choose a subject and modifier, then place the detail yourself. The cutout follows your work.</p></div>
      <div className="header-actions"><button type="button" onClick={openProof}>Geometry inspection ↗</button><span className="live-pill">● Live vector preview</span></div>
    </header>
    <div className="designer-layout">
      <aside className="panel control-panel" aria-label="Icon selection">
        <div className="panel-heading"><span>01 / Select</span><h2>Source icons</h2></div>
        <IconPicker title="Subject" selected={present.subject.name} onChoose={name => choose('subject', name)} onSelectParts={selectParts} />
        <IconPicker title="Modifier" selected={present.modifier?.name ?? null} onChoose={name => choose('modifier', name)} onSelectParts={selectParts} />
        <button type="button" className="text-button" onClick={() => selectParts(present.subject.name)}>Break Apart subject · Select Parts</button>
        {present.modifier && <button type="button" className="text-button" onClick={() => selectParts(present.modifier!.name)}>Break Apart modifier · Select Parts</button>}
        {libraryMessage && <p className="field-help" role="status">{libraryMessage}</p>}
        {!present.modifier && <p className="field-help">No modifier selected. Choose one to resume composing.</p>}
        <p className="field-help">Browse the complete installed Lucide library for either layer. Original source paths stay in the editable project.</p>
        <div className="layer-panel"><h3>Composition layers</h3><p className="field-help">Front to back · expand to edit elements. Shift+click elements to group a subset.</p>
          {[...present.layerOrder].reverse().map(id => {
            const base = id === 'subject' || id === 'modifier';
            const layer = base ? null : present.layers.find(item => item.id === id);
            if (!base && !layer) return null;
            const meta = base ? present.baseLayers[id as LayerName] : layer!;
            const label = base ? (id === 'subject' ? present.subject.name : present.modifier?.name ?? 'Modifier') : layer!.name;
            return <div className="layer-entry" key={id}><div className="layer-row">
              {layer && <button type="button" aria-label={`${expanded.has(id) ? 'Collapse' : 'Expand'} ${label}`} onClick={() => setExpanded(current => {
                const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
              })}>{expanded.has(id) ? '▾' : '▸'}</button>}
              <button type="button" className="layer-name" aria-pressed={selectedExtra === id || (!selectedExtra && selectedLayer === id)}
                onClick={() => base ? chooseBase(id as LayerName) : chooseExtra(id)}>{label}{base ? ` · ${id}` : ''}</button>
              <button type="button" aria-label={`${meta.visible ? 'Hide' : 'Show'} ${label}`} onClick={() => base ? setBaseMeta(id as LayerName, 'visible', !meta.visible) : updateExtraLayer(id, item => ({ ...item, visible: !item.visible }))}>{meta.visible ? '◉' : '○'}</button>
              <button type="button" aria-label={`${meta.locked ? 'Unlock' : 'Lock'} ${label}`} onClick={() => base ? setBaseMeta(id as LayerName, 'locked', !meta.locked) : updateExtraLayer(id, item => ({ ...item, locked: !item.locked }))}>{meta.locked ? '🔒' : '♧'}</button>
            </div><div className="layer-small-actions"><button type="button" disabled={present.layerOrder.indexOf(id) === present.layerOrder.length - 1} onClick={() => reorder(id, 1)}>Move front</button>
              <button type="button" disabled={present.layerOrder.indexOf(id) === 0} onClick={() => reorder(id, -1)}>Move back</button></div>
              {layer && expanded.has(id) && <div className="layer-children">{layer.parts.map(part => <div key={part.id} className="layer-child">
                <button type="button" aria-pressed={selectedPartIds.has(part.id)} onClick={event => chooseExtra(id, part.id, event.shiftKey)}>{part.label}</button>
                <button type="button" disabled={layer.locked || part.locked} aria-label={`${part.visible ? 'Hide' : 'Show'} ${part.label}`} onClick={() => updateExtraLayer(id, item => ({ ...item, parts: item.parts.map(child => child.id === part.id ? { ...child, visible: !child.visible } : child) }))}>{part.visible ? '◉' : '○'}</button>
                <button type="button" disabled={layer.locked || part.locked} aria-label={`Remove ${part.label}`} onClick={() => {
                  if (layer.parts.length === 1) removeLayer(id);
                  else updateExtraLayer(id, item => ({ ...item, parts: item.parts.filter(child => child.id !== part.id) }));
                }}>×</button></div>)}</div>}
            </div>;
          })}
        </div>
        <div className="fragment-panel"><h3>Saved fragments</h3><input type="search" aria-label="Search fragments" placeholder="Search fragments" value={fragmentQuery} onChange={event => setFragmentQuery(event.target.value)} />
          {fragments.filter(fragment => `${fragment.name} ${fragment.sourceName}`.toLowerCase().includes(fragmentQuery.toLowerCase())).map(fragment => <div className="fragment-entry" key={fragment.id}>
            <FragmentPreview fragment={fragment} /><strong>{fragment.name}</strong><small>{fragment.parts.length} elements · {fragment.sourceName}</small>
            <div><button type="button" onClick={() => addLayer(fragment.parts, { name: fragment.sourceName, version: fragment.sourceVersion }, fragment.name, fragment)}>Add</button>
              <button type="button" onClick={() => { const name = window.prompt('Rename fragment', fragment.name)?.trim(); if (name) saveFragments(fragments.map(item => item.id === fragment.id ? { ...item, name } : item)); }}>Rename</button>
              <button type="button" onClick={() => saveFragments(fragments.filter(item => item.id !== fragment.id))}>Delete</button></div></div>)}
          <div className="fragment-actions"><button type="button" onClick={() => saveFile('lucide-fragments.json', JSON.stringify(fragments, null, 2), 'application/json')}>Export fragments</button>
            <button type="button" onClick={() => fragmentFileInput.current?.click()}>Import fragments</button></div>
          <input ref={fragmentFileInput} type="file" accept=".json,application/json" hidden onChange={async event => {
            const file = event.target.files?.[0]; if (!file) return;
            try { const incoming = parseFragments(await file.text()); saveFragments([...fragments, ...incoming.map(item => ({ ...item, id: crypto.randomUUID() }))]); setNotice(`Imported ${incoming.length} fragments.`); }
            catch (error) { setNotice(error instanceof Error ? error.message : 'Could not import fragments.'); }
            event.target.value = '';
          }} /></div>
      </aside>

      <section className="panel canvas-panel" aria-label="Editing canvas">
        <div className="canvas-toolbar"><div><strong>24 × 24 canvas</strong><span>Drag either layer · drag empty space to pan</span></div><div className="tool-buttons">
          <button type="button" aria-label="Undo" title="Undo (Ctrl or Cmd+Z)" disabled={!history.past.length} onClick={undo}>↶</button>
          <button type="button" aria-label="Redo" title="Redo (Ctrl or Cmd+Shift+Z)" disabled={!history.future.length} onClick={redo}>↷</button>
          <button type="button" aria-pressed={panTool} className={panTool ? 'active' : ''} onClick={() => setPanTool(value => !value)}>Pan</button>
          <button type="button" aria-pressed={showGrid} className={showGrid ? 'active' : ''} onClick={() => setShowGrid(value => !value)}>Grid</button>
          <button type="button" aria-pressed={snap} className={snap ? 'active' : ''} onClick={() => setSnap(value => !value)}>Snap</button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.5, roundPosition(value / 1.25)))}>−</button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(5, roundPosition(value * 1.25)))}>+</button>
          <button type="button" onClick={fit}>Fit</button><button type="button" onClick={resetView}>Reset view</button>
        </div></div>
        <div className="canvas-options">
          <label>Grid step <select aria-label="Grid increment" value={gridIncrement} onChange={event => setGridIncrement(Number(event.target.value) as GridIncrement)}><option value="1">1 unit</option><option value="0.5">0.5 unit</option><option value="0.25">0.25 unit</option></select></label>
          <label><input type="checkbox" checked={showSafe} onChange={event => setShowSafe(event.target.checked)} /> Safe area</label>
          <label><input type="checkbox" checked={showExclusion} onChange={event => setShowExclusion(event.target.checked)} /> Cutout area</label>
          <label><input type="checkbox" checked={showDiagnostics} onChange={event => setShowDiagnostics(event.target.checked)} /> Diagnostics</label>
        </div>
        <div className="canvas-wrap"><svg ref={svgRef} className={`editor-svg ${panTool ? 'is-panning' : ''}`} viewBox={`${viewport.x} ${viewport.y} ${viewport.size} ${viewport.size}`} tabIndex={0} role="application" aria-label="Editable icon canvas; arrows move selected layer" onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={event => endPointer(event)} onPointerCancel={event => endPointer(event, true)} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}>
          <defs><pattern id="unit-grid" width={gridIncrement} height={gridIncrement} patternUnits="userSpaceOnUse"><path d={`M ${gridIncrement} 0 L 0 0 0 ${gridIncrement}`} fill="none" stroke="#e6e6e8" strokeWidth="0.025" /></pattern></defs>
          <rect x={viewport.x} y={viewport.y} width={viewport.size} height={viewport.size} className="canvas-surround" />
          <rect x="0" y="0" width="24" height="24" className="artboard" />
          {showGrid && <rect x="0" y="0" width="24" height="24" fill="url(#unit-grid)" pointerEvents="none" />}
          {showSafe && <rect x="1" y="1" width="22" height="22" className="safe-guide" pointerEvents="none" />}
          {showExclusion && present.modifier && <g className="exclusion-guide" fill="none" stroke="currentColor" strokeWidth={result.exclusionRadius * 2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">{result.modifierPaths.map((d, index) => <path key={index} d={d} />)}</g>}
          {result.layerPaths ? present.layerOrder.map(id => {
            const paths = result.layerPaths?.[id] ?? [];
            const bounds = result.layerBounds?.[id];
            const layer = present.layers.find(item => item.id === id);
            return <g key={id} data-layer-id={layer ? id : undefined} data-drag-subject={id === 'subject' ? 'true' : undefined} data-drag-modifier={id === 'modifier' ? 'true' : undefined}
              className={id === 'subject' ? 'canvas-subject' : id === 'modifier' ? 'canvas-modifier' : 'canvas-fragment'}>
              <Layer paths={paths} className="canvas-layer-paths" />
              {showDiagnostics && selected?.target?.layer === id && paths.map((d, index) => selected.target!.indices.includes(index) &&
                <path key={`highlight-${index}`} d={d} className="geometry-highlight" />)}
              {bounds && <rect className="layer-hitbox" x={bounds.x - .7} y={bounds.y - .7} width={bounds.width + 1.4} height={bounds.height + 1.4} />}
              {layer && !layer.grouped && layer.parts.filter(part => part.visible).map(part => <g key={part.id} data-part-id={part.id} data-layer-id={id} className="part-hit-shape">
                {(result.partPaths?.[part.id] ?? []).map((d, index) => <path key={index} d={d} />)}</g>)}
            </g>;
          }) : <>{result.subjectBounds && <rect data-drag-subject="true" className="subject-hit" x={result.subjectBounds.x - 1} y={result.subjectBounds.y - 1} width={result.subjectBounds.width + 2} height={result.subjectBounds.height + 2} />}
            <Layer paths={result.subjectPaths} className={selectedLayer === 'subject' ? 'canvas-subject selected-layer' : 'canvas-subject'} data-drag-subject="true" />
            <Layer paths={result.modifierPaths} className="canvas-modifier" /></>}
          {showDiagnostics && result.subjectPaths.map((d, index) => highlight('subject', index) && <path key={`subject-${index}`} d={d} className="geometry-highlight" />)}
          {showDiagnostics && result.modifierPaths.map((d, index) => highlight('modifier', index) && <path key={`modifier-${index}`} d={d} className="geometry-highlight" />)}
          {!result.layerPaths && modifierBounds && <g data-drag-modifier="true" className={`modifier-hit ${selectedLayer === 'modifier' ? 'selected' : ''}`}>
            <rect x={modifierBounds.x - 1} y={modifierBounds.y - 1} width={modifierBounds.width + 2} height={modifierBounds.height + 2} />
          </g>}
          {activeBounds && <g className={`selection-indicator ${selectedLayer}`} pointerEvents="none">
            {(selectedLayer === 'subject' || selectedExtra) && <rect x={activeBounds.x - 1} y={activeBounds.y - 1} width={activeBounds.width + 2} height={activeBounds.height + 2} />}
            {!selectedExtra && <circle cx={activePosition.x} cy={activePosition.y} r="0.26" />}
          </g>}
        </svg>{composition.error && <div className="composition-error-overlay" role="status"><strong>Preview unavailable</strong><span>{composition.error}</span><span>Try another icon, position, or scale. Your editable project is preserved.</span></div>}</div>
        <div className="canvas-footer"><span><i className="legend-subject" /> Subject <i className="legend-modifier" /> Modifier <i className="legend-safe" /> 1px safe area</span>
          <span>{selectedExtra ? (() => { const id = selectedPart ? `part:${selectedPart}` : selectedExtra;
            const position = toWorldPosition(working, id, transformPosition(getTransform(working, id)));
            return `${selectedPart ? 'element' : 'group'} ${position.x.toFixed(2)}, ${position.y.toFixed(2)}`; })() : `${selectedLayer} ${activePosition.x.toFixed(2)}, ${activePosition.y.toFixed(2)}`}{snapFeedback ? ' · Snapped' : ''} · {result.svg.match(/<path /g)?.length ?? 0} output paths</span></div>
      </section>

      <aside className="panel feedback-panel" aria-label="Properties and validation">
        <div className="panel-heading"><span>02 / Refine</span><h2>{activeExtraLayer ? selectedPart ? 'Element properties' : 'Group properties' : `${selectedLayer === 'modifier' ? 'Modifier' : 'Subject'} properties`}</h2></div>
        <div className="selection-row"><button type="button" aria-pressed={!selectedExtra && selectedLayer === 'subject'} onClick={() => chooseBase('subject')}>Subject</button><button type="button" aria-pressed={!selectedExtra && selectedLayer === 'modifier'} disabled={!present.modifier} onClick={() => chooseBase('modifier')}>Modifier</button></div>
        {activeExtraLayer && <div className="extra-properties">
          {activeExtraLayer.locked && <p className="field-help">This layer is locked. Unlock it in Composition layers to edit it.</p>}
          <fieldset disabled={activeExtraLayer.locked || !!(selectedPart && activeExtraLayer.parts.find(part => part.id === selectedPart)?.locked)}>
          <label className="property-field">{selectedPart ? 'Element' : 'Group'} name<input type="text" aria-label="Layer name" value={activeExtraLayer.name} disabled={!!selectedPart} onChange={event => updateExtraLayer(activeExtraLayer.id, layer => ({ ...layer, name: event.target.value }))} /></label>
          <p className="field-help">{selectedPart ? 'You are editing one source element.' : `You are editing the ${activeExtraLayer.grouped ? 'whole group' : 'layer'}; ${activeExtraLayer.parts.length} source elements stay separate.`}</p>
          {(() => { const target = selectedPart ? activeExtraLayer.parts.find(part => part.id === selectedPart) : activeExtraLayer;
            if (!target) return null;
            const id = selectedPart ? `part:${selectedPart}` : activeExtraLayer.id;
            const current = target.transform; const position = toWorldPosition(present, id, transformPosition(current));
            const change = (transform: ElementTransform) => updateExtraTransform(id, transform);
            return <><div className="number-row"><label>X position<input type="number" step="0.1" value={roundPosition(position.x)} onChange={event => Number.isFinite(event.target.valueAsNumber) && change(withPosition(current, fromWorldPosition(present, id, { ...position, x: event.target.valueAsNumber })))} /></label>
              <label>Y position<input type="number" step="0.1" value={roundPosition(position.y)} onChange={event => Number.isFinite(event.target.valueAsNumber) && change(withPosition(current, fromWorldPosition(present, id, { ...position, y: event.target.valueAsNumber })))} /></label></div>
              <label className="field slider-field">Scale <output>{(current.scale * 100).toFixed(1)}%</output><input type="range" min="0.1" max="2" step="any" value={current.scale} style={rangeStyle(current.scale, 0.1, 2)} aria-label={`${selectedPart ? 'Element' : 'Group'} scale`}
                onChange={event => { const bounds = selectedPart ? result.partBounds?.[selectedPart] : result.layerBounds?.[activeExtraLayer.id];
                  const currentSpan = bounds ? Math.max(bounds.width, bounds.height) / current.scale / (selectedPart ? activeExtraLayer.transform.scale : 1) : 0;
                  const sourceSpan = currentSpan > 0 ? currentSpan : sourceGeometrySpan(selectedPart ? activeExtraLayer.parts.find(part => part.id === selectedPart)!.svg : partsSvg(activeExtraLayer.parts));
                  change({ ...current, scale: altPressed.current ? Number(event.target.value) : snapScaleToPixels(Number(event.target.value), sourceSpan, 0.1, 2) }); }} /></label>
              <button type="button" className="text-button" onClick={() => change({ ...current, scale: 1, offsetX: 0, offsetY: 0 })}>Restore original geometry</button></>;
          })()}
          {selectedPart && !activeExtraLayer.grouped && <button type="button" className="text-button" onClick={() => groupSelected(activeExtraLayer)}>Group selected ({selectedPartIds.size})</button>}
          {!selectedPart && <><div className="fragment-actions"><button type="button" onClick={() => activeExtraLayer.grouped ? updateExtraLayer(activeExtraLayer.id, layer => ({ ...layer, grouped: false })) : groupSelected(activeExtraLayer)}>{activeExtraLayer.grouped ? 'Ungroup' : selectedPartIds.size ? `Group selected (${selectedPartIds.size})` : 'Group elements'}</button>
            <button type="button" onClick={() => duplicateLayer(activeExtraLayer)}>Duplicate</button><button type="button" onClick={() => removeLayer(activeExtraLayer.id)}>Delete</button></div>
            <label className="property-field">Layer behavior<select value={activeExtraLayer.cutout ? 'cutout' : 'overlay'} onChange={event => updateExtraLayer(activeExtraLayer.id, layer => ({ ...layer, cutout: event.target.value === 'cutout' }))}>
              <option value="cutout">Cutout lower layers</option><option value="overlay">Overlay</option></select></label>
            <button type="button" className="text-button" onClick={() => saveFragment(activeExtraLayer.parts.map(part => ({ id: part.sourceId ?? part.id, label: part.label, tag: part.tag, svg: part.svg })),
              { name: activeExtraLayer.sourceName, version: activeExtraLayer.sourceVersion }, activeExtraLayer)}>Save as fragment</button></>}
          </fieldset>
        </div>}
        {!selectedExtra && <fieldset className="base-edit-fields" disabled={present.baseLayers[selectedLayer].locked}>
        {selectedLayer === 'modifier' && present.modifier && <label className="property-field">Placement anchor<select aria-label="Placement anchor" value={present.modifierAnchor} onChange={event => place(event.target.value as CompositionDocument['modifierAnchor'])}>
            {Object.keys(anchorPositions).map(anchor => <option key={anchor} value={anchor}>{anchor}</option>)}
          </select></label>}
        <label className="property-field">Layer behavior<select aria-label={`${selectedLayer === 'subject' ? 'Subject' : 'Modifier'} layer behavior`}
          value={present.baseLayers[selectedLayer].cutout ? 'cutout' : 'overlay'} onChange={event => setBaseMeta(selectedLayer, 'cutout', event.target.value === 'cutout')}>
          <option value="cutout">Cutout lower layers</option><option value="overlay">Overlay</option></select></label>
        {(selectedLayer === 'subject' || present.modifier) && <>
          <div className="number-row"><label>X position<input aria-label="X position" type="number" step="0.1" value={roundPosition(activePosition.x)} onChange={event => Number.isFinite(event.target.valueAsNumber) && updateTransform(selectedLayer, withPosition(present[transformKey(selectedLayer)], { ...activePosition, x: event.target.valueAsNumber }))} /></label>
            <label>Y position<input aria-label="Y position" type="number" step="0.1" value={roundPosition(activePosition.y)} onChange={event => Number.isFinite(event.target.valueAsNumber) && updateTransform(selectedLayer, withPosition(present[transformKey(selectedLayer)], { ...activePosition, y: event.target.valueAsNumber }))} /></label></div>
          <label className="field slider-field">Scale <output>{(activeTransform.scale * 100).toFixed(1)}%</output><input aria-label={`${selectedLayer === 'subject' ? 'Subject' : 'Modifier'} scale`} type="range" min={scaleMin} max={scaleMax} step="any" value={activeTransform.scale} style={rangeStyle(activeTransform.scale, scaleMin, scaleMax)} onChange={event => changeScale(Number(event.target.value))} onKeyDown={scaleKey} /></label>
          <div className="number-row"><label>Pivot X<input aria-label="Pivot X" type="number" step="0.1" value={activeTransform.pivotX} onChange={event => Number.isFinite(event.target.valueAsNumber) && updateTransform(selectedLayer, { ...present[transformKey(selectedLayer)], pivotX: event.target.valueAsNumber })} /></label>
            <label>Pivot Y<input aria-label="Pivot Y" type="number" step="0.1" value={activeTransform.pivotY} onChange={event => Number.isFinite(event.target.valueAsNumber) && updateTransform(selectedLayer, { ...present[transformKey(selectedLayer)], pivotY: event.target.valueAsNumber })} /></label></div>
          <button type="button" className="text-button" onClick={() => updateTransform(selectedLayer, selectedLayer === 'subject' ? { ...DEFAULT_SUBJECT_TRANSFORM } : defaultModifierTransform(present.modifier!.svg, anchorPositions[present.modifierAnchor]))}>Reset Transform</button>
          <p className="field-help">Scale snaps the longest path dimension to whole pixels. Hold Alt for 0.1% precision. Exported strokes stay 2 units wide.</p>
          {selectedLayer === 'modifier' && <button type="button" className="text-button danger" onClick={() => { commit({ ...present, modifier: null }); setSelectedLayer('subject'); }}>Remove modifier</button>}
        </>}
        </fieldset>}
        <div className="control-divider" />
        <label className="field slider-field">Visible clearance <output>{present.clearance.toFixed(1)} units</output><input aria-label="Visible clearance" type="range" min="0" max="4" step="0.1" value={present.clearance} style={rangeStyle(present.clearance, 0, 4)} onChange={event => commit({ ...present, clearance: Number(event.target.value) })} /></label>
        <p className="field-help">Measured edge to edge between the rendered strokes.</p>
        <div className="control-divider" />
        <div className="panel-heading compact"><span>03 / Validate</span><h2>Design guidance</h2></div>
        <p className="feedback-intro">Measured checks follow Lucide's 24×24 canvas, 2-unit strokes, round ends, and visible spacing.</p>
        <div className="issue-count"><strong>{issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to review` : 'Measured checks pass'}</strong><span>{issues.filter(issue => issue.level === 'error').length} errors · {issues.filter(issue => issue.level === 'warning').length} warnings · {issues.filter(issue => issue.level === 'suggestion').length} suggestions</span></div>
        {draft && <p className="drag-feedback">Guidance refreshes when the drag ends.</p>}
        <div className="issue-list" aria-live={draft ? 'off' : 'polite'}>{!issues.length ? <div className="no-issues">✓ No measured issues. Check actual-size previews before export.</div> : issues.map((issue: GuidelineIssue) =>
          <button type="button" key={issue.id} className={`issue ${issue.level} ${selectedIssue === issue.id ? 'selected' : ''}`} onClick={() => setSelectedIssue(value => value === issue.id ? null : issue.id)}>
            <span>{issue.level}</span><strong>{issue.title}</strong><small>{issue.explanation}</small>{issue.target && <em>Show affected geometry</em>}
          </button>)}</div>
        <a className="guideline-link" href="https://lucide.dev/contribute/icons/design-principles" target="_blank" rel="noreferrer">Lucide design principles ↗</a>
      </aside>
    </div>
    <div className="lower-layout">
      <section className="panel size-panel"><div className="panel-heading horizontal"><div><span>04 / Inspect</span><h2>Actual-size previews</h2></div><button type="button" onClick={() => setDarkPreview(value => !value)}>{darkPreview ? 'Dark' : 'Light'} background ↕</button></div>
        {composition.error ? <p className="field-help">Previews will return when this composition can be rendered.</p> :
          <div className="actual-row">{[16, 24, 32, 48].map(size => <ActualPreview key={size} result={result} size={size} dark={darkPreview} />)}</div>}</section>
      <section className="panel export-panel"><div className="panel-heading"><span>05 / Export</span><h2>Finish or continue later</h2></div>
        <div className="export-buttons"><button type="button" className="primary" disabled={hasErrors || !!draft} onClick={copySvg}>Copy SVG</button>
          <button type="button" disabled={hasErrors || !!draft} onClick={() => saveFile(`${present.subject.name}-${present.modifier?.name ?? 'solo'}.svg`, baseResult.svg, 'image/svg+xml')}>Download SVG</button>
          <button type="button" disabled={!!draft} onClick={() => saveFile(`${present.subject.name}-${present.modifier?.name ?? 'solo'}.json`, serializeDocument(present), 'application/json')}>Save editable JSON</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Open JSON</button></div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => reopen(event.target.files?.[0])} />
        <p className="export-note">The SVG contains transformed, trimmed stroke paths. The JSON preserves both sources and transforms.</p>
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>
    </div>
    <p className="keyboard-note">Canvas keyboard: arrows move the selected layer or element one grid step, Shift+arrow moves 2 units, Alt+arrow moves 0.1. Alt while dragging bypasses snapping. Escape cancels a drag. Delete removes the selection.</p>
    {partsSource && <PartSelector name={partsSource.name} svg={partsSource.svg} onCancel={() => setPartsSource(null)}
      onAdd={parts => addLayer(parts, { name: partsSource.name, version: partsSource.version })}
      onSave={parts => saveFragment(parts, { name: partsSource.name, version: partsSource.version })} />}
  </main>;
}
