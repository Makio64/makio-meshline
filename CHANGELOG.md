# Changelog

## 1.2.2
- Fix dynamic buffer usage hints so `.dynamic()` and explicit `usage()` settings apply correctly on build
- Skip build-time bounding volume computation when `frustumCulled` is disabled
- Align TypeScript definitions and docs with the implemented shadow and join APIs
- Update examples with latest threejs/meshBVH api
- Fix on positionFn not triggering built
- Fix typo in documentation
- Fix safe bisector for near-180° angles preventing NaN in miter direction
- Simplify miter normal calculation by removing highQualityMiter branch

## 1.1.0
- Three.js r181 compatibility
- Improved geometry performance and simplified closed loops handling
- Enhanced attribute auto-detection and `ensureBuilt()` method

## 1.0.5
- Fix TSL "No stack defined for assign operation" error

## 1.0.4
- Add per-vertex RGB colors support
- Update peer dependency to Three.js ^0.180.0

## 1.0.3
- Rename `counters` → `progress` for clearer API
- Fix alphaTest and transparency handling
- Optimize direct attribute access (vSide → aSide)

## 1.0.0
- Initial stable release
- ESM-only package with exports map and TypeScript types
- WebGPU-first MeshLine with TSL hooks, instancing, dashes, gradients, textures
- Helpers: circlePositions, squarePositions, rectanglePositions, sineWavePositions, straightLine, straightLineBetween
- Docs: meshline.makio.io
- Demo: meshline-demo.makio.io
