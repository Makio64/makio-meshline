# Common Patterns

Quick recipes covering typical simple use-cases. Copy-paste and tweak.

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