# Lucide Icon Composer — Phase 1 geometry proof

This repository contains the standalone SVG composition engine and a React/Vite inspection harness. It demonstrates real cutouts for File + Add, Folder + Check, and User + Remove, plus two more Lucide combinations. The editor workflow in the brief is Phase 2 and is deliberately not claimed as complete here.

## Run

Requires Node.js 22.12 or later.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Change the example, clearance, scale, or offsets to see the original source paths, exclusion zone, and trimmed output update. `npm test` runs geometry and raster visual regression tests; `npm run build` checks TypeScript and produces the production bundle.

To intentionally refresh the six visual baselines after reviewing a change, run `UPDATE_VISUALS=1 npm test` in a POSIX shell or `$env:UPDATE_VISUALS='1'; npm test` in PowerShell. Then run the regular tests again.

## Engine contract

[`composeIcon`](src/engine/compose.ts) accepts two SVG strings and a declarative placement/composition model. It creates a fresh Paper.js scope per call, parses Lucide stroke primitives, moves the modifier without altering its source SVG, trims subject paths, and returns a standalone 24×24 SVG. No React or browser DOM API is used by the engine. The result also includes path data, warnings, and an exclusion-zone SVG for inspection.

The model supports `cutout` and `overlay` today. `replace` is explicitly rejected until it has defined semantics. The source strings remain in the model, so recomposition from the same input is deterministic.

## Geometry and tolerance

Source paths remain centerlines. For each subject point, the engine queries the nearest point on every transformed modifier path. It removes portions whose centerlines fall inside this exclusion radius:

`subject stroke radius + modifier stroke radius + requested visible clearance + numerical margin`

For default 2px strokes and 2px visible clearance, the centerline exclusion radius is **4.015px**: 1px for each stroke radius, 2px of visible space, and 0.015px numerical margin. A newly cut round cap is already part of the subject's 1px stroke radius, so adding it again would overcut. The visible gap is at least the requested value; the 0.015px margin makes it slightly larger at a cut boundary.

The subject is scanned at no more than 0.025px along arc length. Crossings are refined by bisection to 0.0001px. The 0.015px inflation covers an undetected local distance dip between samples (at most half a sample step because point-to-curve distance is 1-Lipschitz along the subject) plus rounding. Fragments shorter than 0.18px are removed. The automated tests verify centerline-derived visible gaps within 0.03px on lines, Bézier curves, circles, rounded rectangles, and real Lucide icons. This is a minimum-gap guarantee, not an exact-gap fit.

Paper.js splitting preserves surviving line and Bézier segments as stroked vector paths. SVG arcs, circles, ellipses, and rounded rectangles are internally represented as cubic curves; their exported geometry stays stroke based. The export contains paths only, with 2px round strokes and no masks, filled outline conversions, raster images, or background-colored overlays.

## Library choice

**Paper.js** offers SVG-style path data, cubic curves, nearest-point queries, path length, and curve splitting in JavaScript. Those operations let this first proof cut the original centerlines and keep a compact Lucide-style export. Its filled-area Boolean operations alone do not solve stroke-aware centerline trimming.

**Skia PathKit** provides robust stroke expansion and filled-path Boolean operations, but subtracting expanded outlines would export filled shapes. Recovering clean original stroke centerlines afterward is a separate geometry problem. It also adds a WASM dependency. PathKit remains a useful candidate if a later iteration needs exact exclusion-region Booleans or pathological intersections.

References: [Lucide design language](https://lucide.dev/contribute/icons/design-principles), [Paper.js path API](https://paperjs.org/reference/path/), [Skia PathKit documentation](https://skia.googlesource.com/skia/+/main/site/docs/user/modules/pathkit.md). Original icon SVGs come from `lucide-static` under the [ISC license](https://github.com/lucide-icons/lucide/blob/main/LICENSE).

## Current limits

- Input must be untransformed, undashed, stroke-only Lucide geometry on a 24×24 viewBox with 2px strokes. Paths, lines, circles, ellipses, rectangles, polylines, and polygons are handled. Unsupported masks, images, filters, transforms, and nonstandard stroke widths raise an error.
- Very short safe fragments are intentionally discarded. Dense, self-intersecting, or nearly tangent geometry should be reviewed visually; the sampling/margin strategy prioritizes a safe minimum gap over the smallest possible cut.
- The harness visualizes the exclusion radius as a wide red stroke. That guide is never included in the exported composite SVG.
- The Phase 1 harness is for inspecting the engine. Searchable selectors, direct drag placement, JSON/SVG downloads, and the full output panel belong to Phase 2.
