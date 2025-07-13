# Overview

Makio MeshLine is split into three composable pieces but you can just use the `MeshLine` façade for 99 % of cases.

```mermaid
flowchart TB
  A[MeshLine \n (facade)] --> B(MeshLineGeometry)
  A --> C(MeshLineNodeMaterial)
```

* **MeshLine** – convenience class that bundles geometry + material and exposes useful uniforms.
* **MeshLineGeometry** – generates the specialised vertex buffers required for thick joins, dashes, …
* **MeshLineNodeMaterial** – GPU shader implemented with TSL `NodeMaterial`.

---

## Class Pages

| Class | Why you’d use it |
|-------|------------------|
| [`MeshLine`](./meshline) | Quick, everything-in-one object. |
| [`MeshLineGeometry`](./meshline-geometry) | Share geometry, mutate vertices every frame, or mix with your own material. |
| [`MeshLineNodeMaterial`](./meshline-material) | Custom rendering / multiple materials per geometry. |

---

## Quick Navigation

* [Common Patterns](./common-patterns) – drop-in code snippets
* [Advanced Patterns](./advanced-patterns) – GPU nodes, live trails, batching
* [Helpers](./helpers) – position generators

> Looking for installation? Head to the [Getting Started guide](./guide). 