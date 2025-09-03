---
outline: false
pageClass: example-page
---

# Venus & David

Similar concept than GPU Circle Example - It's a morph between two classical sculptures using MeshLine instanced for the representation.

<iframe src="https://meshline-demo.makio.io/examples/venus-and-david?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

--- 

## Behind the scene 

- There is only one Meshline and the transition is done using one uniform `morph` 
- Both model are raycasted using `three-mesh-bvh` to generate positions.
- Line are instanced for performance
- A Postprocessing with a bloom is applied for a ScienceFiction rendering