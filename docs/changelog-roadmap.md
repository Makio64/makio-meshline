# Changelog & Roadmap

A quick look at where Makio MeshLine has been and where it's headed. We're just getting started!

## Roadmap

- **Mid-term**:
  - Make a cool tutorial website
  - Add receiveShadow support
- **Long-term**: 
  - Explore possibilities to leverage more the performance of WebGPU ( Compute shader for processing the line )

## Changelog

- **v1.2.0**: Shadow casting support (`.shadow()` method, custom `castShadowNode`), internal refactoring for line position and width calculations, new demos (Shadow, Bamboo Grove)
- **v1.1.0**: Three.js r181 compatibility, geometry performance improvements, `ensureBuilt()` method
- **v1.0.5**: Fix TSL assign operation error
- **v1.0.4**: Per-vertex RGB colors, Three.js ^0.180.0 peer dependency
- **v1.0.3**: Rename counters→progress, fix alphaTest/transparency, vSide→aSide optimization
- **v1.0.0** (Initial Release): Core implementation with TSL, multi-line batching, instancing, dashes, gradients, mitter, hooks, and GPU positions. Built for Three.js r178+.
