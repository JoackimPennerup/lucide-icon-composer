# Lucide Icon Designer

A manual SVG composition tool for 24×24 Lucide icons. Any canonical icon in the pinned `lucide-static` package can be a subject, modifier, or source for reusable parts. Position and scale layers independently, then export real stroke-path cutouts. The Phase 1 geometry proof remains available from **Geometry inspection**.

## Run and verify

Requires Node.js 22.12 or later. The browser interaction suite uses an installed Google Chrome.

```sh
npm install
npm run dev
npm test
npm run test:browser
npm run build
npm run audit:lucide
npm run profile:geometry
```

Open the local URL printed by Vite. `npm test` covers the geometry engine, validation, source parsing, state, and existing raster regressions. `npm run test:browser` covers pointer, touch, keyboard, import/export, and canvas screenshots. The screenshot baselines in `test/browser/editor.spec.ts-snapshots` are generated on Windows. To review intentional visual changes, run `npm run test:browser -- --update-snapshots`, inspect the images, then run the regular suite again. To refresh the Phase 1 raster baselines, set `UPDATE_VISUALS=1` before `npm test`.

## Editing

- Open either icon picker to search the complete installed Lucide library by name, alias, or official tag. Its grid supports mouse, touch, Tab, arrow keys, Home/End, Enter, and Escape. Subject and modifier selections are independent. Click the canvas or the **Subject / Modifier** buttons to select a layer.
- Choose **Parts** next to any icon in the picker, or **Break Apart · Select Parts** for a current source. Click source strokes, Shift+click to combine, drag a marquee, or use the element list. The enlarged 24×24 selector shows bounds and a live selection preview. **Add selected parts** imports them as a grouped layer; **Save fragment** stores the selection locally. Escape closes the selector.
- The **Composition layers** panel lists layers front to back. Expand an imported group to select, hide, or remove individual source elements. **Ungroup** permits direct canvas manipulation of an element; Shift+click several list entries and **Group selected** to make a new non-destructive group. Layers can be named, hidden, locked, reordered, duplicated, deleted, and set to **Cutout** or **Overlay**. Undo and redo include these edits.
- The **Saved fragments** panel searches local fragments and lets you preview, reuse, rename, delete, export, and import them. Fragments embed their source geometry and edited transforms; they do not depend on the installed Lucide version remaining unchanged. Browser storage is local to this origin, so export the fragment JSON to move it elsewhere.
- Drag either layer. The 24×24 coordinates stay stable under zoom and pan. Use the **Subject / Modifier** buttons to choose a layer where their hit areas overlap. Drag empty canvas to pan; **Pan** also lets you drag anywhere. **Fit** and **Reset view** restore useful views.
- **Grid** controls the visible grid; **Snap** controls placement separately. Choose 1, 0.5, or 0.25 units. Hold Alt during a drag for unsnapped placement. Each layer's reference point snaps; its paths remain rigid.
- Focus the canvas and use arrow keys to move the selected layer or element by one grid step. Shift+arrow moves 2 units; Alt+arrow moves 0.1. Delete or Backspace removes the selected modifier, imported layer, or element. Escape cancels a drag. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Text fields keep their native keyboard behavior.
- Use X/Y fields for unsnapped positions and the scale and pivot controls for each layer. Scale sliders use each source icon's longest path dimension to step in whole geometry pixels. Choosing a new modifier carries its position and snaps the previous scale to the new icon's geometry. Hold Alt while adjusting a slider for 0.1% precision. **Reset Transform** restores that layer's default. The subject scales from 50% to 120%; the modifier anchor selector offers position presets. Visible clearance is available regardless of selection. Both layers keep 2-unit strokes as their path geometry changes.
- Review 16, 24, 32, and 48 pixel previews on light or dark backgrounds. Open a guidance item to highlight affected paths; toggle safe-area and cutout-area overlays as needed. These guides never appear in exports.
- Copy or download the finished SVG. Save an editable JSON project and reopen it later. A drag is one history action; composition data is stored without canvas zoom or panel state.

## Architecture

`src/engine/compose.ts` is a React-independent Paper.js engine. Its original two-layer path remains for unchanged compositions. An ordered-layer path transforms every visible source element, trims lower layers under each higher cutout layer, and returns flattened SVG plus per-layer and per-element geometry for editing. Every transform changes path centerlines while the final stroke remains 2 units. `src/editor/parts.ts` extracts stable source-element identities and preserves standalone original primitives. `src/editor/document.ts` validates the versioned editable model; `src/editor/fragments.ts` validates and persists the local fragment library. `src/engine/guidelines.ts` performs technical, geometric, and advisory checks. `src/editor/PartSelector.tsx` handles source selection; `src/editor/Editor.tsx` handles composition UI and direct manipulation; `src/editor/history.ts` holds undo/redo state.

### Full Lucide library

The `lucide-static` version is pinned in `package.json`. Before development, tests, and builds, `scripts/generate-lucide-catalog.mjs` reads that installed package's canonical names from `icon-nodes.json`, search tags from `tags.json`, and SVGs from `icons/`. It compares identical SVG geometry to map package aliases to their canonical names. The generated catalog and canonical SVG copies live under `public/` and are ignored by Git. No list of individual icons is maintained by hand.

The browser fetches the small catalog only when a picker opens. Search filters names, aliases, and official tags. The scrollable grid renders only nearby rows, and thumbnails use local SVG URLs with lazy image loading. On selection, `src/library/catalog.ts` fetches and caches that icon's full original SVG. Browsing does not run the cutout engine. The build copies the same local assets into `dist`; it uses no CDN. If you deliberately update `lucide-static`, run `npm install` followed by `npm run prepare:icons` or any dev/test/build command. That regenerates the catalog and assets for the installed version.

Editable JSON schema version 5 stores the original subject and modifier sources, imported source elements, individual and group transforms, visibility, locks, cutout mode, and explicit layer order. Imported elements retain their original SVG coordinates and source identity. Schema versions 1–4 migrate on open; old two-layer projects retain their previous geometry and output. Version 1 and 2 projects have an `unknown` source version until a new library icon is selected.

The engine calculates a centerline exclusion radius of:

`subject stroke radius + modifier stroke radius + requested visible clearance + numerical margin`

For default 2px strokes and 2px visible clearance, the exact radius is **4.015px**. The same clearance rule applies between ordered cutout layers. A newly cut round cap is included in the lower layer's 1px stroke radius. The exact engine scans paths at up to 0.025px intervals, refines boundaries to 0.0001px, then places newly cut endpoints on whole canvas coordinates. It retreats into the safe portion of the path and verifies the final stroke gap after rounding; short fragments that cannot be safely snapped are removed. Original tiny Lucide dot strokes remain intact.

Drag updates are coalesced with `requestAnimationFrame`. The temporary drag preview scans at 0.25px and increases its safety margin to 0.14px; on release the engine recomputes at exact quality. Copy and download use the exact result and are unavailable during a drag. `npm run profile:geometry` measures both modes. On the development machine, simple pairs took roughly 1–2 ms per preview; the dense Calendar + Pencil pair took about 49 ms per preview and 452 ms for its exact result. These are measurements, not hard limits across machines.

## Validation and source safety

The editor separates **errors**, **warnings**, and **suggestions**. Technical checks cover the 24×24 SVG contract, 2-unit round strokes, supported elements and attributes, path validity, and export validity. Geometric checks cover rendered stroke extents, visible subject–modifier spacing, tiny fragments, off-canvas modifiers, and major subject removal. Silhouette and small-scale guidance remains advisory. Warnings do not move the designer's geometry or prevent export.

Imported SVG sources pass a strict XML allowlist in `src/engine/strictSvg.ts`. It rejects scripts, events, entities, transforms, masks, filters, images, unsupported attributes, and nested markup. It supports the installed collection's compact SVG arc flags, tiny round-cap dots, and small filled circles whose interiors are fully covered by their 2px strokes. Source SVG text remains unchanged in editable projects. The editor and proof harness render parsed path data through React SVG elements. Source markup is never inserted directly into the DOM. The exported SVG contains only stroked paths, with no masks, clipping paths, raster content, or background overlays. `npm run audit:lucide` parses every canonical icon and reports failures by name and reason; the current pinned version has **zero** parse failures.

## Limits and next steps

- Input is limited to untransformed, undashed Lucide geometry with a 24×24 viewBox and 2px round strokes. Break Apart selects complete source SVG elements; a path with multiple subpaths remains one selection. Supported primitives are paths, lines, circles, ellipses, rectangles, polylines, and polygons. Filled circles are allowed only when the 2px stroke already covers their interior.
- Imported groups keep one level of child elements. Grouping a subset creates another top-level group; nested group hierarchies, node editing, and arbitrary Bézier splitting are outside this phase.
- The current package provides 1,903 canonical icons and 268 searchable aliases. Every canonical source parses, but not every pair is visually suitable or guaranteed to compose at every placement. An engine failure appears as an error while the editable project remains saveable.
- The cutout engine favors a safe minimum visible gap. Very dense, self-intersecting, or nearly tangent geometry still deserves visual review at actual size.
- Dense icons can pause briefly when the final exact cutout is computed. A worker or geometry acceleration is the next performance improvement for unrestricted library use.
- Visual guidance cannot decide whether the icon's meaning or optical balance is right. The designer makes those decisions.

References: [Lucide design principles](https://lucide.dev/contribute/icons/design-principles), [Paper.js path API](https://paperjs.org/reference/path/). Source icons are from `lucide-static` under the [ISC license](https://github.com/lucide-icons/lucide/blob/main/LICENSE).
