# Performance Guide

Makio MeshLine uses TSL-powered shaders for efficient GPU rendering, supporting both WebGPU and WebGL2 backends. The core approach minimizes overhead by generating only necessary vertex attributes and uniforms based on active features—like skipping UVs if no textures are used.

## Key Optimizations
- **Selective Attributes**: Only creates buffers for what's needed (e.g., no 'previous/next' for GPU-driven positions).
- **Batching**: Draw multiple lines in one call by passing an array to `lines`.
- **Fast Updates**: `setPositions()` modifies existing buffers in-place without recreation.
- **Miter Clipping**: Efficient sharp corner handling without extra geometry.

## Best Practices
- Use `Float32Array` for positions to avoid conversions.
- Reuse arrays in hot loops to reduce GC pressure.
- Call `dispose()` on unused lines to free GPU memory.
- For massive lines, use GPU positions via `gpuPositionNode` to skip CPU uploads.
- Test on target devices—WebGPU often yields 2x speedup over WebGL.

Follow these for smooth 60FPS even with thousands of segments! 