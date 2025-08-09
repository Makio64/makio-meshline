---
outline: false
pageClass: example-page
---

# Rice Field

A demo inspired by my trip in japan and the beauty of ricefields.

<iframe src="https://meshlines.netlify.app/examples/ricefield?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>


## How it works

This demo use two meshlines, one for the floor to delimited the fields and anothers for the rice. 

### Performance 

Both are using the `instance(true)` for performance.

### Make rice grow
For the rice field it use a compute shader to make it grow & react to the mouse.

### Floor
For the floor it use `mitters(true)` to get nice edge.

### Global shape
The shape use a simple quadtree + padding offset to separate each field

### Final touch
The sky is a simple gradient using `scene.backgroundNode` & there is a `reflector` to simulate the water
