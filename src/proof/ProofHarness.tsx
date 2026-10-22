import { useMemo, useState } from 'react';
import { composeIcon } from '../engine/compose';
import { examples, modifiers, subjects } from './icons';

function Preview({ label, layer, note }: { label: string; layer: React.ReactNode; note: string }) {
  return <section className="preview-card">
    <div className="preview-heading"><strong>{label}</strong><span>{note}</span></div>
    <div className="preview-stage"><div className="preview-art">{layer}</div></div>
  </section>;
}

function SvgLayer({ paths, className = '', strokeWidth = 2 }: { paths: string[]; className?: string; strokeWidth?: number }) {
  return <div className={`svg-layer ${className}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {paths.map((d, index) => <path key={index} d={d} />)}
  </svg></div>;
}

export function ProofHarness() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [clearance, setClearance] = useState(2);
  const [scale, setScale] = useState<number>(examples[0].scale);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const example = examples[exampleIndex];
  const input = {
    subjectSvg: subjects[example.subject],
    modifierSvg: modifiers[example.modifier],
    placement: { anchor: 'bottom-right' as const, offsetX, offsetY, scale },
    composition: { mode: 'cutout' as const, clearance },
  };
  const result = useMemo(() => composeIcon(input), [exampleIndex, clearance, scale, offsetX, offsetY]);

  return <main className="page">
    <header className="page-header">
      <div><p className="eyebrow">Geometry proof · Phase 1</p><h1>Lucide Icon Composer</h1>
        <p className="subtitle">Subject + modifier, joined by measured space. Inspect the source paths, exclusion zone, and trimmed result side by side.</p>
      </div>
      <span className="status"><span className="status-dot" /> Live vector cutout</span>
    </header>

    <section className="workbench">
      <aside className="controls">
        <div className="section-title"><span>01</span><h2>Proof controls</h2></div>
        <label className="field">Combination
          <select value={exampleIndex} onChange={event => {
            const nextIndex = Number(event.target.value);
            setExampleIndex(nextIndex); setScale(examples[nextIndex].scale); setOffsetX(0); setOffsetY(0);
          }}>
            {examples.map((item, index) => <option value={index} key={item.title}>{item.title}</option>)}
          </select>
        </label>
        <label className="field">Visible stroke gap <output>{clearance.toFixed(1)} px</output>
          <input type="range" min="0" max="4" step="0.1" value={clearance} onChange={event => setClearance(Number(event.target.value))} />
        </label>
        <label className="field">Modifier scale <output>{scale.toFixed(2)}×</output>
          <input type="range" min="0.25" max="0.75" step="0.01" value={scale} onChange={event => setScale(Number(event.target.value))} />
        </label>
        <div className="offsets">
          <label className="field">X offset<input type="number" min="-8" max="8" step="0.25" value={offsetX} onChange={event => setOffsetX(Number(event.target.value))} /></label>
          <label className="field">Y offset<input type="number" min="-8" max="8" step="0.25" value={offsetY} onChange={event => setOffsetY(Number(event.target.value))} /></label>
        </div>
        <div className="method-note"><strong>Measured edge to edge</strong><p>The gap is measured between the two rendered 2px strokes. At a 2px setting, their centerlines stay at least 4px apart. The result remains editable stroke paths.</p></div>
      </aside>

      <div className="inspection">
        <div className="section-title"><span>02</span><h2>Geometry inspection</h2></div>
        <div className="preview-grid">
          <Preview label="Original" note="Uncut source paths" layer={<><SvgLayer paths={result.originalSubjectPaths} className="subject" /><SvgLayer paths={result.modifierPaths} className="modifier" /></>} />
          <Preview label="Exclusion" note={`Centerline threshold ${result.exclusionRadius.toFixed(2)} px`} layer={<><SvgLayer paths={result.originalSubjectPaths} className="subject faded" /><SvgLayer paths={result.modifierPaths} strokeWidth={result.exclusionRadius * 2} className="exclusion" /><SvgLayer paths={result.modifierPaths} className="modifier" /></>} />
          <Preview label="Result" note="Trimmed centerlines" layer={<SvgLayer paths={[...result.subjectPaths, ...result.modifierPaths]} className="result" />} />
        </div>
        <div className="details">
          <div><span className="detail-label">Subject fragments</span><strong>{result.subjectPaths.length}</strong></div>
          <div><span className="detail-label">Modifier paths</span><strong>{result.modifierPaths.length}</strong></div>
          <div><span className="detail-label">Export</span><strong>24 × 24 / 2px</strong></div>
        </div>
        {result.warnings.length > 0 && <div className="warnings" role="status">{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      </div>
    </section>
    <section className="source-panel">
      <div className="section-title"><span>03</span><h2>Generated SVG</h2></div>
      <p>Stroke geometry only. No masks, overlays, clipping paths, or raster data.</p>
      <pre><code>{result.svg}</code></pre>
    </section>
    <footer>Advanced geometry inspection for the editor's precise cutout engine.</footer>
  </main>;
}
