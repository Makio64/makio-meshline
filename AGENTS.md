# Project Guidelines

## Architecture

- `src/` is the published `makio-meshline` package. The main public surface is `MeshLine`, with `MeshLineGeometry`, `MeshLineNodeMaterial`, and `MeshLinePicker` available for advanced use.
- Keep `MeshLine` as the preferred entry point in docs and examples unless the task is explicitly about low-level geometry, material, or picking behavior.
- The library is TSL-first and should remain compatible with Three.js WebGPU/WebGL2 backends. Do not add runtime dependencies beyond Three.js.

## Code Style

- Use `pnpm` from the workspace root.
- Match the existing JavaScript style: tabs, no semicolons, and spaced calls such as `fn( value )`.
- Prefer `Float32Array` for point data in performance-sensitive code and reusable examples.
- Keep reusable examples copy-paste friendly: explicit imports, small helper functions, clear prop names, and no hidden demo-only utilities.

## Examples And Docs

- Treat Vue and React Three Fiber support as first-class integration surfaces for the library, not incidental demos.
- Keep the center of demo canvases clear. New demos should omit the generic `this.text` instruction overlay; place essential copy in unobtrusive edge-aligned UI or integrate short labels into the scene composition.
- Follow "Demo Conventions" in `CLAUDE.md` when writing or editing `demo/src/demos/`.
- Framework wrappers in `examples/` should read like starter code users can drop into their own projects.
- Keep framework wrappers aligned with the public `MeshLine` API and `MeshLineConfigureOptions`: if a prop is exposed, wire its build and update behavior; if an API is intentionally omitted, document that the wrapper covers only common options.
- Keep docs pages aligned with the actual files under `examples/react-three-fiber/src/` and `examples/vue/src/`.
- If a wrapper exposes only common options, say so. If it claims broader API coverage, wire the corresponding props and update behavior.

## Verification

- Run `pnpm lint` after source or demo edits.
- Run `pnpm test` and `pnpm test:types` after library or demo changes.
- Run `pnpm build` for demo-facing changes and `pnpm docs:build` for documentation changes.
- Run `pnpm --filter makio-meshline-r3f-example build` and `pnpm --filter makio-meshline-vue-example build` after touching standalone examples.

## Agent Reference (`src/llms-full.txt`)

- `src/llms-full.txt` is the one reference for agents that use the library: rules, API, TSL hooks, recipes and troubleshooting. The npm package ships it, and `docs/public/llms-full.txt` is an identical copy for the docs site. Read it before writing code that uses `makio-meshline`.
- A change to the public API (an option, a default, a hook's arguments, a helper's signature, a new method) updates `src/llms-full.txt` in the same change; then `cp src/llms-full.txt docs/public/llms-full.txt`.
- `test/agent-reference.test.js` keeps it true: it builds every recipe and compiles its shaders, and checks option keys, hook arguments, helper signatures and method coverage against the source.
- A new `configure()` key also goes into `CONFIGURE_KEYS` in `src/MeshLineBillboard.js`, or the unknown-option warning flags it (the same test checks both lists match).
- Usage mistakes should explain themselves: prefer one `warnOnce()` warning that names the fix over a silent no-op or a cryptic failure later.
- Performance notes that the reference leaves out: keep the default `join.fold: 'geometry'` (no discard, keeps early-Z); leave `antialias` off with MSAA; hooks that read `progress`, `side` or `lineCoord.y` instead of `uv` can set `.needsUV( false )` to save a vertex buffer; warm up multi-shader scenes before entrance animations.

