# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is **makio-meshline**, a modern TSL-powered meshline solution for Three.js WebGPU/WebGL2. The project is structured as a monorepo with three packages:
- `src/` - Core MeshLine library (published as "makio-meshline" package)
- `demo/` - Vue.js demo application showcasing features  
- `docs/` - VitePress documentation site

## Core Architecture

The MeshLine system consists of three main classes:

1. **MeshLine** (`src/MeshLine.js`) - High-level facade extending Three.js Mesh. This is the main entry point.
2. **MeshLineGeometry** (`src/MeshLineGeometry.js`) - Geometry builder that creates vertex buffers for line rendering
3. **MeshLineNodeMaterial** (`src/MeshLineNodeMaterial.js`) - TSL-based NodeMaterial for GPU rendering with extensive hook system

Key architectural principles:
- Only required uniforms/attributes are created and uploaded to GPU
- TSL (Three.js Shading Language) for custom shader logic
- Compatible with both WebGPU and WebGL2 renderers
- Built-in instancing support for efficient batch rendering
- Extensive hook system for shader customization
- No runtime dependencies beyond Three.js

## Development Commands

Use `pnpm` as the package manager (required, configured in `.packageManager` field).

### Main Commands (from root):
- `pnpm dev` - Start demo development server  
- `pnpm build` - Build demo for production
- `pnpm preview` - Preview demo build
- `pnpm docs:dev` - Start documentation development server
- `pnpm docs:build` - Build documentation
- `pnpm docs:preview` - Preview documentation build
- `pnpm lint` - Lint src/ and demo/src/ directories
- `pnpm lint:fix` - Lint and auto-fix issues

### Demo-specific (from demo/):
- `pnpm dev` - Development server with host flag
- `pnpm build` - Production build
- `pnpm preview` - Preview with host flag
- `pnpm lint` - Lint demo source with auto-fix

## Code Style & Linting

ESLint configuration (`eslint.config.mjs`) enforces:
- Tab indentation (not spaces)
- No semicolons 
- Space in parentheses: `function( param )`
- Object curly spacing: `{ prop: value }`
- Consistent array formatting
- Vue-specific rules for demo components

### Stylus CSS Style
When writing CSS in Vue components, use Stylus with these conventions:
- No semicolons or colons
- Tab indentation
- No braces
- Nested selectors with `&` for pseudo-classes
- Simplified syntax: `color white` instead of `color: #fff;`
- Example:
```stylus
.button
	background rgba(255, 255, 255, 0.1)
	padding 10px 20px
	border-radius 4px
	&:hover
		background rgba(255, 255, 255, 0.2)
```

When editing code, maintain these style conventions exactly as they appear in existing files.

## Testing & Verification

- `pnpm test` - Run Node test suite (`node --test test/*.test.js`)
- `pnpm test:types` - Run TypeScript declaration verification (`tsc --project tsconfig.types.json`)
- `pnpm lint` - Lint `src/`, `demo/src/`, `examples/`, and `scripts/`
- `pnpm build` - Build demo application
- `pnpm docs:build` - Build VitePress documentation
- `pnpm release:check` - Full release gate (lint, tests, types, demo build, docs build, standalone example builds, package & compatibility checks)

## Key Files & V2 Architecture

### Package Entry Points (`src/`)
- `src/index.js` (`makio-meshline`):
  - `MeshLine.js` — Main fluent facade extending `THREE.Mesh`
  - `MeshLineGeometry.js` / `MeshLineNodeMaterial.js` — Screen-space billboard line profile (arc-length progress, miter/bevel/round joins, 3D fold handling, analytic AA)
  - `MeshLineSurfaceGeometry.js` / `MeshLineSurfaceNodeMaterial.js` — World-space lit ribbon/road surface profile (`transport` / `fixed-up` frames, banking, miter/bevel/round joins, butt/square/round caps)
  - `MeshLineCompute.js` — WebGPU compute-driven curve simulation engine
  - `MeshLinePicker.js` / `MeshLinePickerHelper.js` — GPU pixel-picker and visual debug helper
  - `positions/` — `circlePositions`, `squarePositions`, `rectanglePositions`, `sineWavePositions`, `straightLine`, `straightLineBetween`, `storagePositions` (supports ring-buffer `head`, two-buffer GPU `toBuffer`/`morph`, and `closed` loop seam wrapping)
- `src/gpu-culling/index.js` (`makio-meshline/gpu-culling`, Three.js r183+):
  - `MeshLineCullingSystem` — Native-WebGPU chunk frustum culling + single indirect draw compaction
- `src/gpu-path/index.js` (`makio-meshline/gpu-path`, Three.js r183+):
  - `MeshLineGPUPath` — Point-centric GPU path with optional multi-stride simplification and automatic CPU fallback

### Critical Rules When Writing `makio-meshline` Code
1. **TSL `Fn()` Array Destructuring**: Always destructure the array parameter inside `Fn( ( [param1, param2] ) => ... )`.
2. **In-Place Updates**:
   - Fixed point count: `.dynamic( true )` + `line.setPositions( points )` or `line.setPositionRange( slice, startPoint, { lineIndex } )`.
   - Variable point count / open-closed topology change: `line.lines( points, closed )` (or alias `line.points( points, closed )`).
3. **Packed Attributes**: Use `line.addInstanceAttributes( { a: 3, b: 1 } )` or `line.addVertexAttributes( ... )` to stay within the portable 8-vertex-buffer WebGPU limit.
4. **Random Helper in Demo**: Use `random( min, max )` from `@/makio/utils/random` inside `demo/src/`.

## Dependencies

- **Three.js >=0.180.0** (peer dependency; optional `gpu-culling` and `gpu-path` entries require `>=0.183.0`)
- Demo uses Vue 3, Vite, and Three.js `WebGPURenderer`
- Documentation uses VitePress (see `AGENTS.md` and `docs/public/llms-full.txt` for full agent recipes)