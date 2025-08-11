# Common Patterns

Quick recipes covering typical simple use-cases. Copy-paste and tweak. 

For testing yourself and have code generated, see [Interactive sandbox](./examples/sandbox.md)

For advanced techniques like GPU-driven positions and custom shaders, see [Advanced Patterns](./advanced-patterns.md).

## 1. Basic White Line

```js
const line = new MeshLine()
  .lines([[0,0,0],[1,1,0],[2,0,0]])
  .color(0xffffff)
  .lineWidth(1) // value in unit of threejs
```

## 2. Closed Circle

```js
const line = new MeshLine()
  .lines(circlePositions(64))
  .closed(true) // close the last 2 points
```

shorter methods : 
```js
const line = new MeshLine()
  .lines(circlePositions(64), true) // lines( lines, closed )
```

## 3. Dashed Line

```js
const line = new MeshLine()
  .lines(circlePositions(64), true)
  .dash({ count: 8, ratio: 0.5 }) // dash({ count, ratio = 0.5, offset = 0 })
```

## 4. Gradient

```js
const line = new MeshLine()
  .lines(squarePositions(4), true)
  .color(0xff0000) // start of the gradient will be Red
  .gradientColor(0x0000ff) // end of the gradient will be Blue
```

## 5. Textured Rope

```js
const line = new MeshLine()
  .lines(myFloat32Array)
  .map(ropeTexture) // add your texture here.
```

## 6. Variable Width

```js
const line = new MeshLine()
  .lines(sineWavePositions(100))
  .widthCallback(t => 0.1 + t * 0.9) // Thin to thick
```

## 7. Animated Dashes

```js
const line = new MeshLine()
  .lines(circlePositions(64), true)
  .dash({ count: 12, ratio: 0.3 })

// In render loop:
line.material.dashOffset -= 0.01 // -= for clockwise movement
```

## 8. Multi-Line Segments

```js
const lines = [
  [[0,0,0], [1,0,0], [1,1,0]],  // First segment
  [[2,0,0], [3,1,0], [3,2,0]],  // Second segment
  [[4,0,0], [5,0,1], [4,1,1]]   // Third segment
]

// this will create 3 differents lines
const meshLine = new MeshLine()
  .lines(lines)
  .color(0xffffff)
```

## 9. Dynamic Updates

```js
// Pre-allocate for performance
const positions = new Float32Array(NUM_POINTS * 3)
const line = new MeshLine({ lines: positions })

// Update positions efficiently
function animate() {
  updatePositions(positions) // Your update logic
  line.geometry.setPositions(positions) // this is optimized to be fast cpu->gpu
  requestAnimationFrame(animate)
}
```
** Note ** check advanced examples for more performant techniques using full gpu approach : instancing / gpu positionning.

## 10. Window Resize Handling

```js
const line = new MeshLine().lines(points)

window.addEventListener('resize', () => {
  // or the size of your threejs canvas.
  line.resize(window.innerWidth, window.innerHeight)
})
```

## 11. Miter Limit for Sharp Corners

```js
// Basic miter limit (prevents oversized spikes)
const line = new MeshLine()
  .lines(squarePositions(16), true)
  .join({ type: 'miter', limit: 4 })
  .lineWidth(2)

// Custom miter limit
const line2 = new MeshLine()
  .join({ type: 'miter', limit: 6 }) // Higher limit = sharper corners but potential bigger spikes ( see under )

// High quality miter (fix for when the screen-centered sharp corners)
const line3 = new MeshLine()
  .lines(squarePositions(16), true)
  .join({ type: 'miter', limit: 4, quality: 'high' }) // High quality mode
``` 