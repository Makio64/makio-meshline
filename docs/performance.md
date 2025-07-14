# Performance Guide

Makio MeshLine uses TSL core for efficient GPU rendering, supporting both WebGPU and WebGL2 backends. 

The core approach minimizes overhead by generating only necessary vertex attributes and uniforms based on active features—like skipping UVs if no textures are used

It also support `Instancing` & optimized `cpu Batching` 

## Include Optimizations
- **Selective Attributes**: Only creates buffers for what's needed (e.g., no 'previous/next' for GPU-driven positions).
- **Instancing**: Smaller footprint & one drawcall + custom behavior by instance.
- **Batching**: Draw multiple lines in one call by passing an array to `lines`.
- **CPU->GPU Fast Updates**: `setPositions()` modifies existing buffers in-place without recreation.
- **Miter Clipping**: Optional property for efficient sharp corner handling without extra geometry.

## Best Practices
- Use Instancing when all your lines have the same number of segments.
- Use `Float32Array` for initial positions to avoid conversions.
- Reuse arrays in hot loops to reduce GC pressure.
- Call `dispose()` on unused lines to free GPU memory.
- For massive lines, use GPU positions via `gpuPositionNode` to skip CPU uploads & `instancing`.
- Test on target devices—WebGPU often yields 2x speedup over WebGL.

Follow these for smooth 120FPS even with thousands of segments! 