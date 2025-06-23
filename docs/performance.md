# Performance Guide

A few simple practices can dramatically improve rendering speed and memory usage when working with **MeshLine**.

## Golden Rules

1. **Prefer `Float32Array` inputs**  
   Passing your point data as a typed array avoids internal conversions and keeps garbage-collection pressure low.

2. **Batch multiple segments**  
   One MeshLine can contain multiple lines, use `new Meshlines({line:[positionsLine1, positionsLine2]})`. to reduce draw calls.

3. **Dispose what you no longer need**  
   Call `dispose()` on a line (or directly on its geometry/material) once it leaves the scene to free GPU buffers.

4. **Use Level-of-Detail for very long lines**  
   For enormous datasets consider showing a simplified version until the camera gets close.

---

Keep these in mind and your lines should stay smooth on both WebGPU and WebGL 2 back-ends. 