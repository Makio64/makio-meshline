# Makio MeshLine demo gallery

The gallery under `src/demos/` is the runnable companion to the V2 documentation. Routes and menu metadata live in `src/demoCatalog.js`.

## Commands

- `pnpm dev` — start the gallery with hot reload
- `pnpm build` — create the production bundle in `dist/`

Open `/examples/basic` for the core feature gallery, `/examples/drawlines` for in-place point and color updates (`setPositionRange()`, `setVertexValues()`), or `/examples/gpu-instance` for GPU positions with partial instance uploads (`setInstanceValues()`). The retired `/examples/v2-updates`, `/examples/vertex-colors` and `/examples/gpu-circle` routes still resolve to the demos that absorbed them.

Showcase demos share a few small helpers: `src/utils/bloomPipeline.js` adds an MSAA-preserving bloom pass, `src/utils/demoHint.js` and `src/utils/demoControls.js` show the interaction hint and the control pill (both hidden with `?noUI`), and `src/utils/points.js` builds point arrays at init.

The core line and surface demos use Three.js `WebGPURenderer` with automatic renderer selection. Native-only GPU path and culling demos report their fallback state when the required device features are unavailable.
