# Makio MeshLine demo gallery

The gallery under `src/demos/` is the runnable companion to the V2 documentation. Routes and menu metadata live in `src/demoCatalog.js`.

## Commands

- `pnpm dev` — start the gallery with hot reload
- `pnpm build` — create the production bundle in `dist/`

Open `/examples/basic` for the core feature gallery or `/examples/v2-updates` for the stable-layout update APIs and arc-length behavior introduced in V2.

The core line and surface demos use Three.js `WebGPURenderer` with automatic renderer selection. Native-only GPU path and culling demos report their fallback state when the required device features are unavailable.
