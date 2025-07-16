# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is **makio-meshline**, a modern TSL-powered meshline solution for Three.js WebGPU/WebGL2. The project is structured as a monorepo with three packages:

- `src/` - Core MeshLine library (published as "meshline" package)
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

## Testing

No test framework is currently configured. When adding tests, check the codebase first to determine the testing approach rather than assuming a specific framework.

## Key Files & Patterns

### Position Helpers (`src/positions/`)
- `circlePositions.js` - Generate circular line paths
- `squarePositions.js` - Generate square line paths  
- `sineWavePositions.js` - Generate sine wave paths
- `straightLine.js` - Generate straight line segments

### Hook System (MeshLineNodeMaterial)
The material supports extensive customization through function hooks:
- Position processing: `positionFn`, `previousFn`, `nextFn`
- Width/normal modification: `widthFn`, `normalFn` 
- Color/shading: `colorFn`, `gradientFn`, `fragmentColorFn`
- Opacity/alpha: `opacityFn`, `fragmentAlphaFn`
- UV/dash effects: `uvFn`, `dashFn`
- Vertex/discard: `vertexFn`, `discardFn`

### Geometry Patterns
- `setLines()` - Initialize/replace polylines (rebuilds buffers)
- `setPositions()` - Fast in-place update when point counts stay constant
- Multi-line support with individual loop settings
- Efficient 16-bit/32-bit index selection based on vertex count

### Instancing System (MeshLine)
The MeshLine class supports efficient instanced rendering:
- `instanceCount` option - Enable instancing with specified instance count
- `addInstanceAttribute(name, components)` - Create instanced buffer attributes
- `setInstanceValue(name, index, value)` - Set per-instance attribute data
- Works seamlessly with hooks and GPU position nodes
- Allows thousands of lines with minimal performance impact

## Dependencies

- **Three.js ^0.178.0** (peer dependency)
- Demo uses Vue 3, Vite, and various Three.js ecosystem tools
- Documentation uses VitePress

## Performance Notes

- Use `Float32Array` for positions to avoid conversion overhead
- Geometry only uploads needed attributes to GPU
- Material only creates required uniforms
- Supports both CPU and GPU position calculation modes
- Instancing allows rendering thousands of lines with single draw call
- Hook functions run in GPU for maximum performance