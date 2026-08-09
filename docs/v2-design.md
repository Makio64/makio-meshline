---
description: "Makio MeshLine V2 engineering contract for robust screen strokes, road surfaces, compute acceleration, and backend parity."
---

# V2 Design Contract

This page records the implemented V2 geometry contracts and the remaining promotion gates. The regular cross-backend billboard keeps a bounded fixed strip, world surfaces now emit true variable topology, and the optional native-WebGPU path is the experimental screen-topology proving ground.

V2 separates three jobs that have different mathematics and performance costs:

1. **Screen strokes** face the active camera and preserve a requested screen or projected width.
2. **World surfaces** create camera-independent ribbons with normals, tangents, banking, and distance UVs for roads and tracks.
3. **Compute preprocessing** is an optional accelerator for large, frequently changing paths. It is not a join algorithm and is not required for static paths.

Keeping these profiles distinct is important. A billboard stroke intentionally rotates with the camera, while a road must keep its orientation in the world. Moving either calculation into a compute shader does not change that geometry contract.

## Correctness guarantees

For finite accepted input, V2 enforces these invariants within each profile's documented scope:

- emitted attributes and triangle indices remain finite and in range;
- consecutive zero-length segments do not create phantom wedges or bowties;
- open endpoints and closed cyclic joins are explicit topology, never inferred from a fuzzy progress threshold;
- projected coordinates are guarded or clipped before perspective division;
- miter length is finite and bounded, with a real bevel, round, or split fallback at a cusp;
- distance along the path drives progress, dashes, and road UVs;
- closed surface frames and seam positions match, with residual frame twist distributed around the loop;
- surface tangents, normals, and side vectors remain orthonormal and sign-continuous;
- regular billboard and surface profiles follow the same policies on WebGPU and WebGL2; native-only accelerators expose and document their fixed-profile fallback.

These guarantees are local. Some inputs do not have a unique perfect answer: an exact 180-degree reversal has no finite miter, a centerline alone does not define the roll of a 3D ribbon, and a road wider than its local curvature radius can self-intersect. V2 resolves those cases with explicit policies rather than unstable normalization.

## Screen-stroke policy

The regular screen profile computes directions after camera projection. It guards clip `w`, encodes CPU endpoints through coincident neighbour positions, retains explicit endpoint/closed metadata for procedural and position-hook paths, and transitions an over-limit miter to a bounded incoming cross-section. This keeps the zero-dispatch, six-vertices-per-segment compatibility path finite, but it does not add geometric fans.

The optional native-WebGPU path owns the variable-topology experiment. It clips centerline intervals in homogeneous coordinates before division, keeps clip-created boundaries distinct from semantic endpoints, and emits packed two-word body/join/cap primitive records. Candidate slots that become geometrically empty after projection are suppressed in the vertex stage.

At sharp projected turns, the renderer chooses one of these explicit policies:

- `miter`: use the offset-line intersection while it is finite and within the configured limit;
- `bevel`: emit separate incoming and outgoing outer vertices plus fill geometry;
- `round`: tessellate the outer arc with a bounded segment count;
- reversal fallback: split and cap the two incident segments, or emit a defined semicircular turnaround.

Because projection can turn a harmless 3D bend into a screen-space cusp, classifying corners only once on the CPU cannot guarantee stable camera-facing joins. Advanced GPU topology therefore stays full detail: local-space simplification is disabled for bevel/round/cap modes until a camera-dependent mandatory-break pass runs before LOD selection.

## Road and ribbon policy

The surface profile expands positions in world space and uses rotation-minimizing parallel transport by default. The first frame is seeded by projecting a caller-supplied `up` vector onto the plane perpendicular to the path tangent. Near a singularity, it selects the Cartesian axis least aligned with that tangent.

Bank is applied around the transported tangent. Closed paths measure the residual rotation at the seam and distribute the inverse correction by cumulative distance. A duplicate render row carries the final U coordinate so a repeating road texture does not interpolate backward across the seam.

Distance UVs use world units:

```text
u = cumulativeDistance / uvScale
v = 0 on the left edge, 1 on the right edge
```

The generated surface always provides `position` and `normal`. Tangent `vec4`, `uv`, `progress`, and `side` are emitted only when normal mapping, texture maps, or explicit low-level consumers need them. Its material profile is lit and performs no camera-facing vertex expansion.

Ordinary miter/butt surfaces retain two vertices per path row. Bevels add an outer wedge, round joins add an adaptive fan, square/round caps extend semantic endpoints, and over-limit miters bevel only the outer corner while retaining the exact inner offset intersection. A reversal inside the inclusive one-degree policy cone splits the path into independent capped runs; no triangle bridges an undefined cusp. If adjacent exact inner setbacks would cross inside a short segment, construction rejects the surface rather than narrowing it. Closed texture seams are duplicated before seam join triangles are emitted.

## Compute decision

Compute is opt-in. It is most promising when the application would otherwise upload duplicated current, previous, and next point buffers every frame, or when a procedural path is sampled repeatedly for multiple vertices and passes.

The first compute backend uses fixed output capacity and the CPU implementation as its correctness oracle:

```text
input points once
    -> classify fixed vertex roles
    -> write positions / normals / UVs
    -> render generated attributes
```

The optional `makio-meshline/gpu-path` entry now implements the first point-centric variable-count path: fixed chunks, stable segment records, a hybrid serial/256-lane prefix, a non-indexed indirect draw, and an opt-in local-space dyadic simplifier. It stores each source point once and avoids generated index plus duplicated current/previous/next buffers; raw mode also derives neighbours in the vertex shader and allocates no segment-record buffer. The complete CPU `MeshLine` remains resident as its correctness and backend fallback. Screen-pixel LOD, integrated culling, multi-line/closed emission, shadows, and XR are not promoted by this stage and fail back explicitly.

The separate native-WebGPU culling module compacts visible opaque chunk indices into one indirect draw; WebGL2 and ambiguous bounds fail open to the CPU/full-draw reference path. Camera-facing clip-space expansion remains in the draw path because it depends on the active camera, shadow pass, picker view, and XR eye.

The included compute prototype is deliberately narrower: one fixed-capacity, fixed-up world-space ribbon dispatch with GPU-resident position output. Side is derived from paired vertex indices instead of occupying another storage buffer. It includes a deterministic axis fallback for vertical tangents and proves Three.js storage-to-vertex plumbing on native WebGPU; it does not yet implement transport frames, bounds, picking, or a WebGL2 compute fallback.

The GPU simplification stress demo is deliberately labelled as a sampled bounded-gap heuristic. It proves stable workgroup scan/scatter and adaptive indirect counts at 262,144 points, but it does not claim a pixel/world tolerance guarantee. The production optional path uses the narrower local dyadic contract; an exact screen-space hierarchy remains a later promotion gate.

The culling module is likewise an accelerator rather than a geometry policy. It chunks an already-built index stream, requires conservative bounds, reuses unchanged visibility results, and draws the complete geometry for unprepared secondary cameras. Hi-Z occlusion and stable transparent compaction are intentionally outside the first implementation.

## Verification gates

Every V2 change is checked against adversarial paths: duplicates, unequal sampling, sharp and exact reversals, open and closed seams, vertical segments, non-planar loops, large coordinates, near-plane crossings, extreme camera FOV/aspect, and 16/32-bit index boundaries.

Performance comparisons use identical path counts, point counts, cameras, viewport, sampling duration, and backend. Static build time, dynamic update time, buffer memory, frame-time distribution, and visual output are reported separately; a compute dispatch is not considered an optimization merely because it moves CPU work to the GPU.
