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
- Framework wrappers in `examples/` should read like starter code users can drop into their own projects.
- Keep framework wrappers aligned with the public `MeshLine` API and `MeshLineConfigureOptions`: if a prop is exposed, wire its build and update behavior; if an API is intentionally omitted, document that the wrapper covers only common options.
- Keep docs pages aligned with the actual files under `examples/react-three-fiber/src/` and `examples/vue/src/`.
- If a wrapper exposes only common options, say so. If it claims broader API coverage, wire the corresponding props and update behavior.

## Verification

- Run `pnpm lint` after source or demo edits.
- Run `pnpm build` for demo-facing changes and `pnpm docs:build` for documentation changes.
- Run `pnpm --filter makio-meshline-r3f-example build` and `pnpm --filter makio-meshline-vue-example build` after touching standalone examples.