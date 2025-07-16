# Common Patterns

Quick recipes covering typical simple use-cases. Copy-paste and tweak. 

<iframe src="https://meshlines.netlify.app/examples/sandbox?noMenu" width="100%" height="500" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

For advanced techniques like GPU-driven positions and custom shaders, see [Advanced Patterns](./advanced-patterns.md).

## 1. Basic Line

```js
const line = new MeshLine()
  .lines([[0,0,0],[1,1,0],[2,0,0]])
  .color(0xff3300)
  .lineWidth(0.4)
  .build()
```

## 2. Closed Circle

```js
const line = new MeshLine()
  .lines(circlePositions(64))
  .isClose(true)
  .color(0x00ccff)
  .lineWidth(0.2)
  .build()
```

## 3. Dashed Line

```js
const line = new MeshLine()
  .lines([[0,0,0],[1,1,0],[2,0,0]])
  .dashes(8, 0.5)
  .color(0x00ff00)
  .lineWidth(0.5)
  .build()
```

## 4. Gradient

```js
const line = new MeshLine()
  .lines(squarePositions(4))
  .isClose(true)
  .color(0xff0000)
  .gradientColor(0x0000ff)
  .lineWidth(0.3)
  .build()
```

## 5. Textured Rope

```js
const line = new MeshLine()
  .lines(myFloat32Array)
  .map(ropeTexture)
  .lineWidth(1)
  .sizeAttenuation(true)
  .build()
```

## 6. Variable Width

```js
const line = new MeshLine()
  .lines(sineWavePositions(100))
  .widthCallback(t => 0.1 + t * 0.9) // Thin to thick
  .lineWidth(2)
  .build()
```

## 7. Animated Dashes

```js
const line = new MeshLine()
  .lines(circlePositions(64))
  .isClose(true)
  .dashes(12, 0.3)
  .lineWidth(0.5)
  .build()

// In render loop:
line.material.dashOffset += 0.01
```

## 8. Multi-Line Segments

```js
const lines = [
  [[0,0,0], [1,0,0], [1,1,0]],  // First segment
  [[2,0,0], [3,1,0], [3,2,0]],  // Second segment
  [[4,0,0], [5,0,1], [4,1,1]]   // Third segment
]

const meshLine = new MeshLine()
  .lines(lines)
  .color(0xffffff)
  .lineWidth(0.3)
  .build()
```

## 9. Dynamic Updates

```js
// Pre-allocate for performance
const positions = new Float32Array(NUM_POINTS * 3)
const line = new MeshLine({ lines: positions })

// Update positions efficiently
function animate() {
  updatePositions(positions) // Your update logic
  line.geometry.setPositions(positions)
  requestAnimationFrame(animate)
}
```

## 10. Basic Instancing

```js
// 10 instances in a row
const line = new MeshLine()
  .lines(circlePositions(32))
  .instances(10)
  .lineWidth(0.2)
  .build()

// Add offset attribute
line.addInstanceAttribute('instanceOffset', 3)

// Position each instance
for (let i = 0; i < 10; i++) {
  line.setInstanceValue('instanceOffset', i, [i * 2, 0, 0])
}
```

## 11. Window Resize Handling

```js
const line = new MeshLine()
  .lines(points)
  .lineWidth(2)
  .build()

window.addEventListener('resize', () => {
  line.resize(window.innerWidth, window.innerHeight)
})
```

## 12. From BufferGeometry

```js
// Convert existing geometry to MeshLine
const geometry = new THREE.TorusKnotGeometry(10, 3, 100, 16)
const line = new MeshLine()
  .lines([geometry]) // Wrap in array
  .color(0xff00ff)
  .lineWidth(0.5)
  .build()
``` 